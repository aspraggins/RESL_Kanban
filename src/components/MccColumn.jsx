import { MCC_SERVICE } from '../config.js';

// MCC column — source of deployments. Not a drag-drop target. Cards
// render basic MCC info and open a read-only popup when clicked.
export default function MccColumn({ label, accent, mccs, onShowDetail }) {
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
          mccs.map((m) => (
            <MccCard
              key={m[MCC_SERVICE.fields.objectId] ?? m[MCC_SERVICE.fields.globalId]}
              m={m}
              onClick={() => onShowDetail && onShowDetail(m)}
            />
          ))
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

function MccCard({ m, onClick }) {
  const f = MCC_SERVICE.fields;
  const mccNum   = v(m, f.mccNumber);
  const subject  = v(m, f.subject);
  const type     = v(m, f.type);
  const priority = v(m, f.priority);
  const status   = v(m, f.status);
  const county   = v(m, f.county);
  const poc      = v(m, f.pocName);

  return (
    <button
      type="button"
      className="card mcc-card"
      onClick={onClick}
    >
      <div className="card-grid">
        <div className="card-left">
          <div className="card-title">{mccNum ? `MCC #${mccNum}` : '—'}</div>
          {county && <div className="card-county">{county} County</div>}
          {status && <div className="card-updated muted small">{status}</div>}
        </div>
        <div className="card-right">
          {type && <div className="card-qty">{type}</div>}
          {subject && <div className="card-name">{subject}</div>}
          {poc && <div className="card-entity muted small">{poc}</div>}
        </div>
      </div>
      {priority && (
        <div className="card-footer">
          <span className="card-chip">Priority · {priority}</span>
        </div>
      )}
    </button>
  );
}
