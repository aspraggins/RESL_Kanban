# Reusable Patterns

Code-level patterns from `resl-kanban` that should ride along to sibling
apps. Each section names the file in this repo where the pattern lives,
so you can grep for the canonical version.

## 1. OAuth flow (`src/auth.js`)

Copy this file as-is. Two things to change per app:

- `localStorage` key: rename `resl_kanban_token_v1` so apps don't share
  a token cache.
- `postMessage` discriminator: change every occurrence of
  `resl_kanban_oauth` to a new app-unique string so two embedded apps
  don't intercept each other's auth callbacks.

The popup-vs-redirect logic is iframe-aware (`isInIframe()`); do not
remove. It's what makes the app work inside Experience Builder.

## 2. Service helpers (`src/service.js`)

Generic pattern:

```js
async function arcgisFetch(url, init, _retried) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) {
    if ((data.error.code === 498 || data.error.code === 499) && !_retried) {
      await ensureFreshToken();
      const fresh = getToken();
      const newUrl = url.replace(/([?&]token=)[^&]+/, `$1${encodeURIComponent(fresh.accessToken)}`);
      if (init?.body instanceof URLSearchParams) init.body.set('token', fresh.accessToken);
      return arcgisFetch(newUrl, init, true);
    }
    throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
  }
  return data;
}
```

This handles:
- HTTP-level errors
- AGOL error envelopes (`data.error.code/message`)
- One silent token refresh + retry on 498/499 (expired/invalid token)
- Both GET (token in URL) and POST (token in `URLSearchParams` body)

Build your `fetchAll…` and `updateAttributes` functions on top of it.

### Multi-service variant (for the new list+follow-ups app)

When the app touches more than one feature service:

```js
// config.js
export const SERVICES = {
  items: {
    url: '…/FeatureServer/0',
    fields: {
      objectId: 'objectid',
      title:    'item_title',
      status:   'item_status',
      // …
    },
  },
  followups: {
    url: '…/FeatureServer/1',
    fields: {
      objectId: 'objectid',
      parentId: 'item_globalid',   // FK back to items.globalid
      note:     'note_text',
      createdBy:'created_by',
      // …
    },
  },
};
```

Then in `service.js`:

```js
export async function fetchAll(serviceKey, where = '1=1') {
  const cfg = SERVICES[serviceKey];
  await ensureFreshToken();
  const TOKEN = getToken();
  // paged query against cfg.url …
}
export async function updateAttributes(serviceKey, objectId, partial) {
  const cfg = SERVICES[serviceKey];
  // applyEdits against cfg.url …
}
```

Components read `SERVICES.items.fields.title` instead of literal strings.

### Related records (parent → followups)

For "list with follow-ups" the natural shape is:

- Items service: `globalid` is the parent identifier.
- Followups service: each row has a foreign key (`parentglobalid` or
  similar) pointing back to an item.

Fetch strategies:
1. **Eager**: load all items AND all followups at boot, group followups
   by parent client-side. Best for small datasets (< 5k followups).
2. **Lazy**: load items at boot, fetch followups for an item only when
   the user opens its detail. Good for large datasets.
3. **Joined query**: AGOL supports `?relationshipId=N` queries on
   layers that declare a relationship; one round-trip returns parent +
   children. Best when the schema is set up for it.

Pick (1) if you can — simplest to reason about, fastest UI.

## 3. Optimistic update with rollback (`Board.jsx` drag handlers and detail update)

```js
const before = items.find(r => r[FIELDS.objectId] === oid);
const snapshot = {};
for (const k of Object.keys(partial)) snapshot[k] = before[k];
snapshot[FIELDS.editDate] = before[FIELDS.editDate];

// optimistic
setItems(rs => rs.map(r =>
  r[FIELDS.objectId] === oid
    ? { ...r, ...partial, [FIELDS.editDate]: Date.now() }
    : r
));
setPending(p => new Set(p).add(oid));

try {
  await updateAttributes(oid, partial);
} catch (err) {
  // rollback
  setItems(rs => rs.map(r =>
    r[FIELDS.objectId] === oid ? { ...r, ...snapshot } : r
  ));
  setError(err.message);
} finally {
  setPending(p => { const n = new Set(p); n.delete(oid); return n; });
}
```

