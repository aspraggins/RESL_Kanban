// ============================================================================
//  SERVICE — talks to the AGOL feature service. Uses the cached OAuth token
//  on every request and silently refreshes once on a 498/499 response.
// ============================================================================

import { CONFIG, FIELDS, MCC_SERVICE, FOLLOWUP_SERVICE } from './config.js';
import { getToken, ensureFreshToken, clearStoredToken } from './auth.js';

async function arcgisFetch(url, init, _retried) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) {
    if ((data.error.code === 498 || data.error.code === 499) && !_retried) {
      // try one silent refresh, then retry
      try {
        await ensureFreshToken();
        const fresh = getToken();
        const newUrl = url.replace(/([?&]token=)[^&]+/, `$1${encodeURIComponent(fresh.accessToken)}`);
        // For POST bodies we need to swap the token in the body instead.
        if (init && init.body instanceof URLSearchParams) {
          init.body.set('token', fresh.accessToken);
        }
        return arcgisFetch(newUrl, init, true);
      } catch {
        clearStoredToken();
      }
    }
    throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
  }
  return data;
}

// Inspect the layer once at boot — gives us the real field names + a
// console-readable diagnostic if the configured `FIELDS.status` doesn't
// actually exist on the layer. Returns the layer metadata.
export async function fetchLayerMeta() {
  await ensureFreshToken();
  const TOKEN = getToken();
  const url = `${CONFIG.serviceUrl}?f=json&token=${encodeURIComponent(TOKEN.accessToken)}`;
  const data = await arcgisFetch(url);
  const fieldNames = (data.fields || []).map((f) => f.name);
  console.group('[RESL-Kanban] Layer metadata');
  console.info('Service:', CONFIG.serviceUrl);
  console.info('Fields:', fieldNames);
  if (!fieldNames.includes(FIELDS.status)) {
    console.warn(
      `Configured status field "${FIELDS.status}" was NOT found on the layer.\n` +
      `Available fields: ${fieldNames.join(', ')}\n` +
      'Update FIELDS.status in src/config.js to match.',
    );
  }
  console.groupEnd();
  return data;
}

// Pull every record. Pages with resultOffset until the server says it has no
// more or returns an empty page.
export async function fetchAllResources() {
  await ensureFreshToken();
  const TOKEN = getToken();

  // Always ask for `*` so we don't 400 when FIELDS placeholders don't
  // match the layer schema yet. Cards in Card.jsx fall through to
  // `Resource <oid>` when display fields are missing, so this is the
  // friendliest behavior — the app loads, the diagnostic in
  // fetchLayerMeta() prints the real field names to the console, and
  // you tweak src/config.js #FIELDS at your leisure.
  const outFields = '*';

  const allFeatures = [];
  const pageSize = 2000;
  let offset = 0;
  let more   = true;
  let safety = 50;
  while (more && safety-- > 0) {
    const params = new URLSearchParams({
      where:             '1=1',
      outFields,
      returnGeometry:    'false',
      f:                 'json',
      resultOffset:      String(offset),
      resultRecordCount: String(pageSize),
      token:             TOKEN.accessToken,
    });
    const data = await arcgisFetch(`${CONFIG.serviceUrl}/query?${params}`);
    const feats = data.features || [];
    allFeatures.push(...feats);
    more = (data.exceededTransferLimit === true) || (feats.length === pageSize);
    offset += feats.length;
    if (feats.length === 0) break;
  }
  return allFeatures.map((f) => f.attributes);
}

