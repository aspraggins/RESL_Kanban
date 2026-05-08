import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchAllResources, fetchLayerMeta, updateStatus } from '../service.js';
import Column from './Column.jsx';
import Card from './Card.jsx';

export default function Board() {
  const [resources, setResources] = useState([]);   // attribute objects
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState('');
  const [activeId, setActiveId]   = useState(null);
  const [pending, setPending]     = useState(() => new Set()); // OBJECTIDs mid-update
  const [lastRefresh, setLastRefresh] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Initial load + periodic refresh
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

  // Group resources by column id ------------------------------------------
  const grouped = useMemo(() => {
    const out = { _unassigned: [] };
    for (const c of COLUMNS) out[c.id] = [];
    for (const r of resources) {
      const col = statusToColumnId(r[FIELDS.status]);
      (out[col] || out._unassigned).push(r);
    }
    return out;
  }, [resources]);

  const activeResource = activeId
    ? resources.find((r) => String(r[FIELDS.objectId]) === activeId)
    : null;

  // Drag handlers ----------------------------------------------------------
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

    // Optimistic local update — snapshot for rollback
    const previous = current[FIELDS.status];
    setResources((rs) =>
      rs.map((r) =>
        r[FIELDS.objectId] === oid
          ? { ...r, [FIELDS.status]: targetCol.value }
          : r,
      ),
    );
    setPending((p) => new Set(p).add(oid));

    try {
      await updateStatus(oid, targetCol.value);
    } catch (err) {
      console.error('updateStatus failed:', err);
      setError(`Could not update OBJECTID ${oid}: ${err.message}`);
      // Roll back
      setResources((rs) =>
        rs.map((r) =>
          r[FIELDS.objectId] === oid
            ? { ...r, [FIELDS.status]: previous }
            : r,
        ),
      );
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(oid);
        return next;
      });
    }
  };

  // Render -----------------------------------------------------------------
  if (loading && !resources.length) {
    return (
      <div className="boot-screen">
        <div className="spinner" />
        <p>Loading resources…</p>
      </div>
    );
  }

  return (
    <div className="board-wrap">
      <div className="board-toolbar">
        <div>
          <strong>{resources.length}</strong> resource
          {resources.length === 1 ? '' : 's'}
          {lastRefresh && (
            <span className="muted small">
              {' · last updated '}
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
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
            />
          )}
          {COLUMNS.map((c) => (
            <Column
              key={c.id}
              id={c.id}
              label={c.label}
              accent={c.accent}
              resources={grouped[c.id] || []}
              pending={pending}
              droppable
            />
          ))}
        </div>
        <DragOverlay>
          {activeResource ? <Card r={activeResource} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