Always include `EditDate` in both the optimistic update and the
snapshot — otherwise the freshness highlight fires (or doesn't) in
ways that don't match server reality after a rollback.

## 4. URL parameter locking (`Board.jsx` readUrlFilters + Select.locked)

```js
const LOCKABLE = ['mission', 'esf', 'county', 'kind'];

function readUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  const values = {};
  const locked = new Set();
  for (const k of LOCKABLE) {
    const raw = params.get(k);
    if (!raw?.trim()) continue;
    values[k] = raw.trim();
    locked.add(k);
  }
  return { values, locked };
}
```

When a filter is locked:
- Render a non-editable display element (we use a wrapping `<div class="locked-value">`, not a disabled `<select>`, so long values aren't truncated).
- Exclude from the active-count.
- Don't reset on "Clear".
- The `setFilters` wrapper *enforces* the lock — even if a child component tries to overwrite a locked key, it can't.

## 5. Post-auth gate (`MissionPicker.jsx`)

Some apps need the user to pick a scope before the main view renders.
The pattern:

```jsx
const needsPick = !filters.scope && !lockedFilters.has('scope');

return (
  <div className="app-shell">
    <header>…</header>
    {needsPick
      ? <ScopePicker items={items} onPick={(s) => setFilters({…, scope: s})} />
      : <FullApp />}
  </div>
);
```

The picker is just a list of distinct scope values from the loaded data,
sorted by recent activity. URL params bypass the picker (`?scope=…`).
Users can switch scope later via a normal dropdown (with the "All"
option suppressed via the `required` prop on `<Select>`).

For the list+follow-ups app, the scope is probably the parent service:
"pick a [project / mission / case / area] to view its items".

## 6. Detail modal with inline edit (`DetailModal.jsx`)

- Renders nothing when `r` is `null`; render gates by setting/clearing
  `detailRow` state.
- ESC key handler is attached/detached based on `r`.
- Backdrop click closes; modal-body click stops propagation.
- Sections with no populated rows are hidden entirely (the `Section`
  component does the filtering).
- Editable rows (e.g., dropdowns) live alongside read-only rows in the
  same `dl`; the row component picks the variant based on the
  `editable: true` flag in the row config.

The modal calls a parent-provided `onUpdate(objectId, partial)`. The
parent (Board) wraps that in the optimistic-update pattern (§3).

## 7. Freshness highlights (`Card.jsx` describeEditDate)

Returns `{ text, tier }` from `EditDate`:

- `tier = 'hour'` if edited in the last 60 min → blue + pulse
- `tier = 'today'` if edited since local midnight → soft blue
- `tier = 'stale'` if active status AND > 72 hours old → amber
- `null` otherwise

The card root gets a class like `is-fresh-hour` / `is-stale`. CSS
handles the visual treatment via `color-mix` and `@keyframes`.

For the followups app, the analog might be:
- Last touched in last hour → blue
- Awaiting follow-up for > N days → amber

Tune the `ACTIVE_STATUSES` list to whatever "needs attention" means in
the new context.

## 8. Container queries for narrow cards (`styles.css` @container)

```css
.card { container-type: inline-size; }
@container (max-width: 270px) {
  .card-grid { grid-template-columns: 1fr; gap: 4px; }
}
```

When a card is squeezed (e.g., narrow column or small viewport), it
reflows from two-column to one-column without media queries. Use for
any card layout that has to live in flexible-width containers.

## 9. Brand and TN flag (`Brand.jsx`, `TnBadge.jsx`)

Inline SVG, no image files. Copy `TnBadge.jsx` as-is into the new app
so the family of TEMA apps has consistent identity. `Brand.jsx` just
composes the badge with the app title.

## 10. Deploy workflow (`.github/workflows/deploy.yml`)

Copy as-is. The workflow:
- Uses `npm ci || npm install` so it works without a committed lockfile.
- Sets `VITE_BASE_PATH=/${{ github.event.repository.name }}/` so asset
  URLs survive being loaded with or without a trailing slash.
- Accepts repository Variables (`VITE_CLIENT_ID`, `VITE_SERVICE_URL`)
  to override the defaults in `src/config.js` at build time.
