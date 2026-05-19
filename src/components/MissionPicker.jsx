import { useMemo, useState } from 'react';
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
  const [query, setQuery] = useState('');

  // Build the full mission list once per data-set change; the search
  // filter runs as a cheap second pass on top so we don't have to
  // re-aggregate on every keystroke.
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return missions;
    return missions.filter((m) => m.name.toLowerCase().includes(q));
  }, [missions, query]);

  const hasMissions = missions.length > 0;
  const onSearchKey = (e) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      onPick(filtered[0].name);
    }
  };

  return (
    <div className="picker-wrap">
      <div className="picker-card">
        <header className="picker-head">
          <h1>Choose a mission</h1>
          <p className="muted">
            Pick a mission to view its MCCs and resource deployments. You can
            switch missions from the dropdown at the top of the board after.
          </p>
          {hasMissions && (
            <div className="picker-search-row">
              <input
                type="search"
                className="picker-search"
                placeholder={`Search ${missions.length} mission${missions.length === 1 ? '' : 's'}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                autoFocus
              />
              {query && (
                <span className="muted small picker-search-count">
                  {filtered.length} of {missions.length}
                </span>
              )}
            </div>
          )}
        </header>

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
        ) : filtered.length === 0 ? (
          <div className="picker-empty">
            <strong>No matches.</strong>
            <p className="muted small">
              No mission name contains "{query}". Press Escape to clear the
              search.
            </p>
          </div>
        ) : (
          <div className="mission-list" role="list">
            {filtered.map((m) => (
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
        )}

        {hasMissions && (
          <p className="picker-note muted small">
            Missions appear here as soon as their first MCC is filed. Pick a
            mission to start creating deployments for the MCCs that don't have
            one yet.
          </p>
        )}
      </div>
    </div>
  );
}
