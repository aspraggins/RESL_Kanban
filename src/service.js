// ============================================================================
//  SERVICE — talks to the AGOL feature service. Uses the cached OAuth token
//  on every request and silently refreshes once on a 498/499 response.
// ============================================================================

import { CONFIG, FIELDS, MCC_SERVICE, FOLLOWUP_SERVICE, HISTORY_SERVICE } from './config.js';
import { getToken, ensureFreshToken, clearStoredToken } from './auth.js';
import { lookupTnCountyByName } from './regions.js';

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

// ─── History audit log ────────────────────────────────────────────────
// Fire-and-forget writer that appends a row to the history feature
// service for every successful edit. Never throws — any failure is
// logged to the console so a history-service hiccup can't break a
// normal edit. The history row is a full snapshot of the resource
// record (post-edit) plus seven audit metadata fields. See
// HISTORY_SERVICE in src/config.js and HISTORY_LOG_SETUP.md for the
// schema you need on the AGOL feature service.
async function logHistory({ before, after, action, changed }) {
  if (!HISTORY_SERVICE.enabled || !HISTORY_SERVICE.url) return;
  try {
    await ensureFreshToken();
    const TOKEN = getToken();
    const a = HISTORY_SERVICE.audit;

    // Snapshot every field from the post-edit record so each history
    // row is self-contained — you can reconstruct any past state by
    // reading a single row, no joins required. We iterate `after`
    // directly (not just FIELDS-mapped names) so the snapshot captures
    // every real field on the layer, including ones we don't reference
    // explicitly in code (e.g. resource_other appears when team_kind
    // = "Other" but isn't in our FIELDS map).
    //
    // Skip system-managed fields: AGOL controls these on the history
    // layer just like it does on the resource layer, and writes to
    // them are either ignored or rejected. ObjectID + GlobalID are
    // surfaced separately via source_oid / parent_globalid below.
    const SYSTEM_FIELDS = new Set([
      FIELDS.objectId, FIELDS.globalId,
      FIELDS.creationDate, FIELDS.creator,
      FIELDS.editDate,     FIELDS.editor,
      // Case-variant fallbacks — AGOL is sometimes inconsistent.
      'objectid', 'OBJECTID', 'globalid', 'GlobalID', 'GLOBALID',
      'CreationDate', 'Creator', 'EditDate', 'Editor',
    ]);
    const snapshot = {};
    if (after && typeof after === 'object') {
      for (const fieldName of Object.keys(after)) {
        if (SYSTEM_FIELDS.has(fieldName)) continue;
        snapshot[fieldName] = after[fieldName];
      }
    }

    // Primary join key (parent_globalid) and debugging breadcrumb
    // (source_oid). GlobalID is stable across schema rebuilds; ObjectID
    // isn't, so the GlobalID is the one you should join on downstream.
    const parentGid =
      (before && before[FIELDS.globalId]) ??
      (after  && after[FIELDS.globalId])  ?? null;
    const parentOid =
      (before && before[FIELDS.objectId]) ??
      (after  && after[FIELDS.objectId])  ?? null;

    const attrs = {
      ...snapshot,
      [a.parentGlobalId]: parentGid,
      [a.sourceOid]:      parentOid,
      [a.action]:        action,
      [a.changedFields]: (changed || []).join(','),
      // Prefer fullName (e.g. "John Smith") over the AGOL username
      // (e.g. "jsmith_tema") so the audit log is human-readable.
      // fullName is populated by _fetchProfileInto() in auth.js — falls
      // back to username for older cached tokens that pre-date that.
      [a.changedBy]:     (TOKEN && (TOKEN.fullName || TOKEN.username)) || null,
      [a.changeTs]:      Date.now(),
      [a.prevStatus]:    before ? (before[FIELDS.status] ?? null) : null,
      [a.newStatus]:     after  ? (after[FIELDS.status]  ?? null) : null,
    };

    const body = new URLSearchParams({
      f:        'json',
      token:    TOKEN.accessToken,
      features: JSON.stringify([{ attributes: attrs }]),
    });
    const data = await arcgisFetch(`${HISTORY_SERVICE.url}/addFeatures`, {
      method:  'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const result = (data.addResults && data.addResults[0]) || null;
    if (!result || !result.success) {
      console.warn('[RESL-Kanban] history log failed:', result && result.error);
    }
  } catch (err) {
    console.warn('[RESL-Kanban] history log error:', err);
  }
}

// Update arbitrary attributes on a single feature via applyEdits.
// `partial` is an object of { fieldName: newValue } pairs.
// `before` (optional) is the pre-edit row attributes — passing it lets
// the history log diff old vs. new and capture a full snapshot.
// `geometry` (optional) is an ArcGIS geometry object (e.g.
// { x, y, spatialReference: { wkid: 4326 } }) — pass it when the edit
// should move the record's point on the map (geocoded address change).
export async function updateAttributes(objectId, partial, before, geometry) {
  await ensureFreshToken();
  const TOKEN = getToken();

  const attributes = {
    [FIELDS.objectId]: objectId,
    ...partial,
  };
  const update = geometry ? { attributes, geometry } : { attributes };
  const body = new URLSearchParams({
    f:        'json',
    token:    TOKEN.accessToken,
    updates:  JSON.stringify([update]),
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

  // History log — only fields that actually changed (when we have a
  // `before` snapshot to compare against). Fire-and-forget; we never
  // await the result so a slow history service doesn't slow the UI.
  let changed = Object.keys(partial);
  if (before) {
    changed = changed.filter((k) => before[k] !== partial[k]);
  }
  if (changed.length > 0) {
    const after = before
      ? { ...before, ...partial }
      : { [FIELDS.objectId]: objectId, ...partial };
    // Tag the action as 'status_change' whenever the status field is
    // part of the write — even if there are derived side-effect fields
    // along with it (e.g. dropping into Demobilized stamps the demob
    // date and recalcs days_deployed in the same applyEdits). The
    // History UI's transition view (prev → new) is the right read for
    // the user in that case; the side-effect fields still get listed
    // in changed_fields so they're recoverable from the row data.
    const includesStatus = changed.includes(FIELDS.status);
    logHistory({
      before,
      after,
      action: includesStatus ? 'status_change' : 'edit',
      changed,
    });
  }

  return result;
}

// Convenience wrapper used by the drag-drop handler. Pass `before` (the
// pre-edit row) so the history log can capture a full snapshot and the
// prev/new status fields.
export async function updateStatus(objectId, newStatus, before) {
  return updateAttributes(objectId, { [FIELDS.status]: newStatus }, before);
}

// ─── Geocoder (ArcGIS World Geocoder) ─────────────────────────────────
// Two endpoints power the address typeahead UI in the detail modal:
//
//   • suggestAddresses(text)  → autocomplete; returns up to 6 suggestions,
//     each carrying a `magicKey` that uniquely identifies one record in
//     the geocoder's index. Free to call (no token / credits).
//   • geocodeAddress(text, { magicKey }) → resolves to coordinates plus
//     attributes. forStorage=true (per ESRI's terms for saving coords to
//     a feature service) and a valid AGOL token are required for the
//     write path; consumes a credit per call.
//
// Suggestions and the final geocode are biased toward Tennessee via a
// `location` hint roughly at the state's geographic center. The bias
// re-ranks; it doesn't exclude out-of-state addresses.
// Use the standard `geocode.arcgis.com` host (not `geocode-api`) — the
// `-api` host is for the new API-key-only product and is pickier about
// CORS for the suggest endpoint. The standard host accepts both
// anonymous suggest requests AND OAuth-token forStorage geocode
// requests, which is what we want.
const ESRI_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';
// Rough centroid of TN — picked from the regions.csv county centroids
// and rounded. Used as the `location` bias hint on suggest + geocode.
const TN_BIAS_LOCATION = '-86.6,35.86';

export async function suggestAddresses(text, { signal } = {}) {
  const q = (text || '').trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    f:              'json',
    text:           q,
    countryCode:    'USA',
    maxSuggestions: '6',
    location:       TN_BIAS_LOCATION,
    // No `category` filter — leaving it off lets the geocoder return
    // its full set of guesses (street addresses, intersections, places,
    // postal codes). Filtering tends to swallow partial matches.
  });

  console.info('[RESL-Kanban] suggest:', q);
  const res = await fetch(`${ESRI_GEOCODER}/suggest?${params}`, { signal });
  if (!res.ok) throw new Error(`Suggest HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Suggest error');
  console.info('[RESL-Kanban] suggest →', (data.suggestions || []).length, 'results');
  return (data.suggestions || []).map((s) => ({
    text:         s.text,
    magicKey:     s.magicKey,
    isCollection: !!s.isCollection,
  }));
}

export async function geocodeAddress(textOrEmpty, { magicKey } = {}) {
  const text = (textOrEmpty || '').trim();
  if (!text && !magicKey) return null;

  // The ArcGIS geocoder needs a token for the storage-permitted path.
  // We refresh first so the call never fails on a stale token. If the
  // user isn't signed in (shouldn't happen in the app's normal flow),
  // we still try without — useful for testing.
  let token = null;
  try {
    await ensureFreshToken();
    token = (getToken() && getToken().accessToken) || null;
  } catch { /* unauthenticated — proceed without token */ }

  const params = new URLSearchParams({
    f:           'json',
    outFields:   'Match_addr,Subregion,Region,RegionAbbr,Country,Place_addr,PlaceName,Type',
    forStorage:  'true',
    maxLocations:'1',
    location:    TN_BIAS_LOCATION,
    countryCode: 'USA',
  });
  // magicKey beats free text — it's an exact pointer into the index.
  if (magicKey) {
    params.set('magicKey', magicKey);
    if (text) params.set('singleLine', text);
  } else {
    params.set('singleLine', text);
  }
  if (token) params.set('token', token);

  const res = await fetch(`${ESRI_GEOCODER}/findAddressCandidates?${params}`);
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Geocode error');

  const candidates = data.candidates || [];
  if (candidates.length === 0) return null;
  const c = candidates[0];

  const attrs = c.attributes || {};
  const countyName = String(attrs.Subregion || '').trim();
  const stateName  = String(attrs.Region    || '').trim();
  const stateAbbr  = String(attrs.RegionAbbr || '').trim().toUpperCase();
  const isTn = stateAbbr === 'TN' || stateName.toLowerCase() === 'tennessee';
  const tn = isTn ? lookupTnCountyByName(countyName) : null;

  return {
    matchedAddress: attrs.Match_addr || c.address || text,
    lng:            c.location && c.location.x,
    lat:            c.location && c.location.y,
    rawCounty:      countyName,
    rawState:       stateName,
    // Normalized values: prefer the regions.csv form so casing/spelling
    // matches whatever the rest of the system already uses.
    county:         tn ? tn.county : (isTn ? countyName : null),
    region:         tn ? tn.region : null,
    isTn,
  };
}

// ─── History (audit log) reader ───────────────────────────────────────
// Fetch every history row tied to one resource, newest first. Joined
// by parent_globalid (the stable cross-service key) — pass the row's
// GlobalID, NOT its ObjectID, since ObjectIDs can drift across schema
// rebuilds and don't match between the source layer and a View.
//
// AGOL is finicky about GUID literals in SQL: the curly braces are
// optional and some services strip them, others require them. We try
// the bare form first since that's what hosted feature services return
// in query results, and fall back to a braced form on empty results.
// Either way, single quotes are required around the GUID.
export async function fetchHistory({ globalId }) {
  if (!globalId) return [];
  if (!HISTORY_SERVICE.url) return [];

  await ensureFreshToken();
  const TOKEN = getToken();
  const a = HISTORY_SERVICE.audit;

  // Strip braces if present; we'll add them back on the fallback try.
  const bare = String(globalId).replace(/[{}]/g, '').toUpperCase();

  const runQuery = async (whereLiteral) => {
    const params = new URLSearchParams({
      where:          `${a.parentGlobalId} = '${whereLiteral}'`,
      outFields:      '*',
      returnGeometry: 'false',
      orderByFields:  `${a.changeTs} DESC`,
      f:              'json',
      token:          TOKEN.accessToken,
    });
    const data = await arcgisFetch(`${HISTORY_SERVICE.url}/query?${params}`);
    return (data.features || []).map((feat) => feat.attributes);
  };

  try {
    let rows = await runQuery(bare);
    if (rows.length === 0) {
      // Some AGOL services store the parent_globalid with braces — try
      // the braced form once before declaring the history empty.
      rows = await runQuery(`{${bare}}`);
    }
    return rows;
  } catch (err) {
    console.warn('[RESL-Kanban] fetchHistory failed:', err);
    throw err;
  }
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

// Fetch every MCC record on the MCC layer (paged). Excludes drafts
// (NULL or 0 MCC_number) the same way fetchMccsForMission does, so the
// two return shapes are consistent. Used at app startup to populate
// the mission picker — every distinct incidentid becomes a row in
// the picker, whether or not it has resource deployments yet.
export async function fetchAllMccs() {
  await ensureFreshToken();
  const TOKEN = getToken();
  const f = MCC_SERVICE.fields;

  const where =
    `${f.mccNumber} IS NOT NULL ` +
    `AND ${f.mccNumber} > 0`;

  const allFeatures = [];
  const pageSize = 2000;
  let offset = 0;
  let more   = true;
  let safety = 50;
  while (more && safety-- > 0) {
    const params = new URLSearchParams({
      where,
      outFields:         '*',
      returnGeometry:    'false',
      f:                 'json',
      resultOffset:      String(offset),
      resultRecordCount: String(pageSize),
      token:             TOKEN.accessToken,
    });
    const data = await arcgisFetch(`${MCC_SERVICE.url}/query?${params}`);
    const feats = data.features || [];
    allFeatures.push(...feats);
    more = (data.exceededTransferLimit === true) || (feats.length === pageSize);
    offset += feats.length;
    if (feats.length === 0) break;
  }
  return allFeatures.map((feat) => feat.attributes);
}

// Fetch MCC records for a given mission (incidentid). Drafts without an
// MCC_number are excluded — those aren't official yet and shouldn't
// surface as candidates for deployment.
export async function fetchMccsForMission(missionId) {
  if (!missionId) return [];
  await ensureFreshToken();
  const TOKEN = getToken();
  const f = MCC_SERVICE.fields;
  const safeMis = String(missionId).replace(/'/g, "''");
  const where =
    `${f.incidentId} = '${safeMis}' ` +
    `AND ${f.mccNumber} IS NOT NULL ` +
    `AND ${f.mccNumber} > 0`;
  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'false',
    orderByFields:  `${f.mccNumber} ASC`,
    f:              'json',
    token:          TOKEN.accessToken,
  });
  const data = await arcgisFetch(`${MCC_SERVICE.url}/query?${params}`);
  // Defensive client-side filter in case the service ever returns rows
  // with NULL or 0 MCC_number despite the WHERE clause.
  return (data.features || [])
    .map((feat) => feat.attributes)
    .filter((m) => {
      const n = Number(m[f.mccNumber]);
      return Number.isFinite(n) && n > 0;
    });
}

// Add a new feature to the followups service. `attributes` is an
// object keyed by AGOL field names. Returns the addResults entry on
// success; throws on failure.
export async function addFollowup(attributes) {
  await ensureFreshToken();
  const TOKEN = getToken();

  console.info('[Followup] posting to:', FOLLOWUP_SERVICE.url);
  console.info('[Followup] attributes:', attributes);

const body = new URLSearchParams({
  f: 'json',
  token: TOKEN.accessToken,
  features: JSON.stringify([{
    attributes,
    geometry: {
      x: -86.75858458743868,
      y: 36.0983205868823,
      spatialReference: { wkid: 4326 },
    },
  }]),
});
  const data = await arcgisFetch(`${FOLLOWUP_SERVICE.url}/addFeatures`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  console.info('[Followup] raw addFeatures response:', data);

  const result =
    (data.addResults && data.addResults[0]) || null;

  if (!result || !result.success) {
    const msg = result && result.error
      ? `${result.error.code}: ${result.error.description}`
      : 'Add failed';

    throw new Error(msg);
  }

  const oid = result.objectId ?? result.objectid;

  console.info('[Followup] created ObjectID:', oid);

  // immediate verification query
  try {
    const verifyParams = new URLSearchParams({
      objectIds: String(oid),
      outFields: '*',
      returnGeometry: 'false',
      f: 'json',
      token: TOKEN.accessToken,
    });

    const verify = await arcgisFetch(
      `${FOLLOWUP_SERVICE.url}/query?${verifyParams}`
    );

    console.info('[Followup] verify query response:', verify);
  } catch (verifyErr) {
    console.warn('[Followup] verify query failed:', verifyErr);
  }

  return result;
}

// Fetch ALL followups for a given mission in one query. Used to power
// the "last followup" timestamp shown on each MCC card without hitting
// the service N times.
export async function fetchFollowupsForMission(missionId) {
  if (!missionId) return [];
  await ensureFreshToken();
  const TOKEN = getToken();
  const f = FOLLOWUP_SERVICE.fields;
  const safeMis = String(missionId).replace(/'/g, "''");
  const where = `${f.mission} = '${safeMis}'`;
  const params = new URLSearchParams({
    where,
    outFields:      '*',
    returnGeometry: 'false',
    f:              'json',
    token:          TOKEN.accessToken,
  });
  const data = await arcgisFetch(`${FOLLOWUP_SERVICE.url}/query?${params}`);
  return (data.features || []).map((feat) => feat.attributes);
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
