import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { COLUMNS, FIELDS, statusToColumnId } from '../config.js';

export default function Card({ r, pending = false, dragging = false, needsFollowup = false, lastFollowupTs = null, readOnly = false, onShowDetail }) {
  if (dragging) return <CardView r={r} pending={pending} dragging />;
  return <DraggableCard r={r} pending={pending} needsFollowup={needsFollowup} lastFollowupTs={lastFollowupTs} readOnly={readOnly} onShowDetail={onShowDetail} />;
}

function DraggableCard({ r, pending, needsFollowup, lastFollowupTs, readOnly, onShowDetail }) {
  const oid = r[FIELDS.objectId];
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(oid),
    disabled: readOnly,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
  };
  return (
    <CardView
      r={r}
      pending={pending}
      needsFollowup={needsFollowup}
      lastFollowupTs={lastFollowupTs}
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

// Status values for active (in-progress) deployments. A card in one of
// these statuses with no recent edit gets the 'stale' (amber) tier.
const ACTIVE_DEPLOYMENT_STATUSES = ['On Scene', 'En Route', 'Staged', 'On Hold'];
const STALE_HOURS = 72;          // tweak to taste

// Returns { text, tier } where:
//   tier = 'hour'  — edited in the last 60 min   (blue + pulse)
//   tier = 'today' — edited since local midnight (light blue)
//   tier = 'stale' — active deployment but not edited in 72+ hours (amber)
//   tier = null    — anything else (no highlight)
//
// `editMs`   — EditDate epoch ms (set by AGOL on applyEdits)
// `createMs` — CreationDate epoch ms (set once when the record is first added)
//
// Survey123 Repeat View layers often assign the same server timestamp as
// EditDate for every record in a batch submission, making all cards appear
// to share one time. CreationDate is stamped individually per record by
// AGOL on addFeatures, so it is unique per submission. We use
// max(EditDate, CreationDate) as the effective "last touched" time:
//   • After a drag-drop or modal edit, EditDate > CreationDate → shows EditDate
//   • For unedited Survey123 records, CreationDate is per-record → shows that
function describeEditDate(editMs, createMs, status) {
  const isActive = ACTIVE_DEPLOYMENT_STATUSES.includes(status);
  const en = editMs  == null || editMs  === '' ? NaN : Number(editMs);
  const cn = createMs == null || createMs === '' ? NaN : Number(createMs);

  // Pick the most recent valid timestamp.
  let n = NaN;
  if (Number.isFinite(en) && en > 0) n = en;
  if (Number.isFinite(cn) && cn > 0 && (Number.isNaN(n) || cn > n)) n = cn;

  const valid = Number.isFinite(n) && n > 0;

  // No edit date AND actively deployed → that's stale (and unusual)
  if (!valid) {
    return isActive
      ? { text: 'No updates', tier: 'stale' }
      : { text: null, tier: null };
  }

  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return { text: null, tier: null };

  const now = Date.now();
  const minutesAgo = Math.floor((now - n) / 60000);
  const hoursAgo   = minutesAgo / 60;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isToday = n >= startOfToday.getTime();

  const t = d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(' AM', 'a').replace(' PM', 'p');

  if (minutesAgo < 1)  return { text: 'Just now',              tier: 'hour'  };
  if (minutesAgo < 60) return { text: `${minutesAgo} min ago`, tier: 'hour'  };
  if (isToday)         return { text: `Today · ${t}`,          tier: 'today' };

  const mdy = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
  const formatted = `${mdy} ${t}`;

  // Stale ONLY for active deployments — terminal statuses (Demobilized,
  // Canceled) don't need to look stale.
  if (isActive && hoursAgo >= STALE_HOURS) {
    return { text: formatted, tier: 'stale' };
  }
  return { text: formatted, tier: null };
}

// Given a row, return { qtyLine, nameLine } describing its quantity and
// resource name. Mirrors the previous TEMA dashboard Arcade:
//   Equipment kind → "Equipment: N" / equipment name
//   Team / Personnel kind → "Personnel: N" / team kind
// Dispatch is based on `resource_kind` ONLY — never on derived fields
// like qty_item (which Survey123 sets to 1 for teams and would otherwise
// look like an equipment count of 1).
function describeResource(r) {
  const kind   = String(r[FIELDS.kind] || '').toLowerCase();
  const equipN = v(r, FIELDS.equipmentName) || v(r, FIELDS.equipmentType);
  const equipQ = v(r, FIELDS.equipmentCount);
  const teamN  = v(r, FIELDS.teamKind) || v(r, FIELDS.identifier);
  const persQ  = v(r, FIELDS.personnelCount);
  const fallbk = v(r, FIELDS.resourceMain) || v(r, FIELDS.resourceType);

  if (kind.includes('equip')) {
    const n = equipQ != null ? parseInt(equipQ, 10) : NaN;
    if (Number.isFinite(n) && n > 0) {
      return { qtyLine: `Equipment: ${n}`, nameLine: equipN || fallbk };
    }
    return { qtyLine: 'Equipment', nameLine: equipN || fallbk };
  }
  if (kind.includes('team') || kind.includes('personnel')) {
    const n = persQ != null ? parseInt(persQ, 10) : NaN;
    if (Number.isFinite(n) && n > 0) {
      return { qtyLine: `Personnel: ${n}`, nameLine: teamN || fallbk };
    }
    return { qtyLine: 'Team', nameLine: teamN || fallbk };
  }

  // No kind specified — best-effort heuristic
  if (persQ)  return { qtyLine: `Personnel: ${persQ}`, nameLine: teamN || fallbk };
  if (equipQ) return { qtyLine: `Equipment: ${equipQ}`, nameLine: equipN || fallbk };
  return { qtyLine: '', nameLine: fallbk || teamN || equipN || '' };
}

// US state name → 2-letter abbreviation. Plus DC and PR. Anything not
// in this map is left untouched.
const US_STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC', 'Puerto Rico': 'PR',
};

