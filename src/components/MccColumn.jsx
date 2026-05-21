import { useDroppable } from '@dnd-kit/core';
import { MCC_SERVICE } from '../config.js';

// Same forgiving formatter as DetailModal — handles epoch ms AND ISO
// date strings (some MCC date fields are stored as strings).
function fmtDateTime(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  const d2 = new Date(String(v));
  if (!Number.isNaN(d2.getTime())) return d2.toLocaleString();
  return String(v);
}

// Mirror Card.jsx's describeEditDate freshness tiers for a generic
// timestamp (no "stale" tier since MCC cards aren't tied to an active
// deployment status).
function describeRecent(ms) {
  if (ms == null || ms === '') return { text: null, tier: null };
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return { text: null, tier: null };
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return { text: null, tier: null };

  const now = Date.now();
  const minutesAgo = Math.floor((now - n) / 60000);

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
  return { text: `${mdy} ${t}`, tier: null };
}

// MCC column — source of deployments. Not a drag-drop target. Cards
// render basic MCC info and open a read-only popup when clicked.
export default function MccColumn({ label, accent, mccs, latestFollowupByMcc, mccNeedsFollowupSet, onFilter, onShowDetail }) {
  return (
    <div className="column is-static" style={{ '--column-accent': accent }}>
      <header className="column-header">
        <span className="column-dot" />
        <span className="column-label">{label}</span>
        <span className="column-count">{mccs.length}</span>
      </header>
      <div className="column-body">
        {mccs.length === 0 ? (
          <div className="empty-hint">No MCC requests for this mission.</div>
        ) : (
          mccs.map((m) => {
            const num = m[MCC_SERVICE.fields.mccNumber];
            const key = num != null ? String(num).trim() : '';
            const lastFu = key && latestFollowupByMcc ? latestFollowupByMcc.get(key) : null;
            const needsFollowup = key && mccNeedsFollowupSet ? mccNeedsFollowupSet.has(key) : false;
            return (
              <MccCard
                key={m[MCC_SERVICE.fields.objectId] ?? m[MCC_SERVICE.fields.globalId]}
                m={m}
                lastFollowupTs={lastFu}
                needsFollowup={needsFollowup}
                onFilter={() => onFilter && onFilter(m)}
                onShowDetail={() => onShowDetail && onShowDetail(m)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

const v = (m, k) => {
  if (!k) return null;
  const x = m[k];
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s.length ? s : null;
};

function MccCard({ m, lastFollowupTs, needsFollowup = false, onFilter, onShowDetail }) {
  const f = MCC_SERVICE.fields;
  const mccNum   = v(m, f.mccNumber);
  const subject  = v(m, f.subject);
  const type     = v(m, f.type);
  const priority = v(m, f.priority);
  const status   = v(m, f.status);
  const county   = v(m, f.county);
  const entry    = fmtDateTime(m[f.entryDate] || m[f.mccCreated] || m[f.creationDate]);
  const edited   = fmtDateTime(m[f.editDate]);
  const lastFu   = describeRecent(lastFollowupTs);

  // Register the card as a drop target for inventory drags. The
  // `mcc:` id prefix lets Board.jsx's onDragEnd identify what kind of
  // drop happened (vs. status-column drops which use raw column ids).
  // `data.mcc` carries the full MCC record through to the drop handler
  // so it can build the new deployment without re-looking-up.
  const mccOid = m[f.objectId];
  const { isOver, setNodeRef, active } = useDroppable({
    id:       `mcc:${mccOid}`,
    data:     { type: 'mcc', mcc: m },
    // Only highlight when an inventory drag is hovering — status drags
    // can pass over MCC cards without triggering the drop styling.
    disabled: false,
  });
  const isInventoryDrag = active && active.data && active.data.current
    && active.data.current.type === 'inventory';
  const dropClass = (isOver && isInventoryDrag) ? ' is-drop-target' : '';

  // Stop pointer/click on the info button from also triggering the
  // card-level filter.
  const swallow = (e) => e.stopPropagation();
  const handleInfoClick = (e) => { e.stopPropagation(); onShowDetail && onShowDetail(); };
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFilter && onFilter();
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`card mcc-card${lastFu.tier ? ` is-fresh-${lastFu.tier}` : ''}${needsFollowup ? ' needs-followup' : ''}${dropClass}`}
      role="button"
      tabIndex={0}
      onClick={onFilter}
      onKeyDown={handleKey}

    >
      <button
        type="button"
        className="card-info-btn"
        onPointerDown={swallow}
        onMouseDown={swallow}
        onTouchStart={swallow}
        onClick={handleInfoClick}
        title="Show MCC details"
        aria-label="Show MCC details"
      >
        ⓘ
      </button>
      <div className="card-grid">
        <div className="card-left">
          <div className="card-title-row">
            <div className="card-title">{mccNum ? `MCC #${mccNum}` : '—'}</div>
            {needsFollowup && (
              <div className="followup-needed small">
                <span className="followup-dot" aria-hidden="true" />
                Followup needed
              </div>
            )}
          </div>
          {county && <div className="card-county">{county} County</div>}
          {lastFu.text && (
            <div className={`card-updated small${lastFu.tier ? ` is-fresh-${lastFu.tier}` : ' muted'}`}>
              {lastFu.tier === 'hour' && <span className="fresh-dot" aria-hidden="true" />}
              Last followup {lastFu.text}
            </div>
          )}
          {status && <div className="card-county muted small">{status}</div>}
        </div>
        <div className="card-right">
          {type && <div className="card-qty">{type}</div>}
          {subject && <div className="card-name">{subject}</div>}
        </div>
      </div>
      {(priority || entry || edited) && (
        <div className="card-footer">
          {priority && <span className="card-chip">Priority · {priority}</span>}
          {entry  && <span className="card-chip">Entered {entry}</span>}
          {edited && <span className="card-chip">Updated {edited}</span>}
        </div>
      )}
    </div>
  );
}
