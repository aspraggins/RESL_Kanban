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
//  Dropdowns + Search (flex-extends to the right) + Clear. `lockedFilters`
//  is a Set of filter keys (e.g. {'mission','esf'}) that came from URL
//  parameters at boot — those dropdowns render disabled with a lock
//  marker and are excluded from the active-count and Clear behavior.
export function MainFilters({ resources, filters, onFilters, lockedFilters = new Set() }) {
  const missions = useMemo(() => uniques(resources, 'mission_id_rpt'), [resources]);
  const esfs     = useMemo(() => uniques(resources, 'coordinator'),    [resources]);
  const counties = useMemo(() => uniques(resources, 'county_rpt'),     [resources]);
  const kinds    = useMemo(() => uniques(resources, 'resource_kind'),  [resources]);

  const set = (patch) => onFilters({ ...filters, ...patch });
  const isLocked = (key) => lockedFilters.has(key);

  const activeCount =
    (filters.mission && !isLocked('mission') ? 1 : 0) +
    (filters.esf     && !isLocked('esf')     ? 1 : 0) +
    (filters.county  && !isLocked('county')  ? 1 : 0) +
    (filters.kind    && !isLocked('kind')    ? 1 : 0) +
    (filters.search  ? 1 : 0);

  const clearFilters = () => {
    onFilters({
      ...filters,
      mission: isLocked('mission') ? filters.mission : '',
      esf:     isLocked('esf')     ? filters.esf     : '',
      kind:    isLocked('kind')    ? filters.kind    : '',
      county:  isLocked('county')  ? filters.county  : '',
      search:  '',
    });
  };

  return (
    <div className="main-filters">
      <Select label="Mission"          value={filters.mission} options={missions} onChange={(v) => set({ mission: v })} locked={isLocked('mission')} />
      <Select label="Coordinating ESF" value={filters.esf}     options={esfs}     onChange={(v) => set({ esf: v })}     locked={isLocked('esf')} />
      <Select label="Kind"             value={filters.kind}    options={kinds}    onChange={(v) => set({ kind: v })}    locked={isLocked('kind')} />
      <Select label="County"           value={filters.county}  options={counties} onChange={(v) => set({ county: v })}  locked={isLocked('county')} />
      <label className="filter-select filter-select--search">
        <span className="muted small">Search</span>
        <input
          className="filter-search"
          type="search"
          placeholder="Tag, item, requestor… (#5 for request)"
          title="Type # followed by a request number (e.g. #5) to search by request number only"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </label>
      {activeCount > 0 && (
        <button className="btn btn-ghost btn-sm clear-btn" onClick={clearFilters}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}

// ─── Sort toggle (toolbar row, between count info and columns) ──────
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

// ─── Column toggles (toolbar row, after sort) ───────────────────────
export function ColumnToggles({ hiddenColumns, onToggleColumn, onResetColumns }) {
  const anyHidden = hiddenColumns.size > 0;
  return (
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
  );
}

function Select({ label, value, options, onChange, locked = false }) {
  // When locked (set via URL), the dropdown is disabled and only shows
  // the current value so the displayed text matches what's stored.
  return (
    <label className={`filter-select${locked ? ' is-locked' : ''}`}>
      <span className="muted small">
        {locked && <span className="lock-glyph" aria-hidden="true">🔒 </span>}
        {label}{locked && ' (locked)'}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={locked}
        title={locked ? 'Locked by URL parameter' : undefined}
      >
        {locked ? (
          <option value={value}>{value}</option>
        ) : (
          <>
            <option value="">All</option>
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </>
        )}
      </select>
    </label>
  );
}
