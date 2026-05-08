import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FIELDS } from '../config.js';

export default function Card({ r, pending = false, dragging = false, onShowDetail }) {
  if (dragging) return <CardView r={r} pending={pending} dragging />;
  return <DraggableCard r={r} pending={pending} onShowDetail={onShowDetail} />;
}

function DraggableCard({ r, pending, onShowDetail }) {
  const oid = r[FIELDS.objectId];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(oid),
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };
  return (
    <CardView
      r={r}
      pending={pending}
      style={style}
      forwardRef={setNodeRef}
      handleProps={{ ...attributes, ...listeners }}
      onShowDetail={onShowDetail}
    />
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────
const v = (r, k) => {
  if (!k) return null;
  const x = r[k];
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s.length ? s : null;
};

// AGOL date fields are epoch ms. Format short: "2/17/26 11:52a"
function formatEditDate(ms) {
  if (ms == null || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  const mdy = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
  const t   = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(' AM', 'a').replace(' PM', 'p');
  return `${mdy} ${t}`;
}

// Given a row, return { qtyLine, nameLine } describing its quantity and
// resource name based on its kind. Equipment, Team, and Tagged Inventory
// have different relevant fields.
function describeResource(r) {
  const kind   = (v(r, FIELDS.kind) || '').toLowerCase();
  const equipN = v(r, FIELDS.equipmentName) || v(r, FIELDS.equipmentType);
  const equipQ = v(r, FIELDS.equipmentCount);
  const teamN  = v(r, FIELDS.identifier) || v(r, FIELDS.teamKind);
  const persQ  = v(r, FIELDS.personnelCount);
  const itemN  = v(r, FIELDS.item) || v(r, FIELDS.tagNumber);
  const itemQ  = v(r, FIELDS.qtyItem);
  const fallbk = v(r, FIELDS.resourceMain) || v(r, FIELDS.resourceType);

  // 1) Tagged inventory: item + qty_item, when present
  if (itemN && itemQ) return { qtyLine: `Item: ${itemQ}`, nameLine: itemN };
  // 2) Equipment
  if (kind.includes('equip') || equipN || equipQ) {
    return { qtyLine: equipQ ? `Equipment: ${equipQ}` : 'Equipment', nameLine: equipN || fallbk };
  }
  // 3) Team / Personnel
  if (kind.includes('team') || teamN || persQ) {
    return { qtyLine: persQ ? `Personnel: ${persQ}` : 'Team', nameLine: teamN || fallbk };
  }
  // 4) Fallback
  return { qtyLine: '', nameLine: fallbk || itemN || equipN || teamN || '' };
}

// ─── Render ────────────────────────────────────────────────────────────
function CardView({ r, pending, style, dragging = false, forwardRef, handleProps = {}, onShowDetail }) {
  const oid       = r[FIELDS.objectId];
  const reqNum    = v(r, FIELDS.requestNumber);
  const county    = v(r, FIELDS.county);
  const editDate  = formatEditDate(r[FIELDS.editDate]);
  const entity    = v(r, FIELDS.entity);
  const esf       = v(r, FIELDS.esf);
  const days      = v(r, FIELDS.daysDeployed);
  const mission   = v(r, FIELDS.missionId);
  const { qtyLine, nameLine } = describeResource(r);

  // Click handler that explicitly does NOT propagate to the dnd-kit
  // listeners on the card root — otherwise the click might be swallowed
  // by drag detection.
  const handleDetailClick = (e) => {
    e.stopPropagation();
    onShowDetail && onShowDetail(r);
  };
  // Block pointerdown so dnd-kit doesn't even start tracking a drag
  // when the user is just trying to tap the info button.
  const swallowDown = (e) => e.stopPropagation();

  return (
    <div
      ref={forwardRef}
      style={style}
      className={`card${dragging ? ' is-dragging' : ''}${pending ? ' is-pending' : ''}`}
      {...handleProps}
    >
      {onShowDetail && !dragging && (
        <button
          type="button"
          className="card-info-btn"
          onPointerDown={swallowDown}
          onMouseDown={swallowDown}
          onTouchStart={swallowDown}
          onClick={handleDetailClick}
          title="Show details"
          aria-label="Show details"
        >
          ⓘ
        </button>
      )}
      <div className="card-grid">
        <div className="card-left">
          <div className="card-title">{reqNum ? `#${reqNum}` : `OID ${oid}`}</div>
          {county && <div className="card-county">{county} County</div>}
          {editDate && <div className="card-updated muted small">Updated {editDate}</div>}
        </div>
        <div className="card-right">
          {qtyLine && <div className="card-qty">{qtyLine}</div>}
          {nameLine && <div className="card-name">{nameLine}</div>}
          {entity && <div className="card-entity muted small">{entity}</div>}
        </div>
      </div>
      <div className="card-footer">
        {esf     && <span className="card-chip">ESF · {esf}</span>}
        {mission && <span className="card-chip">{mission}</span>}
        {days != null && <span className="card-chip card-chip-mono">{days}d</span>}
        {pending && <span className="card-pending">Saving…</span>}
      </div>
    </div>
  );
}
