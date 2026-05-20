import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { COLUMNS, STATUS_COLUMNS, FIELDS, CONFIG, statusToColumnId, MCC_SERVICE, FOLLOWUP_SERVICE, INVENTORY_SERVICE } from '../config.js';
import { fetchAllResources, fetchAllMccs, fetchAllInventory, fetchLayerMeta, updateAttributes, createDeploymentFromInventory, updateInventoryMobilizationStatus, fetchMccsForMission, fetchFollowupsForMission } from '../service.js';
import Column from './Column.jsx';
import Card from './Card.jsx';
import MccColumn from './MccColumn.jsx';
import MccDetailModal from './MccDetailModal.jsx';
import InventoryColumn from './InventoryColumn.jsx';
import { MainFilters, SortToggle, ColumnToggles } from './FilterBar.jsx';
import MissionPicker from './MissionPicker.jsx';
import Brand from './Brand.jsx';
import DetailModal from './DetailModal.jsx';

const EMPTY_FILTERS = { mission: '', esf: '', county: '', kind: '', search: '' };

// "Today" expressed as UTC midnight in epoch ms. AGOL stores
// item_mobilization / item_demobilization at UTC midnight, so we encode
// today's *local* calendar date (not the user's clock-now) the same way
// to stay consistent with the modal's date picker.
function todayUtcMidnightMs() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// Mirrors recalcDaysDeployed in DetailModal — Survey123's formula is
// floor((demob - mob) / 1 day). Returns null when either side is
// missing or non-numeric so callers can skip the write.
function daysBetween(mob, demob) {
  const m = Number(mob);
  const d = Number(demob);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Math.floor((d - m) / 86_400_000);
}

// Filters that can be locked via URL search parameters. Search is
// always user-editable.
const LOCKABLE_FILTERS = ['mission', 'esf', 'county', 'kind'];

