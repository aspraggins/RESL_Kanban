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
import { COLUMNS, FIELDS, CONFIG, statusToColumnId } from '../config.js';
import { fetchAllResources, fetchLayerMeta, updateStatus, updateAttributes } from '../service.js';
import Column from './Column.jsx';
import Card from './Card.jsx';
import { MainFilters, SortToggle, ColumnToggles } from './FilterBar.jsx';
import MissionPicker from './MissionPicker.jsx';
import Brand from './Brand.jsx';
import DetailModal from './DetailModal.jsx';

const EMPTY_FILTERS = { mission: '', esf: '', county: '', kind: '', search: '' };

// Filters that can be locked via URL search parameters. Search is
// always user-editable.
const LOCKABLE_FILTERS = ['mission', 'esf', 'county', 'kind'];

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

  const [hiddenColumns, setHiddenColumns] = useState(() => new Set());
  const [sortBy,       setSortBy]        = useState('updated'); // 'updated' | 'request'
  const [detailRow,    setDetailRow]     = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const refresh = useCallback(async () => {
    try {
      setError('');
      const data = await fetchAllResources();
      setResources(data);
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

  const grouped = useMemo(() => {
    const out = { _unassigned: [] };
    for (const c of COLUMNS) out[c.id] = [];
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
    const { active, over } = event;
    if (!over) return;
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
      const targetCol = COLUMNS.find((c) => c.id === over.id);
      if (!targetCol) return;
      targetColId = targetCol.id;
      newStatus   = targetCol.value;
    }

    if (statusToColumnId(current[FIELDS.status]) === targetColId) return;

    const previousStatus = current[FIELDS.status];
    const previousEdit   = current[FIELDS.editDate];
    const now = Date.now();
    // Optimistically bump EditDate too so freshness highlight fires
    // immediately ("Just now") instead of waiting for the next refresh.
    setResources((rs) =>
      rs.map((r) => (r[FIELDS.objectId] === oid
        ? { ...r, [FIELDS.status]: newStatus, [FIELDS.editDate]: now }
        : r)),
    );
    setPending((p) => new Set(p).add(oid));

    try {
      await updateStatus(oid, newStatus);
    } catch (err) {
      console.error('updateStatus failed:', err);
      setError(`Could not update OBJECTID ${oid}: ${err.message}`);
      setResources((rs) =>
        rs.map((r) => (r[FIELDS.objectId] === oid
          ? { ...r, [FIELDS.status]: previousStatus, [FIELDS.editDate]: previousEdit }
          : r)),
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
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {needsMissionPick ? (
        <MissionPicker
          resources={resources}
          loading={loading}
          onPick={(m) => setFilters({ ...filters, mission: m })}
        />
      ) : (
        <>
      <MainFilters
        resources={resources}
        filters={filters}
        onFilters={setFilters}
        lockedFilters={lockedFilters}
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
              onToggleColumn={toggleColumn}
              onResetColumns={resetColumns}
            />
            <div className="toolbar-info">
              <strong>{filtered.length}</strong>
              {filtered.length !== resources.length && (
                <span className="muted small"> of {resources.length}</span>
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

          {filtered.length === 0 && resources.length > 0 && lockedFilters.size > 0 && (
            <div className="empty-banner">
              <strong>No resources match the locked filters.</strong>
              <div className="muted small">
                {[...lockedFilters].map((k) => `${k} = "${filters[k]}"`).join(' · ')}
              </div>
              <div className="muted small">
                Values must match the AGOL coded value (case- and
                whitespace-insensitive). Open DevTools → Console → look
                for the layer-metadata log to see the exact strings on
                file.
              </div>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="board">
              <Column
                id="_unassigned"
                label="Unassigned"
                accent="#94a3b8"
                resources={grouped._unassigned}
                pending={pending}
                droppable
                onShowDetail={setDetailRow}
                hint="Drop here to clear status"
              />
              {COLUMNS.filter((c) => !hiddenColumns.has(c.id)).map((c) => (
                <Column
                  key={c.id}
                  id={c.id}
                  label={c.label}
                  accent={c.accent}
                  resources={grouped[c.id] || []}
                  pending={pending}
                  droppable
                  onShowDetail={setDetailRow}
                />
              ))}
            </div>
            <DragOverlay>
              {activeResource ? <Card r={activeResource} dragging /> : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
        </>
      )}

      <DetailModal
        r={detailRow}
        onClose={() => setDetailRow(null)}
        onUpdate={async (objectId, partial) => {
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
            await updateAttributes(objectId, partial);
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
