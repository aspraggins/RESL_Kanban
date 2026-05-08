// ============================================================================
//  CONFIG  —  Resource Deployment Status
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
  // App ID for the dedicated AGOL "Resource Deployment Status" registration.
  // Override at build time with VITE_CLIENT_ID (set as a GitHub Actions
  // repo variable) if you register a separate app for staging/production.
  clientId:     import.meta.env.VITE_CLIENT_ID || 'ylEHpMx1WynLwVf2',
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
//  FIELD MAPPING — matched to Mobilization_MCC_Tracking_Resource_Repeat_View
//  (FeatureServer layer 1). Pulled from the Survey123 form definition.
//  Only `status` (drag-drop writes here) and `objectId` (row identity) are
//  strictly required; everything else degrades gracefully if blank/missing.
// ============================================================================
export const FIELDS = {
  objectId:        'objectid',

  // -- Header / identity ---------------------------------------------------
  requestNumber:   'request_number_rpt',   // "#312"
  missionId:       'mission_id_rpt',       // Mission Name
  missionDetail:   'mission_detail_rpt',
  missionNumber:   'mission_number_rpt',
  missionYear:     'mission_year_rpt',

  // -- Resource description -----------------------------------------------
  kind:            'resource_kind',        // "Equipment" / "Team"
  resourceType:    'resource_type',
  resourceMain:    'resource_main',
  // Equipment-specific
  equipmentName:   'equipment',
  equipmentType:   'equipment_type',
  equipmentCount:  'equipment_count',
  // Team / Personnel
  teamKind:        'team_kind',
  personnelCount:  'personnel_count',
  identifier:      'identifier',           // Personnel or Team Name
  // Tagged inventory
  tagNumber:       'tag_number',
  item:            'item',
  qtyItem:         'qty_item',
  make:            'make',
  serial:          'serial',

  // -- Ownership / requesting -------------------------------------------
  entity:          'entity_rpt',           // operating entity
  requestor:       'requestor_rpt',
  requestingEntity:'requesting_entity_rpt',
  esf:             'coordinator',          // Coordinating ESF (select_one esf_list)

  // -- Location -----------------------------------------------------------
  county:          'county_rpt',
  region:          'region_rpt',

  // -- Mobilization status & timing --------------------------------------
  daysDeployed:    'days_deployed',
  expectedDays:    'expected_days_deployed',
  expectedArrival: 'expected_arrival',
  editDate:        'EditDate',

  // -- Notes & audit ------------------------------------------------------
  note:            'note_rpt',
  reslNote:        'resl_note',
  vendor:          'vendor_rpt',
  stateAgency:     'state_agency_rpt',
  itemMobilization:'item_mobilization',
  itemDemobilization:'item_demobilization',
  missionStatus:   'mission_status_rpt',
  creationDate:    'CreationDate',
  creator:         'Creator',
  editor:          'Editor',

  // -- Editable fields ----------------------------------------------------
  missionType:     'mission_type',

  // -- Status (Kanban writes here) ---------------------------------------
  status:          'item_status',
};

// ============================================================================
//  MISSION TYPE — coded values for the editable dropdown in the detail
//  modal. Must match the layer's coded-value-domain on `mission_type` exactly.
// ============================================================================
export const MISSION_TYPES = [
  'Aircraft',
  'Ambulance Strike Teams',
  'Border Support',
  'Communications',
  'Cut and Toss',
  'Debris Removal',
  'EMAC A-Team',
  'EOC Support',
  'Equipment Only',
  'Firefighting Resources',
  'HART',
  'Incident Management Team',
  'Law Enforcement',
  'Medical Personnel',
  'Mental Health Strike Team',
  'Military Police',
  'National Guard',
  'Other',
  'Pharmacist',
  'Public Assistance Team',
  'Public Health Nurses',
  'Public Information',
  'Public Works',
  'Shelter Support',
  'Swift Water Rescue',
  'TERT',
  'Transportation',
  'US&R',
];

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