// Allowed-missions scope: `?missions=A,B,C` constrains both the
// mission picker and the Mission dropdown to those values only. The
// user can still switch between them; they just can't see any others.
// Returns null when not set, otherwise an array of mission names.
function readUrlMissionScope() {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('missions');
  if (!raw) return null;
  const parts = raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

// Read-only mode: `?readonly=1` (or true/yes) disables drag-drop and
// hides editable controls in the detail modal. Useful for embedding a
// safe public-or-stakeholder view that can't accidentally mutate data.
function readUrlReadOnly() {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get('readonly');
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// Hide the inventory column entirely (skips the fetch, removes the
// column from the board AND from the Columns toggle menu) when
// `?hide_inventory=1` (or true/yes/on) is in the URL. Lets you embed
// scoped views — e.g. a stakeholder-facing board — without the
// inventory tooling visible.
function readUrlHideInventory() {
  if (typeof window === 'undefined') return false;
  const v = new URLSearchParams(window.location.search).get('hide_inventory');
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// Read URL parameters once at boot. Any LOCKABLE_FILTER key present
// in `?mission=...&esf=...` becomes both the initial value AND a
// locked filter the user can't change in-session. Allows sharing or
// embedding scoped views (e.g. one mission, one ESF).
function readUrlFilters() {
  if (typeof window === 'undefined') {
    return { values: {}, locked: new Set() };
  }
  const params = new URLSearchParams(window.location.search);
  const values = {};
  const locked = new Set();
  for (const key of LOCKABLE_FILTERS) {
    const raw = params.get(key);
    if (raw == null) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    values[key] = trimmed;
    locked.add(key);
  }
  return { values, locked };
}

const SEARCHABLE = [
  'request_number_rpt', 'mission_id_rpt', 'mission_detail_rpt',
  'tag_number', 'item', 'make', 'serial', 'identifier',
  'equipment', 'equipment_type', 'team_kind',
  'entity_rpt', 'requestor_rpt', 'requesting_entity_rpt',
  'county_rpt', 'region_rpt', 'coordinator',
  'resource_main', 'resource_type',
];

// Sort comparators ----------------------------------------------------
// Most recent EditDate first; missing → end.
function cmpUpdated(a, b) {
  const av = Number(a.EditDate);
  const bv = Number(b.EditDate);
  const ag = Number.isFinite(av) && av > 0;
  const bg = Number.isFinite(bv) && bv > 0;
  if (!ag && !bg) return 0;
  if (!ag) return 1;
  if (!bg) return -1;
  return bv - av;
}
// Lowest request_number_rpt first (numeric when possible); missing → end.
function cmpRequest(a, b) {
  const av = parseFloat(a.request_number_rpt);
  const bv = parseFloat(b.request_number_rpt);
  const ag = Number.isFinite(av);
  const bg = Number.isFinite(bv);
  if (!ag && !bg) {
    return String(a.request_number_rpt || '').localeCompare(
      String(b.request_number_rpt || ''),
      undefined, { numeric: true, sensitivity: 'base' },
    );
  }
  if (!ag) return 1;
  if (!bg) return -1;
  return av - bv;
}

// Normalize for filter comparison: trim, lowercase, collapse runs of
// whitespace. Helps URL-driven filters tolerate small differences like
// case, accidental double-spaces, or trailing whitespace from copy/paste.
function n(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Apply the active filters to an MCC record. Mission is already
// applied at fetch time. ESF and Kind have no direct mapping on the
// MCC schema so they're treated as no-ops here (otherwise filtering
// by Equipment would always empty the MCC column).
function mccMatches(m, f) {
  if (!m) return false;
  const mf = MCC_SERVICE.fields;
  if (f.county && n(m[mf.county]) !== n(f.county)) return false;
  if (f.search) {
    const raw = f.search.trim();
    if (raw.startsWith('#')) {
      const num = raw.slice(1).toLowerCase();
      if (num === '') return true;
      const reqNum = String(m[mf.mccNumber] ?? '').toLowerCase();
      return reqNum === num;
    }
    const q = raw.toLowerCase();
    const haystacks = [
      mf.mccNumber, mf.subject, mf.description, mf.type, mf.priority,
      mf.county, mf.region, mf.pocName, mf.pocTitle, mf.subscriberName,
      mf.originator, mf.assignTo, mf.address,
    ];
    let hit = false;
    for (const k of haystacks) {
      const v = m[k];
      if (v == null) continue;
      if (String(v).toLowerCase().includes(q)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

function rowMatches(r, f) {
  if (f.mission && n(r.mission_id_rpt) !== n(f.mission)) return false;
  if (f.esf     && n(r.coordinator)    !== n(f.esf))     return false;
  if (f.county  && n(r.county_rpt)     !== n(f.county))  return false;
  if (f.kind    && n(r.resource_kind)  !== n(f.kind))    return false;
  if (f.search) {
    const raw = f.search.trim();

    // `#NNN` shortcut: exact match against the request number field.
    // Bare `#` is treated as no filter so the user isn't surprised by
    // an empty board while they're still typing.
    if (raw.startsWith('#')) {
      const num = raw.slice(1).toLowerCase();
      if (num === '') return true;
      const reqNum = String(r.request_number_rpt || '').toLowerCase();
      return reqNum === num;
    }

    const q = raw.toLowerCase();
    let hit = false;
    for (const k of SEARCHABLE) {
      const v = r[k];
      if (v == null) continue;
      if (String(v).toLowerCase().includes(q)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

export default function Board({ onSignOut }) {
  const [resources,    setResources]     = useState([]);
  const [loading,      setLoading]       = useState(true);
  const [error,        setError]         = useState('');
  const [activeId,     setActiveId]      = useState(null);
  const [pending,      setPending]       = useState(() => new Set());
  const [lastRefresh,  setLastRefresh]   = useState(null);
  // Initial filters and locked-filter set come from URL params, if any.
  const [{ filters, lockedFilters }, setFilterState] = useState(() => {
    const { values, locked } = readUrlFilters();
    return {
      filters: { ...EMPTY_FILTERS, ...values },
      lockedFilters: locked,
    };
  });
  // Stable setter that preserves locked values regardless of caller intent.
  const setFilters = useCallback((next) => {
    setFilterState((prev) => {
      const merged = typeof next === 'function' ? next(prev.filters) : next;
      const enforced = { ...merged };
      for (const k of prev.lockedFilters) {
        enforced[k] = prev.filters[k];
      }
      return { ...prev, filters: enforced };
    });
  }, []);

  // Default-hide any column flagged defaultHidden in the COLUMNS
  // config. When the URL has ?hide_inventory=1 we also default-hide
  // the Unassigned column since it's the landing pad for inventory
  // drops — pointless to show on a board where that workflow doesn't
  // exist. The user can still toggle Unassigned back on via the
  // Columns control if they want.
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    const s = new Set();
    for (const c of COLUMNS) if (c.defaultHidden) s.add(c.id);
    if (readUrlHideInventory()) s.add('_unassigned');
    return s;
  });
  const [sortBy,       setSortBy]        = useState('updated'); // 'updated' | 'request'
  const [detailRow,    setDetailRow]     = useState(null);
  const [mccs,         setMccs]          = useState([]);
  // Every MCC across every mission — used by the mission picker so a
  // mission shows up as soon as the first MCC is filed, even if no
  // deployments exist yet. Loaded once at startup alongside resources.
  const [allMccs,      setAllMccs]       = useState([]);
  // Inventory items (TEMA assigned inventory layer) — populates the
  // leftmost column. `pendingInventoryTags` tracks tags whose
  // create-deployment is in flight so the inventory card can render
  // as "Deploying…" until the resource list refreshes.
  const [inventoryItems,      setInventoryItems]      = useState([]);
  const [pendingInventoryTags, setPendingInventoryTags] = useState(() => new Set());
  const [mccDetailRow, setMccDetailRow]  = useState(null);
  const [missionFollowups, setMissionFollowups] = useState([]);
  const [readOnly]     = useState(() => readUrlReadOnly());
  const [allowedMissions] = useState(() => readUrlMissionScope());
  // URL-driven kill switch for the inventory column. Read once at
  // boot; baked into `disabledColumnIds` for the render + toggle paths.
  const [hideInventory] = useState(() => readUrlHideInventory());
  const disabledColumnIds = useMemo(
    () => new Set(hideInventory ? ['inventory'] : []),
    [hideInventory],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const refresh = useCallback(async () => {
    try {
      setError('');
      // Load resources + all-MCCs in parallel so the picker can show
      // missions sourced from MCCs (with deployment counts from
      // resources) on the first paint. MCC failure is non-fatal — we
      // log and proceed with an empty MCC list so the picker still
      // works off the resources fallback below.
      // Inventory fetch is skipped when ?hide_inventory=1 — no point
      // burning bandwidth on a list we won't render. Still tracked
      // here so the inventory state stays as an empty array.
      const [resData, mccData, invData] = await Promise.all([
        fetchAllResources(),
        fetchAllMccs().catch((err) => {
          console.warn('[RESL-Kanban] fetchAllMccs failed:', err);
          return [];
        }),
        hideInventory
          ? Promise.resolve([])
          : fetchAllInventory().catch((err) => {
              console.warn('[RESL-Kanban] fetchAllInventory failed:', err);
              return [];
            }),
      ]);
      setResources(resData);
      setAllMccs(mccData);
      setInventoryItems(invData);
      setLastRefresh(new Date());
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLayerMeta().catch((err) => console.warn('Layer meta failed:', err));
    refresh();
    if (!CONFIG.refreshInterval) return;
    const id = setInterval(refresh, CONFIG.refreshInterval);
    return () => clearInterval(id);
  }, [refresh]);

  // Fetch MCC records AND all mission followups whenever the selected
  // mission changes; refresh on the same cadence as the kanban data
  // when the MCC column is visible. Followups are used to surface the
  // "Last followup" timestamp on each MCC card.
  useEffect(() => {
    if (!filters.mission) { setMccs([]); setMissionFollowups([]); return; }
    if (hiddenColumns.has('mcc')) return;
    let cancelled = false;
    const load = () => {
      fetchMccsForMission(filters.mission)
        .then((data) => { if (!cancelled) setMccs(data); })
        .catch((err) => console.warn('MCC fetch failed:', err));
      fetchFollowupsForMission(filters.mission)
        .then((data) => { if (!cancelled) setMissionFollowups(data); })
        .catch((err) => console.warn('Mission followups fetch failed:', err));
    };
    load();
    if (!CONFIG.refreshInterval) return () => { cancelled = true; };
    const id = setInterval(load, CONFIG.refreshInterval);
    return () => { cancelled = true; clearInterval(id); };
  }, [filters.mission, hiddenColumns]);

  // Maps of "<mcc number>" → (latest followup epoch ms) and
  // (followup count). Reads through FOLLOWUP_SERVICE.fields so schema
  // changes only need a config update.
  const { latestFollowupByMcc, followupCountByMcc } = useMemo(() => {
    const latest = new Map();
    const count  = new Map();
    const ff = FOLLOWUP_SERVICE.fields;
    for (const fu of missionFollowups) {
      const num = fu[ff.requestNumber];
      if (num == null || num === '') continue;
      const key = String(num).trim();
      if (!key) continue;
      count.set(key, (count.get(key) || 0) + 1);
      // entrydate is Date in v2 (epoch ms) but was String in v1 — handle both.
      const rawDate =
        fu[ff.entryDate] ??
        fu[ff.entryDateAlt];
      
      let ts = Number(rawDate);
      
      if (!Number.isFinite(ts) || ts <= 0) {
        const d = new Date(String(rawDate));
        ts = Number.isNaN(d.getTime()) ? 0 : d.getTime();
      }
      if (ts > 0) {
        const prev = latest.get(key);
        if (!prev || ts > prev) latest.set(key, ts);
      }
    }
    return { latestFollowupByMcc: latest, followupCountByMcc: count };
  }, [missionFollowups]);

  // Whether the post-OAuth mission picker should take over the body.
  // Picker shows when:
  //   • We have data (resources.length > 0 OR we tried & loaded),
  //   • The user hasn't picked a mission yet,
  //   • Mission isn't URL-locked.
  const needsMissionPick =
    !filters.mission &&
    !lockedFilters.has('mission');

  const filtered = useMemo(
    () => resources.filter((r) => rowMatches(r, filters)),
    [resources, filters],
  );

  const filteredMccs = useMemo(
    () => mccs.filter((m) => mccMatches(m, filters)),
    [mccs, filters],
  );

  // Sort MCC cards to match the board's Sort toggle:
  //   "Updated" → most-recent followup first (MCCs with no followups
  //               sink to the bottom)
  //   "Request #" → MCC number ascending
  const sortedFilteredMccs = useMemo(() => {
    const arr = filteredMccs.slice();
    if (sortBy === 'updated') {
      arr.sort((a, b) => {
        const aKey = String(a[MCC_SERVICE.fields.mccNumber] ?? '').trim();
        const bKey = String(b[MCC_SERVICE.fields.mccNumber] ?? '').trim();
        const aTs = latestFollowupByMcc.get(aKey) || 0;
        const bTs = latestFollowupByMcc.get(bKey) || 0;
        if (aTs === bTs) return 0;
        if (!aTs) return 1;       // no followup → bottom
        if (!bTs) return -1;
        return bTs - aTs;         // newer first
      });
    } else {
      arr.sort((a, b) => {
        const na = parseFloat(a[MCC_SERVICE.fields.mccNumber]);
        const nb = parseFloat(b[MCC_SERVICE.fields.mccNumber]);
        const ag = Number.isFinite(na);
        const bg = Number.isFinite(nb);
        if (!ag && !bg) return 0;
        if (!ag) return 1;
        if (!bg) return -1;
        return na - nb;           // lowest first
      });
    }
    return arr;
  }, [filteredMccs, sortBy, latestFollowupByMcc]);

  // Denominator for "X of Y resources" — only counts resources in the
  // currently-selected mission (not the entire feature service), so the
  // total feels meaningful relative to what's actually shown.
  const missionTotal = useMemo(() => {
    if (!filters.mission) return resources.length;
    return resources.filter((r) => n(r.mission_id_rpt) === n(filters.mission)).length;
  }, [resources, filters.mission]);

  const grouped = useMemo(() => {
    const out = { _unassigned: [] };
    for (const c of STATUS_COLUMNS) out[c.id] = [];
    for (const r of filtered) {
      const col = statusToColumnId(r[FIELDS.status]);
      (out[col] || out._unassigned).push(r);
    }
    // Sort each column's cards. 'updated' = most recent first;
    // 'request' = lowest request number first. Missing values land at
    // the end either way.
    const cmp = sortBy === 'request' ? cmpRequest : cmpUpdated;
    for (const k of Object.keys(out)) out[k].sort(cmp);
    return out;
  }, [filtered, sortBy]);

  // tag_number → current deployment record. Used by the inventory
  // column to render a colored status pill on each item and to lock
  // drag on actively-deployed items. When multiple deployments share
  // a tag (history of demobs + a current active deployment), prefer
  // the non-Demobilized one; otherwise pick the most recently edited.
  const deployedByTag = useMemo(() => {
    const map = new Map();
    for (const r of resources) {
      const tag = String(r[FIELDS.tagNumber] ?? '').trim();
      if (!tag) continue;
      const existing = map.get(tag);
      if (!existing) { map.set(tag, r); continue; }

      const rActive = String(r[FIELDS.status] || '').trim() !== 'Demobilized';
      const eActive = String(existing[FIELDS.status] || '').trim() !== 'Demobilized';
      if (rActive && !eActive) { map.set(tag, r); continue; }
      if (!rActive && eActive) continue;

      // Both active (shouldn't happen) or both demobilized — pick the
      // most recently edited record so the pill reflects current state.
      const re = Number(r[FIELDS.editDate] || 0);
      const ee = Number(existing[FIELDS.editDate] || 0);
      if (re > ee) map.set(tag, r);
    }
    return map;
  }, [resources]);

  // tag_number → aggregated history. Computed on-the-fly from the
  // deployment layer (no separate storage) and passed to the Inventory
  // column so each card can render a small "N this mission · M prior
  // missions · last MM/DD/YYYY" line under its status pill.
  //
  // Returned shape per tag:
  //   {
  //     count:             total deployment records for this tag,
  //     missionCount:      distinct missions across all records,
  //     thisMissionCount:  records on the currently-selected mission,
  //     priorMissionCount: distinct missions OTHER than the current one,
  //     lastEdit:          most recent EditDate across all records,
  //   }
  // Tags with no deployment history are absent from the map.
  const deploymentHistoryByTag = useMemo(() => {
    const currentMissionId = filters.mission
      ? String(filters.mission).trim()
      : null;

    const work = new Map();
    for (const r of resources) {
      const tag = String(r[FIELDS.tagNumber] ?? '').trim();
      if (!tag) continue;
      let entry = work.get(tag);
      if (!entry) {
        entry = {
          count: 0,
          missions:      new Set(),
          priorMissions: new Set(),
          thisMissionCount: 0,
          lastEdit: 0,
        };
        work.set(tag, entry);
      }
      entry.count += 1;
      const mid = r[FIELDS.missionId];
      if (mid) {
        const m = String(mid).trim();
        entry.missions.add(m);
        if (currentMissionId && m === currentMissionId) {
          entry.thisMissionCount += 1;
        } else {
          entry.priorMissions.add(m);
        }
      }
      const edit = Number(r[FIELDS.editDate] || 0);
      if (edit > entry.lastEdit) entry.lastEdit = edit;
    }

    const out = new Map();
    for (const [tag, e] of work) {
      out.set(tag, {
        count:             e.count,
        missionCount:      e.missions.size,
        thisMissionCount:  e.thisMissionCount,
        priorMissionCount: e.priorMissions.size,
        lastEdit:          e.lastEdit,
      });
    }
    return out;
  }, [resources, filters.mission]);

  const activeResource = activeId
    ? resources.find((r) => String(r[FIELDS.objectId]) === activeId)
    : null;

  const toggleColumn = (id) =>
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const resetColumns = () => setHiddenColumns(new Set());

  // Drag handlers
  const handleDragStart = (event) => setActiveId(String(event.active.id));
  const handleDragEnd = async (event) => {
    setActiveId(null);
    if (readOnly) return;                  // never write in read-only mode
    const { active, over } = event;
    if (!over) return;

    // ── Inventory → MCC: create a new Equipment deployment ─────────
    const activeData = active.data && active.data.current;
    if (activeData && activeData.type === 'inventory') {
      const overId = String(over.id || '');
      if (!overId.startsWith('mcc:')) return;             // wrong drop target
      const overData = over.data && over.data.current;
      const mcc = (overData && overData.mcc) || null;
      const inv = activeData.item;
      if (!mcc || !inv) return;

      const invF = INVENTORY_SERVICE.fields;
      const tag = String(inv[invF.tagNumber] ?? '').trim();
      // Mark as pending so the inventory card greys out / shows
      // "Deploying…" until the resource refresh sweeps the tag
      // into the deployed set and the item drops off the list.
      if (tag) {
        setPendingInventoryTags((p) => new Set(p).add(tag));
      }

      try {
        // No starting status — the new card lands in Unassigned for
        // the user to triage by dragging into a real status column.
        await createDeploymentFromInventory(mcc, inv);
        // Refresh so the new deployment appears in the Staged column
        // and the inventory item drops out of `availableInventory`.
        await refresh();
      } catch (err) {
        console.error('[RESL-Kanban] createDeploymentFromInventory failed:', err);
        const itemLabel = (inv[invF.item] || tag || 'inventory item');
        setError(`Could not deploy ${itemLabel}: ${err.message}`);
      } finally {
        if (tag) {
          setPendingInventoryTags((p) => {
            const next = new Set(p);
            next.delete(tag);
            return next;
          });
        }
      }
      return;
    }

    // ── Status drag (existing flow) ─────────────────────────────────
    const oid = Number(active.id);
    const current = resources.find((r) => r[FIELDS.objectId] === oid);
    if (!current) return;

    // Translate the drop target into a column id and the value to write.
    // Dropping on Unassigned clears the status — useful as an "undo" for
    // a wrong drop.
    let targetColId;
    let newStatus;
    if (over.id === '_unassigned') {
      targetColId = '_unassigned';
      newStatus   = null;
    } else {
      const targetCol = STATUS_COLUMNS.find((c) => c.id === over.id);
      if (!targetCol) return;
      targetColId = targetCol.id;
      newStatus   = targetCol.value;
    }

    if (statusToColumnId(current[FIELDS.status]) === targetColId) return;

    const previousStatus = current[FIELDS.status];
    const previousEdit   = current[FIELDS.editDate];
    const now = Date.now();

    // Build the full attribute partial for the applyEdits payload.
    // Default is just the status change; certain target columns also
    // stamp date fields (mobilization / demobilization) and recalc
    // days_deployed in the same write so it's atomic, and so the
    // history row carries every changed field under a single
    // status_change action.
    const partial = { [FIELDS.status]: newStatus };
    const today = todayUtcMidnightMs();

    const isDemobDrop = targetColId === 'demobilized';
    const isMobDrop   = (targetColId === 'enroute' || targetColId === 'onscene');

    if (isDemobDrop) {
      // Always stamp the demob date — drag to Demobilized = "they
      // demobilized today" per the existing rule.
      partial.item_demobilization = today;
      const days = daysBetween(current.item_mobilization, today);
      if (days != null) partial.days_deployed = days;
    }

    if (isMobDrop) {
      // Only stamp if currently blank — preserves a mobilization date
      // set earlier (manually via the modal, or by an earlier En Route
      // drop) so going En Route → On Scene the next day doesn't
      // overwrite yesterday's mob date with today's.
      const existingMob = current.item_mobilization;
      const isBlank = existingMob == null || existingMob === '' || !Number.isFinite(Number(existingMob));
      if (isBlank) {
        partial.item_mobilization = today;
        const days = daysBetween(today, current.item_demobilization);
        if (days != null) partial.days_deployed = days;
      }
    }

    // Snapshot the prior values of every field we're about to write so
    // rollback restores all of them (not just status) on failure.
    const rollbackSnapshot = { [FIELDS.editDate]: previousEdit };
    for (const k of Object.keys(partial)) rollbackSnapshot[k] = current[k];

    // Optimistically bump EditDate too so freshness highlight fires
    // immediately ("Just now") instead of waiting for the next refresh.
    const optimistic = { ...partial, [FIELDS.editDate]: now };
    setResources((rs) =>
      rs.map((r) => (r[FIELDS.objectId] === oid ? { ...r, ...optimistic } : r)),
    );
    setDetailRow((prev) =>
      prev && prev[FIELDS.objectId] === oid ? { ...prev, ...optimistic } : prev,
    );
    setPending((p) => new Set(p).add(oid));

    try {
      // Pass `current` (pre-edit row) so the history log can capture
      // a full snapshot and the prev/new status fields.
      await updateAttributes(oid, partial, current);
      // Mirror the new status to the inventory layer so dashboards
      // built on the inventory service stay in sync. Fire-and-forget —
      // failures log a warning but don't roll back the deployment edit.
      const tag = current[FIELDS.tagNumber];
      if (tag) updateInventoryMobilizationStatus(tag, newStatus);
    } catch (err) {
      console.error('drop update failed:', err);
      const label = current[FIELDS.requestNumber] ? `Request #${current[FIELDS.requestNumber]}` : 'this resource';
      setError(`Could not update ${label}: ${err.message}`);
      setResources((rs) =>
        rs.map((r) => (r[FIELDS.objectId] === oid ? { ...r, ...rollbackSnapshot } : r)),
      );
      setDetailRow((prev) =>
        prev && prev[FIELDS.objectId] === oid ? { ...prev, ...rollbackSnapshot } : prev,
      );
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(oid);
        return next;
      });
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        {filters.mission && (
          <div className="header-mission" title={filters.mission}>
            <span className="muted small">Mission</span>
            <span className="header-mission-name">{filters.mission}</span>
          </div>
        )}
        <div className="header-actions">
          {readOnly && (
            <span className="readonly-chip" title="View-only mode — drag-drop and edits are disabled">
              🔒 Read-only
            </span>
          )}
          <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {needsMissionPick ? (
        <MissionPicker
          resources={resources}
          mccs={allMccs}
          loading={loading}
          allowedMissions={allowedMissions}
          onPick={(m) => setFilters({ ...filters, mission: m })}
        />
      ) : (
        <>
      <MainFilters
        resources={resources}
        mccs={allMccs}
        filters={filters}
        onFilters={setFilters}
        lockedFilters={lockedFilters}
        allowedMissions={allowedMissions}
      />

      {loading && !resources.length ? (
        <div className="boot-screen">
          <div className="spinner" />
          <p>Loading resources…</p>
        </div>
      ) : (
        <>
          <div className="board-toolbar">
            <SortToggle sortBy={sortBy} onSortBy={setSortBy} />
            <ColumnToggles
              hiddenColumns={hiddenColumns}
              disabledColumnIds={disabledColumnIds}
              onToggleColumn={toggleColumn}
              onResetColumns={resetColumns}
            />
            <div className="toolbar-info">
              <strong>{filtered.length}</strong>
              {filtered.length !== missionTotal && (
                <span className="muted small"> of {missionTotal}</span>
              )}
              <span className="muted small">
                {' '}
                resource{filtered.length === 1 ? '' : 's'}
                {lastRefresh && ` · last updated ${lastRefresh.toLocaleTimeString()}`}
              </span>
              {error && <span className="error-pill">{error}</span>}
            </div>
            <button className="btn btn-ghost" onClick={refresh} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="board">
              {COLUMNS
                .filter((c) => !hiddenColumns.has(c.id) && !disabledColumnIds.has(c.id))
                .map((c) => {
                if (c.kind === 'inventory') {
                  return (
                    <InventoryColumn
                      key={c.id}
                      label={c.label}
                      accent={c.accent}
                      items={inventoryItems}
                      deployedByTag={deployedByTag}
                      historyByTag={deploymentHistoryByTag}
                      loading={loading}
                      readOnly={readOnly}
                      pendingTagNumbers={pendingInventoryTags}
                    />
                  );
                }
                if (c.kind === 'mcc') {
                  return (
                    <MccColumn
                      key={c.id}
                      label={c.label}
                      accent={c.accent}
                      mccs={sortedFilteredMccs}
                      latestFollowupByMcc={latestFollowupByMcc}
                      onFilter={() => {}}
                      onShowDetail={setMccDetailRow}
                    />
                  );
                }
                if (c.kind === 'unassigned') {
                  return (
                    <Column
                      key={c.id}
                      id={c.id}
                      label={c.label}
                      accent={c.accent}
                      resources={grouped._unassigned}
                      pending={pending}
                      droppable
                      readOnly={readOnly}
                      onShowDetail={setDetailRow}
                      hint="Drop here to clear status"
                    />
                  );
                }
                // status column
                return (
                  <Column
                    key={c.id}
                    id={c.id}
                    label={c.label}
                    accent={c.accent}
                    resources={grouped[c.id] || []}
                    pending={pending}
                    droppable
                    readOnly={readOnly}
                    onShowDetail={setDetailRow}
                  />
                );
              })}
            </div>
            <DragOverlay>
              {activeResource ? <Card r={activeResource} dragging /> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
        </>
      )}

      <MccDetailModal
        mcc={mccDetailRow}
        deployments={resources}
        readOnly={readOnly}
        followupCount={
          mccDetailRow
            ? (followupCountByMcc.get(String(mccDetailRow[MCC_SERVICE.fields.mccNumber] ?? '').trim()) || 0)
            : 0
        }
        onClose={() => setMccDetailRow(null)}
        onShowDeployment={(deployRow) => {
          setMccDetailRow(null);
          setDetailRow(deployRow);
        }}
      />

      <DetailModal
        r={detailRow}
        followupCount={
          detailRow
            ? (followupCountByMcc.get(String(detailRow.request_number_rpt ?? '').trim()) || 0)
            : 0
        }
        onClose={() => setDetailRow(null)}
        onUpdate={readOnly ? undefined : async (objectId, partial, geometry) => {
          // Snapshot the old values (including EditDate) for rollback
          const before = resources.find((row) => row[FIELDS.objectId] === objectId);
          if (!before) throw new Error('Row not found');
          const snapshot = { [FIELDS.editDate]: before[FIELDS.editDate] };
          for (const k of Object.keys(partial)) snapshot[k] = before[k];

          // Optimistic update — bump EditDate locally so the freshness
          // highlight fires right away. The next refresh will sync the
          // server-authoritative EditDate.
          const optimistic = { ...partial, [FIELDS.editDate]: Date.now() };
          setResources((rs) =>
            rs.map((row) => (row[FIELDS.objectId] === objectId ? { ...row, ...optimistic } : row)),
          );
          setDetailRow((prev) =>
            prev && prev[FIELDS.objectId] === objectId ? { ...prev, ...optimistic } : prev,
          );

          try {
            // Pass `before` (pre-edit row) so the history log can
            // diff old vs. new and capture a full snapshot. `geometry`
            // is set by the address row's geocoder so the record's
            // point moves on the map alongside the attribute changes.
            await updateAttributes(objectId, partial, before, geometry);
          } catch (err) {
            // Roll back (including EditDate)
            setResources((rs) =>
              rs.map((row) => (row[FIELDS.objectId] === objectId ? { ...row, ...snapshot } : row)),
            );
            setDetailRow((prev) =>
              prev && prev[FIELDS.objectId] === objectId ? { ...prev, ...snapshot } : prev,
            );
            throw err;
          }
        }}
      />
    </div>
  );
}
