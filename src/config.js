// ============================================================================
//  CONFIG  —  Resource Deployment Kanban
//  Mirrors the OAuth 2.0 + PKCE pattern used by Critical2TN. To use the same
//  AGOL app registration, add this app's redirect URI(s) to the Native App's
//  redirect URI list in AGOL → Content → (your app item) → Settings.
// ============================================================================

// Auto-detect redirect URI from the current window so the same build works
// on localhost, GitHub Pages, S3/CloudFront, AND Experience Builder iframes.
// You can override by setting VITE_REDIRECT_URI in `.env.local`.
function detectRedirectUri() {
  if (import.meta.env.VITE_REDIRECT_URI) return import.meta.env.VITE_REDIRECT_URI;
  if (typeof window === 'undefined') return '';
  const { origin, pathname } = window.location;
  // strip filename, keep trailing slash on the directory
  const dir = pathname.replace(/[^/]*$/, '');
  return origin + dir;
}

export const CONFIG = {
  // -- Feature service ------------------------------------------------------
  serviceUrl:
    import.meta.env.VITE_SERVICE_URL ||
    'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/Mobilization_MCC_Tracking_Resource_Repeat_View/FeatureServer/1',

  // -- OAuth 2.0 (PKCE) -----------------------------------------------------
  // Use the same clientId as Critical2TN if you've added this app's redirect
  // URI to that registration; otherwise register a new Native App in AGOL.
  clientId:     import.meta.env.VITE_CLIENT_ID || 'tP3hyVsfaw5Am3BF',
  redirectUri:  detectRedirectUri(),
  authorizeUrl: 'https://www.arcgis.com/sharing/rest/oauth2/authorize',
  tokenUrl:     'https://www.arcgis.com/sharing/rest/oauth2/token',
  signOutUrl:   'https://www.arcgis.com/sharing/rest/oauth2/signout',

  // Refresh-token lifetime in MINUTES (max 20160 = 14 days).
  tokenExpirationMinutes: 20160,
  // Refresh the access token this many ms before it actually expires.
  refreshBufferMs: 5 * 60 * 1000,
  // Auto-refresh of the resource list (set to 0 to disable).
  refreshInterval: 5 * 60 * 1000,

  // Storage keys (bumped from the Critical2TN ones so the two apps don't
  // share a token cache).
  tokenKey: 'resl_kanban_token_v1',
};

// ============================================================================
//  FIELD MAPPING — adjust to match the layer's actual schema. The status
//  field is the only one the Kanban writes to. If you don't know the exact
//  name yet, leave the placeholders and the in-app diagnostics panel will
//  print the available fields to the browser console on first load.
// ============================================================================
export const FIELDS = {
  objectId:    'OBJECTID',
  // -- Display fields shown on each card -----------------------------------
  // The board falls back gracefully if any of these don't exist on the layer
  // — it just shows whatever IS present. Update once you confirm the schema.
  resourceName: 'resource_name',     // primary label
  resourceType: 'resource_type',     // sub-label
  agency:       'agency',
  contact:      'contact_name',
  phone:        'contact_phone',
  // -- Status field the Kanban writes to -----------------------------------
  status:       'status',            // <-- confirm this against /FeatureServer/1?f=json
};

// ============================================================================
//  KANBAN COLUMNS — left-to-right order. The `value` is what gets written to
//  FIELDS.status when a card is dropped here. Tweak labels/values if the
//  feature service uses different exact strings (e.g. "On-Scene" vs "On Scene").
// ============================================================================
// Order mirrors the AGOL coded-value-domain dropdown so the board reads
// the same way as the form. If you'd rather show a workflow sequence
// (e.g. En Route → On Scene → Staged → On Hold → Demobilized → Canceled),
// just reorder this array — `value` is the only thing that has to match
// the layer's coded values exactly.
export const COLUMNS = [
  { id: 'onscene',     label: 'On Scene',    value: 'On Scene',    accent: '#059669' },
  { id: 'onhold',      label: 'On Hold',     value: 'On Hold',     accent: '#d97706' },
  { id: 'staged',      label: 'Staged',      value: 'Staged',      accent: '#0891b2' },
  { id: 'demobilized', label: 'Demobilized', value: 'Demobilized', accent: '#374151' },
  { id: 'enroute',     label: 'En Route',    value: 'En Route',    accent: '#2563eb' },
  { id: 'canceled',    label: 'Canceled',    value: 'Canceled',    accent: '#dc2626' },
];

// Map a status string from the service back to a column id (case-insensitive,
// space-insensitive). Anything that doesn't match falls into `_unassigned`.
export function statusToColumnId(rawStatus) {
  if (!rawStatus) return '_unassigned';
  const norm = String(rawStatus).toLowerCase().replace(/[\s_-]+/g, '');
  const match = COLUMNS.find(
    (c) => c.value.toLowerCase().replace(/[\s_-]+/g, '') === norm,
  );
  return match ? match.id : '_unassigned';
}
