# Starting a New TEMA AGOL App

Step-by-step for spinning up a sibling app to `resl-kanban`. Designed
for the list+follow-ups use case but generalizes.

## 1. Copy the skeleton

```bash
# from the parent folder that contains resl-kanban/
cp -r resl-kanban/ new-app-name/
cd new-app-name
rm -rf node_modules .git
```

Or, on Windows / in the Cowork workspace, duplicate the `resl-kanban/`
folder and rename it.

## 2. Rename project-level identifiers

Files to edit:

| File | What to change |
| --- | --- |
| `package.json` | `name`, `description` |
| `index.html` | `<title>` |
| `README.md` | Title, deploy URLs, screenshots |
| `src/components/Brand.jsx` | Display title (keep the TN badge) |
| `src/components/Login.jsx` | `<h1>` text on the login card |
| `src/auth.js` | `postMessage` discriminator (find `resl_kanban_oauth`, replace with a new app-unique string) |
| `src/config.js` | `tokenKey` (e.g., `new_app_token_v1`) so sessions don't clash with resl-kanban |

## 3. Replace `src/config.js`

The hardest file to copy because it encodes the data model. Start from
scratch:

```js
function detectRedirectUri() { /* same as resl-kanban */ }

export const CONFIG = {
  clientId:     import.meta.env.VITE_CLIENT_ID || 'AGOL_APP_ID_HERE',
  redirectUri:  detectRedirectUri(),
  authorizeUrl: 'https://www.arcgis.com/sharing/rest/oauth2/authorize',
  tokenUrl:     'https://www.arcgis.com/sharing/rest/oauth2/token',
  signOutUrl:   'https://www.arcgis.com/sharing/rest/oauth2/signout',
  tokenExpirationMinutes: 20160,
  refreshBufferMs: 5 * 60 * 1000,
  refreshInterval: 60 * 1000,
  tokenKey: 'new_app_token_v1',
};

// Multi-service shape (see PATTERNS.md §2)
export const SERVICES = {
  items: {
    url: 'https://services1.arcgis.com/.../FeatureServer/0',
    fields: {
      objectId: 'objectid',
      globalId: 'globalid',
      title:    '…',          // field shown on each row
      status:   '…',          // field for status badges
      // …
    },
  },
  followups: {
    url: 'https://services1.arcgis.com/.../FeatureServer/1',
    fields: {
      objectId: 'objectid',
      parentId: 'parentglobalid',  // FK back to items.globalid
      note:     '…',
      author:   '…',
      // …
    },
  },
};
```

## 4. Replace the UI components

`Board.jsx`, `Column.jsx`, `Card.jsx`, `FilterBar.jsx`, `MissionPicker.jsx`
are kanban-specific. For a list+follow-ups app, replace with:

- `List.jsx` — root list view. Reuses the toolbar/filter/header pattern.
- `Row.jsx` — single item row (or `Card.jsx` reshaped). Same freshness
  highlights and corner ⓘ button.
- `DetailPanel.jsx` — replaces `DetailModal.jsx`. Shows item fields
  PLUS a follow-ups subview (timeline or chronological list of
  followup records).
- `FollowupComposer.jsx` (new) — small form to add a new followup
  record (writes to `SERVICES.followups`).
- `ScopePicker.jsx` (replaces `MissionPicker.jsx`) — post-OAuth gate;
  same pattern.

Keep from `resl-kanban` essentially as-is:

- `auth.js` (just rename the discriminator)
- `service.js` (refactor to take a `serviceKey` parameter — see PATTERNS.md §2)
- `Brand.jsx`, `TnBadge.jsx`
- `styles.css` — keep the `:root` tokens, the boot screen, the modal,
  the freshness highlights, the toolbar / filter-bar styles. Strip the
  `.column`, `.card`, `.board` rules and replace with list/row rules.

## 5. AGOL OAuth app

1. **arcgis.com → Content → Add Item → Application** (Native, with
   PKCE).
2. **Settings → App Registration → Redirect URIs**, add:
   - `http://localhost:5173/` (Vite dev)
   - `https://<github-user>.github.io/<new-repo>/` (GitHub Pages)
   - Any Experience Builder host URL the iframe will sit on
3. Copy the App ID into `CONFIG.clientId` (or set as a GitHub Actions
   repo Variable named `VITE_CLIENT_ID`).

## 6. GitHub repo + Pages

```bash
git init
git add -A
git commit -m "Initial commit — forked from resl-kanban"
# create repo on github.com, then:
git remote add origin git@github.com:<user>/<new-repo>.git
git push -u origin main
```

In the repo settings:
1. **Settings → Pages → Source = GitHub Actions**.
2. Push triggers `.github/workflows/deploy.yml`. The workflow auto-detects
   the repo name for `VITE_BASE_PATH`.
3. After the first run, Pages URL appears in **Settings → Pages**.
4. Add the Pages URL to the AGOL app's redirect URI list (step 5 above).

## 7. Local dev

```bash
npm install
npm run dev
```

Visit <http://localhost:5173/>. The first run will surface any missing
AGOL fields in the DevTools console (the layer-metadata diagnostic in
`service.js`).

## 8. Sanity checklist before sharing

- [ ] Sign in works locally (`localhost:5173`)
- [ ] Sign in works on the deployed URL (Pages site is in AGOL redirect URI list)
- [ ] Sign in works inside Experience Builder (popup flow)
- [ ] Freshness highlights fire when you edit a record
- [ ] Optimistic update rolls back on a synthetic error (try editing while
      offline)
- [ ] URL parameter locking works (`?scope=…&otherFilter=…`)
- [ ] The detail panel renders all expected fields; empty sections hide
- [ ] Auto-refresh tick is at the right cadence for the app's purpose
      (1 min for live ops; 5+ min for slower-moving data)
- [ ] All AGOL field names live in `config.js`, not scattered through components

## 9. Common gotchas

- **Blank page after first deploy** — Pages source was set to "Deploy
  from a branch" instead of "GitHub Actions". Fix in Settings → Pages.
- **400 "Invalid query parameters"** — `outFields` references a field
  that doesn't exist. Switch to `outFields=*` and use the FIELDS map for
  display only.
- **Redirect URI mismatch** — the Pages URL needs the *exact* trailing
  slash that `window.location.origin + directory` produces. Match
  exactly.
- **`#` in URL parameters** — encode as `%23`. A literal `#` ends the
  query string and starts the URL fragment.
- **Date-only fields showing previous day** — AGOL stores date-only
  fields as UTC midnight; format with `timeZone: 'UTC'` to avoid the
  off-by-one. (See `DetailModal.jsx#fmtDate` for the canonical impl.)

## 10. When to graduate to a shared package

If you find yourself fixing the same bug in two apps, that's the signal
to extract:

- `packages/agol-auth/` — `auth.js` + token cache + `arcgisFetch`
- `packages/agol-ui/` — `Brand`, `TnBadge`, modal shell, freshness
  helpers, `Select` component, base CSS tokens

Both apps move into a monorepo with npm workspaces. The two apps each
keep their own `config.js`, components for their data model, and
deploy workflow. Until then, ARCHITECTURE.md and PATTERNS.md are the
contract.
