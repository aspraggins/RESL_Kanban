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
import { HeaderFilters, ColumnFilters } from './FilterBar.jsx';
import Brand from './Brand.jsx';
import DetailModal from './DetailModal.jsx';

const EMPTY_FILTERS = { mission: '', esf: '', county: '', kind: '', search: '' };

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

function rowMatches(r, f) {
  if (f.mission && String(r.mission_id_rpt || '') !== f.mission) return false;
  if (f.esf     && String(r.coordinator   || '') !== f.esf)     return false;
  if (f.county  && String(r.county_rpt    || '') !== f.county)  return false;
  if (f.kind    && String(r.resource_kind || '') !== f.kind)    return false;
  if (f.search) {
    const q = f.search.toLowerCase();
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
  const [filters,      setFilters]       = useState(EMPTY_FILTERS);
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
    const targetCol = COLUMNS.find((c) => c.id === over.id);
    if (!targetCol) return;
    const current = resources.find((r) => r[FIELDS.objectId] === oid);
    if (!current) return;
    if (statusToColumnId(current[FIELDS.status]) === targetCol.id) return;

    const previous = current[FIELDS.status];
    setResources((rs) =>
      rs.map((r) => (r[FIELDS.objectId] === oid ? { ...r, [FIELDS.status]: targetCol.value } : r)),
    );
    setPending((p) => new Set(p).add(oid));

    try {
      await updateStatus(oid, targetCol.value);
    } catch (err) {
      console.error('updateStatus failed:', err);
      setError(`Could not update OBJECTID ${oid}: ${err.message}`);
      setResources((rs) =>
        rs.map((r) => (r[FIELDS.objectId] === oid ? { ...r, [FIELDS.status]: previous } : r)),
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
      <header className="app-header app-header--with-filters">
        <Brand />
        <HeaderFilters
          resources={resources}
          filters={filters}
          onFilters={setFilters}
          hiddenColumns={hiddenColumns}
          onResetColumns={resetColumns}
        />
        <button className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
      </header>

      <ColumnFilters
        filters={filters}
        onFilters={setFilters}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
        sortBy={sortBy}
        onSortBy={setSortBy}
      />

      {loading && !resources.length ? (
        <div className="boot-screen">
          <div className="spinner" />
          <p>Loading resources…</p>
        </div>
      ) : (
        <>
          <div className="board-toolbar">
            <div>
              <strong>{filtered.length}</strong>
              {filtered.length !== resources.length && (
                <span className="muted small"> of {resources.length}</span>
              )}
              <span className="muted small">
                {' '}
                resource{filtered.length === 1 ? '' : 's'}
                {lastRefresh && ` · last updated ${lastRefresh.toLocaleTimeString()}`}
              </span>
            </div>
            <div className="toolbar-right">
              {error && <span className="error-pill">{error}</span>}
              <button className="btn btn-ghost" onClick={refresh} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="board">
              {grouped._unassigned.length > 0 && (
                <Column
                  id="_unassigned"
                  label="Unassigned"
                  accent="#ef4444"
                  resources={grouped._unassigned}
                  pending={pending}
                  droppable={false}
                  onShowDetail={setDetailRow}
                />
              )}
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

      <DetailModal
        r={detailRow}
        onClose={() => setDetailRow(null)}
        onUpdate={async (objectId, partial) => {
          // Snapshot the old values for rollback
          const before = resources.find((row) => row[FIELDS.objectId] === objectId);
          if (!before) throw new Error('Row not found');
          const snapshot = {};
          for (const k of Object.keys(partial)) snapshot[k] = before[k];

          // Optimistic update — both the resources list AND the detailRow
          // so the modal reflects the new value immediately.
          setResources((rs) =>
            rs.map((row) => (row[FIELDS.objectId] === objectId ? { ...row, ...partial } : row)),
          );
          setDetailRow((prev) =>
            prev && prev[FIELDS.objectId] === objectId ? { ...prev, ...partial } : prev,
          );

          try {
            await updateAttributes(objectId, partial);
          } catch (err) {
            // Roll back
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
