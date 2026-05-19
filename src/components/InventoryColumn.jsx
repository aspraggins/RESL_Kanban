import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { INVENTORY_SERVICE } from '../config.js';

// Leftmost column on the board — TEMA assigned inventory. Items are
// read-only here and draggable onto an MCC card; the drop creates a
// new Equipment deployment with the inventory's tag / item / make /
// model / description fields copied across (see
// createDeploymentFromInventory in service.js).
//
// Already-deployed items are filtered out upstream in Board.jsx so this
// component just renders whatever it's handed.
export default function InventoryColumn({
  label,
  accent,
  items = [],
  loading = false,
  readOnly = false,
  pendingTagNumbers,   // Set<string> of tags currently being deployed
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const f = INVENTORY_SERVICE.fields;
    return items.filter((it) => {
      const hay = [
        it[f.tagNumber], it[f.item], it[f.make],
        it[f.model], it[f.description],
      ].map((x) => (x == null ? '' : String(x).toLowerCase())).join(' ');
      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <div className="column is-static is-inventory" style={{ '--column-accent': accent }}>
      <header className="column-header">
        <span className="column-dot" />
        <span className="column-label">{label}</span>
        <span className="column-count">{items.length}</span>
      </header>
      <div className="column-toolbar">
        <input
          type="search"
          className="inventory-search"
          placeholder={`Search ${items.length} item${items.length === 1 ? '' : 's'}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="column-body">
        {loading && items.length === 0 ? (
          <div className="empty-hint">Loading inventory…</div>
        ) : items.length === 0 ? (
          <div className="empty-hint">No available inventory.</div>
        ) : filtered.length === 0 ? (
          <div className="empty-hint">No matches for "{query}".</div>
        ) : (
          filtered.map((it) => (
            <InventoryCard
              key={it[INVENTORY_SERVICE.fields.objectId]}
              inv={it}
              readOnly={readOnly}
              pending={!!(pendingTagNumbers && pendingTagNumbers.has(
                String(it[INVENTORY_SERVICE.fields.tagNumber] ?? '').trim(),
              ))}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Helper: trim + null-safe stringify.
const v = (obj, key) => {
  if (!key) return null;
  const x = obj[key];
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s.length ? s : null;
};

function InventoryCard({ inv, readOnly = false, pending = false }) {
  const f   = INVENTORY_SERVICE.fields;
  const oid = inv[f.objectId];
  const tag = v(inv, f.tagNumber);
  const itm = v(inv, f.item);
  const mk  = v(inv, f.make);
  const md  = v(inv, f.model);
  const dsc = v(inv, f.description);

  // useDraggable always returns the listeners/setNodeRef so we can
  // attach them to the card. `data` carries the full inventory record
  // through to onDragEnd in Board.jsx — that's what the drop handler
  // reads to build the new deployment.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id:   `inv:${oid}`,
    data: { type: 'inventory', item: inv },
    disabled: readOnly || pending,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card inventory-card${pending ? ' is-pending' : ''}`}
      title={pending
        ? 'Deploying — please wait…'
        : 'Drag onto an MCC card to deploy this item'}
      {...attributes}
      {...listeners}
    >
      <div className="card-grid">
        <div className="card-left">
          <div className="card-title">{itm || '—'}</div>
          {(mk || md) && (
            <div className="card-county muted small">
              {[mk, md].filter(Boolean).join(' · ')}
            </div>
          )}
          {dsc && <div className="card-county muted small">{dsc}</div>}
        </div>
        <div className="card-right">
          {tag && (
            <div className="card-qty">
              <span className="muted small">Tag</span> {tag}
            </div>
          )}
        </div>
      </div>
      {pending && <div className="card-pending">Deploying…</div>}
    </div>
  );
}
