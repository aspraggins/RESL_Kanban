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
  refreshInterval: 60 * 1000,

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
//  MCC Status Mapper — secondary service joined to a resource record by
//  MCC_number = request_number_rpt AND incidentid = mission_id_rpt.
//  Carries the original county request that the deployment fulfills.
//  Surfaced as a separate tab in the detail modal.
// ============================================================================
// ============================================================================
//  FOLLOWUP service — many-to-one with each resource. Each followup row
//  has mcc_number_text (matches request_number_rpt) and mission (matches
//  mission_id_rpt). Surfaced as the Followups tab in the detail modal.
// ============================================================================
export const FOLLOWUP_SERVICE = {
  url: import.meta.env.VITE_FOLLOWUP_URL ||
       'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/MCC_Followup/FeatureServer/0',
  fields: {
    objectId:       'objectid',
    requestNumber:  'mcc_number_text',     // join key → request_number_rpt
    mission:        'mission',             // join key → mission_id_rpt
    entryDate:      'entrydate',           // timestamp of the followup
    data:           'Followup_data',       // long-form note
    updatedBy:      'updated_by',
    updatingAgency: 'updating_agency',
    username:       'Username',
    positionName:   'positionname',
    phone:          'updating_phone',
    email:          'updating_email',
  },
};

export const MCC_SERVICE = {
  url: 'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/MCCStatusMapper2/FeatureServer/0',
  fields: {
    objectId:        'ObjectID',
    globalId:        'GlobalID',
    mccNumber:       'MCC_number',
    incidentId:      'incidentid',
    subject:         'MCC_subject',
    type:            'MCC_type',
    priority:        'MCC_priority',
    status:          'MCC_status',
    description:     'Description',
    originator:      'MCC_originator',
    mccPosition:     'MCC_position',
    mccCreated:      'MCC_created',
    entryDate:       'entrydate',
    pocName:         'pocname',
    pocPhone:        'pocPhone',
    pocTitle:        'pocTitle',
    subscriberName:  'subscribername',
    assignTo:        'assign_to',
    deliveryDate:    'deliverydate',
    deliveryTime:    'deliverytime',
    deliveryLocation:'delivery_location',
    deliveryNotes:   'DeliveryNotes',
    address:         'address',
    county:          'county',
    region:          'region',
    lifeline:        'lifeline',
    feeding:         'feeding',
    creationDate:    'CreationDate',
    creator:         'Creator',
    editDate:        'EditDate',
    editor:          'Editor',
  },
};

// ============================================================================
//  MISSION TYPE — coded values for the editable dropdown in the detail
//  modal. Must match the layer's coded-value-domain on `mission_type` exactly.
// ============================================================================
export const MISSION_TYPES = [
  'Search and Rescue',
  'Law Enforcement',
  'Firefighting',
  'Emergency Medical',
  'Public Health',
  'Hazardous Materials',
  'Incident Management',
  'Logistics',
  'Communications',
  'Recovery',
  'Debris Management',
  'Utilities Restoration',
];

// ============================================================================
//  TEAM KIND — coded values for the editable dropdown in the detail modal.
//  Selecting "Other" reveals a free-text "Other description" field that
//  writes to `resource_other` — same shape as the Survey123 form.
// ============================================================================
export const TEAM_KINDS = [
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
  'Other',
];

// ============================================================================
//  KANBAN COLUMNS — left-to-right order. The `value` is what gets written to
//  FIELDS.status when a card is dropped here. Tweak labels/values if the
//  feature service uses different exact strings (e.g. "On-Scene" vs "On Scene").
// ============================================================================
// All columns shown on the board in left-to-right order. `kind` controls
// rendering and behavior:
//   • 'mcc'        — populated from MCC_SERVICE; not a drop target.
//   • 'status'     — a deployment-status column; accepts drops; writes
//                    `value` to `item_status` on drop.
//   • 'unassigned' — deployments whose status doesn't match any status
//                    column. Accepts drops to clear `item_status`.
export const COLUMNS = [
  { id: 'mcc',         label: 'MCC',         kind: 'mcc',        accent: '#0b5fa5', defaultHidden: false },
  { id: 'onhold',      label: 'On Hold',     kind: 'status',     value: 'On Hold',     accent: '#45C8ED' },
  { id: 'staged',      label: 'Staged',      kind: 'status',     value: 'Staged',      accent: '#FCFF00' },
  { id: 'enroute',     label: 'En Route',    kind: 'status',     value: 'En Route',    accent: '#2563eb' },
  { id: 'onscene',     label: 'On Scene',    kind: 'status',     value: 'On Scene',    accent: '#228B22' },
  { id: 'demobilized', label: 'Demobilized', kind: 'status',     value: 'Demobilized', accent: '#ADADAD' },
  { id: 'canceled',    label: 'Canceled',    kind: 'status',     value: 'Canceled',    accent: '#6b7280' },
  { id: '_unassigned', label: 'Unassigned',  kind: 'unassigned', accent: '#94a3b8', defaultHidden: true },
];

// Derived: just the drag-drop status columns (used by the drop handler
// and the status-to-column mapper). Excludes MCC and Unassigned.
export const STATUS_COLUMNS = COLUMNS.filter((c) => c.kind === 'status');

// Map a status string from the service back to a column id (case-insensitive,
// space-insensitive). Anything that doesn't match falls into `_unassigned`.
export function statusToColumnId(rawStatus) {
  if (!rawStatus) return '_unassigned';
  const norm = String(rawStatus).toLowerCase().replace(/[\s_-]+/g, '');
  const match = STATUS_COLUMNS.find(
    (c) => c.value.toLowerCase().replace(/[\s_-]+/g, '') === norm,
  );
  return match ? match.id : '_unassigned';
}
