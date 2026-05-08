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

// ─── Main filters row (row 2) ───────────────────────────────────────
//  Dropdowns + Columns + Clear. Clear only resets the four dropdowns;
//  Columns has its own "Show all" link. Sort lives in the toolbar.
export function MainFilters({
  resources,
  filters,
  onFilters,
  hiddenColumns,
  onToggleColumn,
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
    (filters.kind    ? 1 : 0);

  const clearFilters = () => {
    onFilters({ ...filters, mission: '', esf: '', county: '', kind: '' });
  };

  const anyHidden = hiddenColumns.size > 0;

  return (
    <div className="main-filters">
      <Select label="Mission"          value={filters.mission} options={missions} onChange={(v) => set({ mission: v })} />
      <Select label="Coordinating ESF" value={filters.esf}     options={esfs}     onChange={(v) => set({ esf: v })} />
      <Select label="Kind"             value={filters.kind}    options={kinds}    onChange={(v) => set({ kind: v })} />
      <Select label="County"           value={filters.county}  options={counties} onChange={(v) => set({ county: v })} />

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
        {anyHidden && (
          <button
            type="button"
            className="link-btn"
            onClick={onResetColumns}
            title="Show all columns"
          >
            Show all
          </button>
        )}
      </div>

      {activeCount > 0 && (
        <button className="btn btn-ghost btn-sm clear-btn" onClick={clearFilters}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}

// ─── Sort toggle (toolbar row, between count info and search) ──────
export function SortToggle({ sortBy, onSortBy }) {
  return (
    <div className="sort-toggle" role="group" aria-label="Sort cards by">
      <span className="muted small">Sort:</span>
      <button
        type="button"
        className={`seg-btn${sortBy === 'updated' ? ' is-on' : ''}`}
        onClick={() => onSortBy('updated')}
        title="Most recently edited at top"
      >
        Updated
      </button>
      <button
        type="button"
        className={`seg-btn${sortBy === 'request' ? ' is-on' : ''}`}
        onClick={() => onSortBy('request')}
        title="Lowest request number at top"
      >
        Request #
      </button>
    </div>
  );
}

// ─── Search box (lives in the toolbar row, beside the count) ─────────
export function ToolbarSearch({ filters, onFilters }) {
  return (
    <label className="toolbar-search">
      <span className="muted small">Search</span>
      <input
        className="filter-search"
        type="search"
        placeholder="Tag, item, requestor…"
        value={filters.search}
        onChange={(e) => onFilters({ ...filters, search: e.target.value })}
      />
    </label>
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
