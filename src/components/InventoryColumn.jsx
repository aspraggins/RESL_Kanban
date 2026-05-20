import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { INVENTORY_SERVICE, COLUMNS, FIELDS, statusToColumnId } from '../config.js';

// Leftmost column on the board — TEMA assigned inventory. Items are
// read-only here and draggable onto an MCC card; the drop creates a
// new Equipment deployment with the inventory's tag / item / make /
// model / description fields copied across (see
// createDeploymentFromInventory in service.js).
//
// Items currently linked to a non-Demobilized deployment render a
// colored status pill matching that deployment's column accent, and
// their drag is disabled so they can't be re-deployed elsewhere
// without first being demobilized.
export default function InventoryColumn({
  label,
  accent,
  items = [],
  deployedByTag,        // Map<string tag, resource record>
  historyByTag,         // Map<string tag, { count, missionCount, lastEdit }>
  loading = false,
  readOnly = false,
  pendingTagNumbers,    // Set<string> of tags currently being deployed
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
          <div className="empty-hint">No inventory available.</div>
        ) : filtered.length === 0 ? (
          <div className="empty-hint">No matches for "{query}".</div>
        ) : (
          filtered.map((it) => {
            const tag = String(it[INVENTORY_SERVICE.fields.tagNumber] ?? '').trim();
            const deployment = (tag && deployedByTag) ? deployedByTag.get(tag) : null;
            const history    = (tag && historyByTag)  ? historyByTag.get(tag)  : null;
            const pending = !!(pendingTagNumbers && pendingTagNumbers.has(tag));
            return (
              <InventoryCard
                key={it[INVENTORY_SERVICE.fields.objectId]}
                inv={it}
                deployment={deployment}
                history={history}
                readOnly={readOnly}
                pending={pending}
              />
            );
          })
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

// Look up the accent color for a deployment status by translating
// status → column id → COLUMNS entry.
function accentForStatus(status) {
  const id  = statusToColumnId(status);
  const col = COLUMNS.find((c) => c.id === id);
  return col && col.accent ? col.accent : '#94a3b8';
}

// Short date for the history line — matches the existing card chip
// style elsewhere ("5/14/2026"). Returns null on bad/missing input so
// the caller can decide whether to render the line at all.
function fmtShortDate(ms) {
  if (ms == null || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: 'numeric', day: 'numeric', year: 'numeric',
  });
}

function InventoryCard({ inv, deployment, history, readOnly = false, pending = false }) {
  const f   = INVENTORY_SERVICE.fields;
  const oid = inv[f.objectId];
  const tag = v(inv, f.tagNumber);
  const itm = v(inv, f.item);
  const mk  = v(inv, f.make);
  const md  = v(inv, f.model);
  const dsc = v(inv, f.description);

  // Deployment context (if any). Any non-Demobilized deployment counts
  // as "actively linked" — including Unassigned (empty status), since
  // an Unassigned deployment record already exists for this tag and
  // dragging it again would create a duplicate.
  const depStatus = deployment ? String(deployment[FIELDS.status] || '').trim() : '';
  const isDemob   = !!deployment && depStatus === 'Demobilized';
  const isActive  = !!deployment && !isDemob;
  // Pill label: status verbatim, or "Unassigned" if linked but blank.
  const pillLabel = deployment ? (depStatus || 'Unassigned') : null;
  const pillColor = deployment ? accentForStatus(depStatus) : null;

  // Lock the drag whenever the item has any non-Demobilized deployment
  // (including Unassigned). Demobilized and never-deployed items stay
  // draggable so they can be assigned to a new MCC.
  const locked = isActive;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id:   `inv:${oid}`,
    data: { type: 'inventory', item: inv },
    disabled: readOnly || pending || locked,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };

  const classes = ['card', 'inventory-card'];
  if (pending) classes.push('is-pending');
  if (locked)  classes.push('is-locked');
  if (isDemob) classes.push('is-demob');

  let title;
  if (pending)    title = 'Deploying — please wait…';
  else if (locked) title = `Currently deployed (${pillLabel}) — demobilize first to re-deploy`;
  else            title = 'Drag onto an MCC card to deploy this item';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classes.join(' ')}
      title={title}
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
          {pillLabel && (
            <div
              className="inventory-pill"
              style={{
                '--pill-color': pillColor,
              }}
              aria-label={`Currently ${pillLabel}`}
            >
              {locked && <span className="inventory-pill-lock" aria-hidden="true">🔒</span>}
              {pillLabel}
            </div>
          )}
          {history && history.count > 0 && (() => {
            const parts = [];
            if (history.thisMissionCount > 0) {
              parts.push(`${history.thisMissionCount} this mission`);
            }
            if (history.priorMissionCount > 0) {
              const n = history.priorMissionCount;
              parts.push(`${n} prior mission${n === 1 ? '' : 's'}`);
            }
            // Fallback when none of the records had a mission_id_rpt
            // value — still surface the raw deployment count so the
            // card doesn't look empty.
            if (parts.length === 0) {
              parts.push(`${history.count} deployment${history.count === 1 ? '' : 's'}`);
            }
            const lastDate = fmtShortDate(history.lastEdit);
            if (lastDate) parts.push(`last ${lastDate}`);
            return (
              <div className="inventory-history muted small">
                {parts.join(' · ')}
              </div>
            );
          })()}
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