// Reformat a comma-separated address as "street, city, ST" — drops the
// ZIP and abbreviates the state name. Returns the input unchanged when
// the format doesn't look parseable.
function trimAddress(full) {
  if (!full) return null;
  const parts = String(full).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return full;
  // Drop trailing ZIP (5 or 5+4)
  if (/^\d{5}(-\d{4})?$/.test(parts[parts.length - 1])) parts.pop();
  // Abbreviate state — typically now the last segment
  const last = parts[parts.length - 1];
  if (US_STATE_ABBR[last]) parts[parts.length - 1] = US_STATE_ABBR[last];
  return parts.join(', ');
}

// Pick a contrasting text color for a given background hex. Uses
// luminance — bright backgrounds (yellow, light gray) get black text;
// dark backgrounds get white text. Threshold tuned for the COLUMNS
// palette so each status pill stays readable.
function pickTextColor(bg) {
  if (!bg || typeof bg !== 'string') return '#fff';
  const hex = bg.replace('#', '');
  if (hex.length < 6) return '#fff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111827' : '#ffffff';
}

// Look up the accent color for the column a given status belongs to.
function statusAccent(status) {
  const id = statusToColumnId(status);
  const col = COLUMNS.find((c) => c.id === id);
  return col ? col.accent : '#94a3b8';
}

// Format a followup epoch-ms timestamp into a short human-readable string.
// Returns null when the timestamp is missing or invalid.
function describeFollowup(ms) {
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;

  const now = Date.now();
  const minutesAgo = Math.floor((now - n) / 60000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const t = d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(' AM', 'a').replace(' PM', 'p');

  if (minutesAgo < 1)  return 'Just now';
  if (minutesAgo < 60) return `${minutesAgo} min ago`;
  if (n >= startOfToday.getTime()) return `Today · ${t}`;

  const mdy = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
  return `${mdy} ${t}`;
}

// ─── Render ────────────────────────────────────────────────────────────
function CardView({ r, pending, needsFollowup = false, lastFollowupTs = null, style, dragging = false, forwardRef, handleProps = {}, onShowDetail }) {
  const oid       = r[FIELDS.objectId];
  const reqNum    = v(r, FIELDS.requestNumber);
  const county    = v(r, FIELDS.county);
  const edit      = describeEditDate(r[FIELDS.editDate], r[FIELDS.creationDate], r[FIELDS.status]);
  const entity    = v(r, FIELDS.entity);
  const esf       = v(r, FIELDS.esf);
  const status    = v(r, FIELDS.status);
  const address   = trimAddress(v(r, 'address_geo_rpt'));
  const kindLabel = v(r, FIELDS.kind);
  const { qtyLine, nameLine } = describeResource(r);
  const statusBg  = status ? statusAccent(status) : null;
  const statusFg  = status ? pickTextColor(statusBg) : null;

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
      className={`card${dragging ? ' is-dragging' : ''}${pending ? ' is-pending' : ''}${edit.tier ? ` is-${edit.tier === 'stale' ? 'stale' : `fresh-${edit.tier}`}` : ''}${needsFollowup ? ' needs-followup' : ''}`}
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
          <div className="card-title-row">
            <div className="card-title">{reqNum ? `#${reqNum}` : '—'}</div>
            {needsFollowup && !dragging && (
              <div className="followup-needed small">
                <span className="followup-dot" aria-hidden="true" />
                Followup needed
              </div>
            )}
          </div>
          {county && <div className="card-county">{county} County</div>}
          {edit.text && (
            <div className={`card-updated small${edit.tier ? ` is-${edit.tier === 'stale' ? 'stale' : `fresh-${edit.tier}`}` : ' muted'}`}>
              {edit.tier === 'hour'  && <span className="fresh-dot" aria-hidden="true" />}
              {edit.tier === 'stale' && <span className="stale-dot" aria-hidden="true" />}
              Updated {edit.text}
            </div>
          )}
          {status && !dragging && (
            <span
              className="card-status-pill"
              style={{ background: statusBg, color: statusFg }}
            >
              {status}
            </span>
          )}
        </div>
        <div className="card-right">
          {kindLabel && <div className="card-kind">{kindLabel}</div>}
          {qtyLine && <div className="card-qty">{qtyLine}</div>}
          {nameLine && <div className="card-name">{nameLine}</div>}
          {(entity || address) && (
            <div className="card-entity muted small">
              {[entity, address].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
      <div className="card-footer">
        {esf     && <span className="card-chip">ESF · {esf}</span>}
        {!dragging && (() => {
          const fuText = describeFollowup(lastFollowupTs);
          return fuText
            ? <span className="card-chip card-followup-chip">Followup · {fuText}</span>
            : null;
        })()}
        {pending && <span className="card-pending">Saving…</span>}
      </div>
    </div>
  );
}
