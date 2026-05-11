import { useMemo } from 'react';

// Compute the most-recent EditDate per mission. Used to sort the picker
// so the latest mission lands at the top.
function summarizeMissions(resources) {
  const stats = new Map(); // mission_id_rpt → { count, latestEdit }
  for (const r of resources) {
    const m = r.mission_id_rpt;
    if (!m) continue;
    const name = String(m).trim();
    if (!name) continue;
    const edit = Number(r.EditDate);
    const existing = stats.get(name);
    if (existing) {
      existing.count += 1;
      if (Number.isFinite(edit) && edit > existing.latestEdit) existing.latestEdit = edit;
    } else {
      stats.set(name, {
        name,
        count: 1,
        latestEdit: Number.isFinite(edit) ? edit : 0,
      });
    }
  }
  return Array.from(stats.values()).sort((a, b) => b.latestEdit - a.latestEdit);
}

function fmtRelative(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `Latest activity: ${d.toLocaleString()}`;
}

export default function MissionPicker({ resources, loading, onPick }) {
  const missions = useMemo(() => summarizeMissions(resources), [resources]);

  return (
    <div className="picker-wrap">
      <div className="picker-card">
        <h1>Choose a mission</h1>
        <p className="muted">
          Pick a mission to view its resource deployments. You can switch
          missions from the dropdown at the top of the board after.
        </p>

        {loading && missions.length === 0 ? (
          <div className="boot-screen">
            <div className="spinner" />
            <p>Loading missions…</p>
          </div>
        ) : missions.length === 0 ? (
          <div className="picker-empty">
            <strong>No missions found.</strong>
            <p className="muted small">
              The feature service returned data but no records have a
              mission_id_rpt value. Check the layer or your account
              permissions.
            </p>
          </div>
        ) : (
          <div className="mission-list" role="list">
            {missions.map((m) => (
              <button
                key={m.name}
                type="button"
                className="mission-row"
                role="listitem"
                onClick={() => onPick(m.name)}
              >
                <div className="mission-name">{m.name}</div>
                <div className="mission-meta muted small">
                  <span><strong>{m.count}</strong> resource{m.count === 1 ? '' : 's'}</span>
                  {m.latestEdit > 0 && (
                    <>
                      <span className="dot">·</span>
                      <span>{fmtRelative(m.latestEdit)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
