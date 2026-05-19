import { useMemo } from 'react';
import { MCC_SERVICE } from '../config.js';

// Aggregate MCCs + resources into one mission entry per distinct
// incidentid. The MCC layer is the source of truth — every mission
// with at least one official MCC shows up here, even if it has no
// resource deployments yet. The resources list contributes a deployment
// count (a useful tell that a mission is "open but unattended" — high
// MCC count, low deployment count).
function summarizeMissions(mccs, resources) {
  const mf = MCC_SERVICE.fields;
  const stats = new Map(); // name → { name, mccCount, deployCount, latestEdit }

  const ensure = (name) => {
    let entry = stats.get(name);
    if (!entry) {
      entry = { name, mccCount: 0, deployCount: 0, latestEdit: 0 };
      stats.set(name, entry);
    }
    return entry;
  };

  for (const m of mccs) {
    const raw = m[mf.incidentId];
    if (!raw) continue;
    const name = String(raw).trim();
    if (!name) continue;
    const entry = ensure(name);
    entry.mccCount += 1;
    // Use EditDate (or CreationDate as fallback) to track recency.
    const edit = Number(m[mf.editDate] ?? m[mf.creationDate]);
    if (Number.isFinite(edit) && edit > entry.latestEdit) {
      entry.latestEdit = edit;
    }
  }

  for (const r of resources) {
    const raw = r.mission_id_rpt;
    if (!raw) continue;
    const name = String(raw).trim();
    if (!name) continue;
    // Defensive: a deployment may exist for a mission that has no
    // official MCC yet (e.g. test data, or an MCC deleted out from
    // under it). Still surface that mission so the user can manage it.
    const entry = ensure(name);
    entry.deployCount += 1;
    const edit = Number(r.EditDate);
    if (Number.isFinite(edit) && edit > entry.latestEdit) {
      entry.latestEdit = edit;
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

export default function MissionPicker({ resources, mccs = [], loading, allowedMissions, onPick }) {
  const missions = useMemo(() => {
    let m = summarizeMissions(mccs, resources);
    if (allowedMissions && allowedMissions.length) {
      const allow = new Set(
        allowedMissions.map((s) => String(s).trim().toLowerCase()),
      );
      m = m.filter((x) => allow.has(String(x.name).trim().toLowerCase()));
    }
    return m;
  }, [resources, mccs, allowedMissions]);

  return (
    <div className="picker-wrap">
      <div className="picker-card">
        <h1>Choose a mission</h1>
        <p className="muted">
          Pick a mission to view its MCCs and resource deployments. You can
          switch missions from the dropdown at the top of the board after.
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
              The MCC layer returned no records. Check the service URL in
              src/config.js or your account permissions.
            </p>
          </div>
        ) : (
          <>
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
                    <span>
                      <strong>{m.mccCount}</strong> MCC{m.mccCount === 1 ? '' : 's'}
                    </span>
                    <span className="dot">·</span>
                    <span>
                      <strong>{m.deployCount}</strong> deployment{m.deployCount === 1 ? '' : 's'}
                    </span>
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
            <p className="picker-note muted small">
              Missions appear here as soon as their first MCC is filed.
              Pick a mission to start creating deployments for the MCCs
              that don't have one yet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
