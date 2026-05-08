import { useMemo } from 'react';
import { COLUMNS } from '../config.js';

// Compute unique non-empty values for a field, sorted alphabetically.
function uniques(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

// ─── Header row: dropdowns + clear ────────────────────────────────────
// Renders inline in the app header alongside the brand and sign-out btn.
export function HeaderFilters({
  resources,
  filters,
  onFilters,
  hiddenColumns,
  onResetColumns,
}) {
  const missions = useMemo(() => uniques(resources, 'mission_id_rpt'), [resources]);
  const esfs     = useMemo(() => uniques(resources, 'coordinator'),    [resources]);
  const counties = useMemo(() => uniques(resources, 'county_rpt'),     [resources]);
  const kinds    = useMemo(() => uniques(resources, 'resource_kind'),  [resources]);

  const set = (patch) => onFilters({ ...filters, ...patch });

  const activeCount =
    (filters.mission ? 1 : 0) +
    (filters.esf     ? 1 : 0) +
    (filters.county  ? 1 : 0) +
    (filters.kind    ? 1 : 0) +
    (filters.search  ? 1 : 0) +
    (hiddenColumns.size > 0 ? 1 : 0);

  const clearAll = () => {
    onFilters({ mission: '', esf: '', county: '', kind: '', search: '' });
    onResetColumns && onResetColumns();
  };

  return (
    <div className="header-filters">
      <Select label="Mission"          value={filters.mission} options={missions} onChange={(v) => set({ mission: v })} />
      <Select label="Coordinating ESF" value={filters.esf}     options={esfs}     onChange={(v) => set({ esf: v })} />
      <Select label="Kind"             value={filters.kind}    options={kinds}    onChange={(v) => set({ kind: v })} />
      <Select label="County"           value={filters.county}  options={counties} onChange={(v) => set({ county: v })} />
      {activeCount > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={clearAll}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}

// ─── Secondary row: column toggles + search ──────────────────────────
export function ColumnFilters({
  filters,
  onFilters,
  hiddenColumns,
  onToggleColumn,
}) {
  return (
    <div className="filter-bar">
      <div className="column-toggles">
        <span className="muted small">Columns:</span>
        {COLUMNS.map((c) => {
          const hidden = hiddenColumns.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={`column-toggle${hidden ? ' is-off' : ''}`}
              style={{ '--toggle-accent': c.accent }}
              onClick={() => onToggleColumn(c.id)}
              title={hidden ? `Show ${c.label}` : `Hide ${c.label}`}
            >
              <span className="column-toggle-dot" />
              {c.label}
            </button>
          );
        })}
      </div>
      <input
        className="filter-search"
        type="search"
        placeholder="Search…"
        value={filters.search}
        onChange={(e) => onFilters({ ...filters, search: e.target.value })}
      />
    </div>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="filter-select">
      <span className="muted small">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
