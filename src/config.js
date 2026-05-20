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

  // Survey123 form for creating a new deployment. The MCC detail modal
  // builds a deep-link to this form with MCC fields pre-filled, mirroring
  // the existing TEMA dashboard's "Copy Into New Record" action.
  resourceSurveyId: import.meta.env.VITE_RESL_SURVEY_ID
    || '7795c465abdd4840b3b6a8341abb4f48',
};

// Build a Survey123 URL that pre-fills the RESL deployment form from an
// MCC record. Field names in the URL match the form's question names
// (request_number_rpt, mission_id_rpt, etc.).
export function buildResourceSurveyUrl(mcc) {
  if (!mcc) return null;
  const f = MCC_SERVICE.fields;
  const params = new URLSearchParams();
  params.set('embed', 'fullScreen');
  params.set('hide',  'footer,navbar,field:emac');

  const setField = (key, value) => {
    if (value == null) return;
    const s = String(value).trim();
    if (!s) return;
    params.set(`field:${key}`, s);
  };

  // Try to parse mission year + number from the mission_id text
  // (typical shape: "2026 Mission #8 Severe Winter…").
  const incidentId = mcc[f.incidentId];
  if (incidentId) {
    const s = String(incidentId);
    const yearMatch   = s.match(/^(\d{4})/);
    const numberMatch = s.match(/#\s*(\d+)/);
    if (yearMatch)   setField('mission_year_rpt',   yearMatch[1]);
    if (numberMatch) setField('mission_number_rpt', numberMatch[1]);
  }

  setField('region_rpt',         mcc[f.region]);
  setField('mcc_county_rpt',     mcc[f.county]);
  setField('request_number_rpt', mcc[f.mccNumber]);
  setField('requestor_rpt',      mcc[f.requestorOrig]);
  setField('mission_id_rpt',     mcc[f.incidentId]);
  setField('search_address_rpt', mcc[f.address]);

  // entity_rpt = pocName + " " + pocTitle (matches the old dashboard).
  const pocName  = mcc[f.pocName];
  const pocTitle = mcc[f.pocTitle];
  const entity   = [pocName, pocTitle].filter(Boolean).map((x) => String(x).trim()).join(' ');
  if (entity) setField('entity_rpt', entity);

  return `https://survey123.arcgis.com/share/${CONFIG.resourceSurveyId}?${params.toString()}`;
}

// ============================================================================
//  FIELD MAPPING — matched to Mobilization_MCC_Tracking_Resource_Repeat_View
//  (FeatureServer layer 1). Pulled from the Survey123 form definition.
//  Only `status` (drag-drop writes here) and `objectId` (row identity) are
//  strictly required; everything else degrades gracefully if blank/missing.
// ============================================================================
export const FIELDS = {
  objectId:        'objectid',
  // GlobalID is the stable cross-service join key — used as the foreign
  // key on the history layer (parent_globalid) so audit rows survive any
  // future schema rebuild or service migration. Verify the exact case on
  // your layer via the `[RESL-Kanban] Layer metadata` console log — AGOL
  // uses `globalid` on most hosted feature services but some show it as
  // `GlobalID`. Update here if the layer uses a different case.
  globalId:        'globalid',

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
  // Two fields work together: the user types into `userInputAddress`,
  // which is the source of truth for "what did the user enter?". The
  // geocoder's normalized form is stored separately in `address` so
  // it can be used for joins, exports, and map display without losing
  // the user's original spelling.
  userInputAddress:'user_input_txt_rpt',
  address:         'address_geo_rpt',
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
//  FIELD_LABELS — human-readable labels keyed by AGOL field name. Used
//  by the History tab to render diffs like "Team kind: Aircraft → Other"
//  instead of the raw "team_kind" identifier. Unlisted fields fall back
//  to a humanized version of the field name (underscores → spaces,
//  initial caps), so it's safe to leave less-edited fields off this map.
// ============================================================================
export const FIELD_LABELS = {
  // Status & dates
  item_status:             'Status',
  item_mobilization:       'Mobilization date',
  item_demobilization:     'Demobilization date',
  expected_arrival:        'Expected arrival',
  expected_days_deployed:  'Expected days deployed',
  days_deployed:           'Days deployed',
  // Resource description
  resource_kind:           'Resource kind',
  resource_type:           'Resource type',
  resource_main:           'Resource main',
  resource_other:          'Other description',
  team_kind:               'Team kind',
  personnel_count:         'Personnel count',
  identifier:              'Identifier',
  equipment:               'Equipment',
  equipment_type:          'Equipment type',
  equipment_count:         'Equipment count',
  tag_number:              'Tag number',
  item:                    'Item',
  qty_item:                'Quantity',
  make:                    'Make',
  serial:                  'Serial',
  // Ownership / requesting
  entity_rpt:              'Entity',
  requestor_rpt:           'Requestor',
  requesting_entity_rpt:   'Requesting entity',
  coordinator:             'Coordinating ESF',
  vendor_rpt:              'Vendor',
  state_agency_rpt:        'State agency',
  // Location
  user_input_txt_rpt:      'Address',            // what the user typed (editable)
  address_geo_rpt:         'Geocoded address',   // Census-normalized form
  county_rpt:              'County',
  region_rpt:              'Region',
  // Mission
  mission_id_rpt:          'Mission',
  mission_detail_rpt:      'Mission detail',
  mission_number_rpt:      'Mission number',
  mission_year_rpt:        'Mission year',
  mission_type:            'Mission type',
  mission_status_rpt:      'Mission status',
  request_number_rpt:      'Request number',
  // Notes
  note_rpt:                'Note',
  resl_note:               'RESL note',
  item_mobilization_note:  'Mobilization note',
  item_demobilization_note:'Demobilization note',
};

// Humanize a raw AGOL field name as a fallback when it's not in
// FIELD_LABELS. "team_kind" → "Team kind", "MCC_number" → "MCC number".
export function labelFor(fieldName) {
  if (FIELD_LABELS[fieldName]) return FIELD_LABELS[fieldName];
  if (!fieldName) return '';
  const spaced = String(fieldName).replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
// ============================================================================
//  INVENTORY service — view-only TEMA inventory layer. Used to populate
//  the leftmost "Inventory" column on the board. Items are draggable;
//  dropping one on an MCC card creates a new Equipment deployment with
//  the inventory's tag/item/make/model fields copied across.
//
//  The layer is read-only (a hosted view), so this app never writes to
//  it. We only read for display + filter.
// ============================================================================
export const INVENTORY_SERVICE = {
  // Read URL — the view, used by fetchAllInventory to populate the
  // leftmost board column. Views often reject edits, hence the split.
  url: import.meta.env.VITE_INVENTORY_URL ||
       'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/TEMA_Assigned_Inventory_Tracking_(view_only)/FeatureServer/0',
  // Write URL — the source feature service behind the view. Used by
  // updateInventoryMobilizationStatus to push status changes (e.g.
  // when a linked deployment goes Staged → On Scene → Demobilized).
  writeUrl: import.meta.env.VITE_INVENTORY_WRITE_URL ||
            'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/service_46a68401054a4b83bf84cf959c3ee7aa/FeatureServer/0',
  fields: {
    objectId:           'objectid',
    tagNumber:          'tag_number',
    item:               'item',
    make:               'make',
    model:              'model',
    description:        'description',
    // Inventory-side status (Active / Inactive / etc.) — separate from
    // mobilization_status. Items with status='Inactive' are filtered
    // out of the available inventory list entirely.
    status:             'status',
    statusReason:       'status_reason',
    mobilizationStatus: 'mobilization_status',
  },
};

export const FOLLOWUP_SERVICE = {
  url: import.meta.env.VITE_FOLLOWUP_URL ||
       'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/MCCFollowup_v2/FeatureServer/0',
  fields: {
    objectId:       'ObjectID',
    globalId:       'GlobalID',
    requestNumber:  'mcc_no',              // join key → request_number_rpt
    mission:        'incidentid',          // join key → mission_id_rpt
    entryDate:      'entrydate',
    entryDateAlt:   'entry_date',
    data:           'Followup_data',       // long-form note
    updatedBy:      'updated_by',          // author display name
    updatingAgency: 'updating_agency',
    email:          'updating_email',
    subscriberName: 'subscribername',
    positionId:     'positionid',
    // v1 fields removed in v2: Username, positionname, updating_phone
  },
};

// ============================================================================
//  HISTORY service — audit log of every edit made through this app.
//  Schema mirrors the resource layer (so each row is a full snapshot of
//  the record at the time of edit), with seven extra audit fields tacked
//  on. Create this in AGOL as a new hosted feature service — easiest is
//  "Save As" from the parent Mobilization_MCC_Tracking_Resource service,
//  then add the audit fields under the History layer's Data tab. See
//  HISTORY_LOG_SETUP.md for the full field list.
//
//  Set `enabled: false` (or leave VITE_HISTORY_URL blank and the default
//  URL pointing at a service that doesn't exist) to silence history
//  writes — they're fire-and-forget and never block an edit either way.
// ============================================================================
export const HISTORY_SERVICE = {
  url: import.meta.env.VITE_HISTORY_URL ||
       'https://services1.arcgis.com/kILp9lqGUeOhnDbI/ArcGIS/rest/services/RESL_Edit_Tracking/FeatureServer/1',
  enabled: true,
  // The seven audit fields the app writes on top of the resource-layer
  // snapshot. Rename here if your feature service uses different names.
  audit: {
    // GlobalID of the parent record — the stable foreign key into the
    // resource layer. Type on the history layer must be GUID (not String).
    parentGlobalId: 'parent_globalid',
    sourceOid:      'source_oid',      // ObjectID of the parent (debugging breadcrumb; not the primary join key)
    action:         'edit_action',     // 'edit' | 'status_change' (AGOL rejects "action" — SQL keyword)
    changedFields:  'changed_fields',  // CSV of field names that actually changed
    changedBy:      'changed_by',      // Full name from the AGOL OAuth profile
    changeTs:       'change_ts',       // epoch ms when the change happened
    prevStatus:     'prev_status',     // status before (handy for status flow)
    newStatus:      'new_status',      // status after  (handy for status flow)
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
    requestorOrig:   'orig_pos',    // Survey123 mapping → requestor_rpt
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
  // Leftmost column — TEMA assigned inventory. Cards are draggable;
  // dropping one on an MCC card creates a new Equipment deployment
  // (which lands in Unassigned just to the right).
  { id: 'inventory',   label: 'Inventory',   kind: 'inventory',  accent: '#7c3aed', defaultHidden: false },
  { id: 'mcc',         label: 'MCC',         kind: 'mcc',        accent: '#0b5fa5', defaultHidden: false },
  // Unassigned sits next to MCC because newly-created inventory
  // deployments land here for triage — dragging into a real status
  // column is the next step.
  { id: '_unassigned', label: 'Unassigned',  kind: 'unassigned', accent: '#94a3b8', defaultHidden: false },
  // Default-hidden statuses (still toggleable via the Columns control):
  // On Hold, Staged, and Canceled are typically less relevant to the
  // active operations view. En Route / On Scene / Demobilized stay
  // visible on first load so the board reads as "where's everything
  // moving and what's wrapped up". Toggle in the Columns picker to
  // reveal the rest.
  { id: 'onhold',      label: 'On Hold',     kind: 'status',     value: 'On Hold',     accent: '#45C8ED', defaultHidden: true },
  { id: 'staged',      label: 'Staged',      kind: 'status',     value: 'Staged',      accent: '#FCFF00', defaultHidden: true },
  { id: 'enroute',     label: 'En Route',    kind: 'status',     value: 'En Route',    accent: '#2563eb' },
  { id: 'onscene',     label: 'On Scene',    kind: 'status',     value: 'On Scene',    accent: '#228B22' },
  { id: 'demobilized', label: 'Demobilized', kind: 'status',     value: 'Demobilized', accent: '#ADADAD' },
  { id: 'canceled',    label: 'Canceled',    kind: 'status',     value: 'Canceled',    accent: '#6b7280', defaultHidden: true },
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