// Update arbitrary attributes on a single feature via applyEdits.
// `partial` is an object of { fieldName: newValue } pairs.
export async function updateAttributes(objectId, partial) {
  await ensureFreshToken();
  const TOKEN = getToken();

  const attributes = {
    [FIELDS.objectId]: objectId,
    ...partial,
  };
  const body = new URLSearchParams({
    f:        'json',
    token:    TOKEN.accessToken,
    updates:  JSON.stringify([{ attributes }]),
  });
  const data = await arcgisFetch(`${CONFIG.serviceUrl}/applyEdits`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const result = (data.updateResults && data.updateResults[0]) || null;
  if (!result || !result.success) {
    const msg = result && result.error ? `${result.error.code}: ${result.error.description}` : 'Update failed';
    throw new Error(msg);
  }
  return result;
}

// Convenience wrapper used by the drag-drop handler.
export async function updateStatus(objectId, newStatus) {
  return updateAttributes(objectId, { [FIELDS.status]: newStatus });
}

// ─── MCC Status Mapper (secondary service) ───────────────────────────
// Look up the original county request that a resource deployment
// fulfills. Match is MCC_number = request_number_rpt AND
// incidentid = mission_id_rpt. Returns null if no record matches.
export async function fetchMccRequest({ requestNumber, missionId }) {
  if (requestNumber == null || requestNumber === '' || !missionId) return null;
  const num = Number(requestNumber);
  if (!Number.isFinite(num)) return null;

  await ensureFreshToken();
  const TOKEN = getToken();

  const safeMission = String(missionId).replace(/'/g, "''");
  const where =
    `${MCC_SERVICE.fields.mccNumber} = ${num} ` +
    `AND ${MCC_SERVICE.fields.incidentId} = '${safeMission}'`;

  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'false',
    f:              'json',
    token:          TOKEN.accessToken,
  });
  const data = await arcgisFetch(`${MCC_SERVICE.url}/query?${params}`);
  const feats = data.features || [];
  if (feats.length === 0) return null;
  // If multiple records match (shouldn't happen), surface the first.
  return feats[0].attributes;
}

// Fetch ALL MCC records for a given mission (incidentid). Returns an
// array of attribute objects. Empty array if none.
export async function fetchMccsForMission(missionId) {
  if (!missionId) return [];
  await ensureFreshToken();
  const TOKEN = getToken();
  const f = MCC_SERVICE.fields;
  const safeMis = String(missionId).replace(/'/g, "''");
  const where = `${f.incidentId} = '${safeMis}'`;
  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'false',
    orderByFields:  `${f.mccNumber} ASC`,
    f:              'json',
    token:          TOKEN.accessToken,
  });
  const data = await arcgisFetch(`${MCC_SERVICE.url}/query?${params}`);
  return (data.features || []).map((feat) => feat.attributes);
}

// Add a new feature to the followups service. `attributes` is an
// object keyed by AGOL field names. Returns the addResults entry on
// success; throws on failure.
export async function addFollowup(attributes) {
  await ensureFreshToken();
  const TOKEN = getToken();
  const body = new URLSearchParams({
    f:        'json',
    token:    TOKEN.accessToken,
    features: JSON.stringify([{ attributes }]),
  });
  const data = await arcgisFetch(`${FOLLOWUP_SERVICE.url}/addFeatures`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const result = (data.addResults && data.addResults[0]) || null;
  if (!result || !result.success) {
    const msg = result && result.error
      ? `${result.error.code}: ${result.error.description}`
      : 'Add failed';
    throw new Error(msg);
  }
  return result;
}

// ─── Followups service ─────────────────────────────────────────────
// Many-to-one with each resource. Matches mcc_number_text and mission.
// Returns an array of attribute objects sorted newest-first by
// entrydate. Empty array if no followups.
export async function fetchFollowups({ requestNumber, missionId }) {
  if (requestNumber == null || requestNumber === '' || !missionId) return [];

  await ensureFreshToken();
  const TOKEN = getToken();

  const f = FOLLOWUP_SERVICE.fields;
  const safeReq = String(requestNumber).replace(/'/g, "''");
  const safeMis = String(missionId).replace(/'/g, "''");
  const where =
    `${f.requestNumber} = '${safeReq}' ` +
    `AND ${f.mission} = '${safeMis}'`;

  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'false',
    orderByFields:  `${f.entryDate} DESC`,
    f:              'json',
    token:          TOKEN.accessToken,
  });
  const data = await arcgisFetch(`${FOLLOWUP_SERVICE.url}/query?${params}`);
  return (data.features || []).map((feat) => feat.attributes);
}
