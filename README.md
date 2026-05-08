# Resource Deployment Kanban

Drag-and-drop Kanban board for assigning deployment status to resources stored
in an ArcGIS Online feature service. Built with React + Vite + dnd-kit, using
the same OAuth 2.0 (PKCE) flow as the Critical2TN app — works as a standalone
page **and** when embedded as an Experience Builder iframe widget.

## Status columns

`On Scene · On Hold · Staged · Demobilized · En Route · Canceled`

Order mirrors the layer's coded-value-domain dropdown. Anything whose
status doesn't match one of those values is shown in an "Unassigned"
column on the left so it's not silently hidden. Edit `src/config.js`
(`COLUMNS`) to change order, labels, or the exact strings written to the
layer.

## First-time setup

1. **Install dependencies** (the sandbox here couldn't reach npm; do this on
   your machine):
   ```bash
   cd resl-kanban
   npm install
   ```
2. **Confirm the schema.** The status field is hard-coded as `status` in
   `src/config.js`. On first run the app logs the layer's actual field names
   to the browser console — open DevTools, sign in, and look for
   `[RESL-Kanban] Layer metadata`. If the real status field is named
   differently (e.g. `RES_STATUS`), update `FIELDS.status` in `src/config.js`.
   While you're there, double-check the display fields (`resource_name`,
   `resource_type`, `agency`, `contact_name`, `contact_phone`) — anything that
   doesn't exist on the layer is just skipped on the card, but the cards look
   nicer when the names match.
3. **Verify the column values.** AGOL is case- and whitespace-sensitive on
   coded-value domains. The `value` in each `COLUMNS` entry is what gets
   written to the layer on drop. If your layer expects `On-Scene` rather than
   `On Scene`, adjust `value` (the `label` is purely cosmetic).
4. **Register the redirect URI in AGOL.** Open the AGOL app item that owns
   the OAuth Client ID (`tP3hyVsfaw5Am3BF` by default — Critical2TN's). In
   _Settings → App Registration → Redirect URIs_, add every host this app
   will run from:
   - `http://localhost:5173/` (Vite dev)
   - `https://<github-user>.github.io/<repo>/` (GitHub Pages)
   - `https://<your-bucket>.cloudfront.net/<path>/` (S3/CloudFront)
   - The Experience Builder experience URL the iframe is hosted under

   Trailing slash matters — match exactly what `window.location.origin +
   directory` produces. To use a different App ID instead of sharing
   Critical2TN's, copy `.env.example` to `.env.local` and set
   `VITE_CLIENT_ID`.
5. **Run it locally.**
   ```bash
   npm run dev
   ```
   Visit <http://localhost:5173/>, sign in, drag a card.

## Build & deploy

```bash
npm run build
```

Outputs to `dist/`. Because `vite.config.js` sets `base: './'`, the same
build runs from any subpath without rewriting URLs.

### GitHub Pages (automated — recommended)

A workflow in `.github/workflows/deploy.yml` builds and deploys on every
push to `main`. To turn it on:

1. Push this repo to GitHub. The repo root must be the `resl-kanban`
   folder (so `package.json` and `.github/` sit at the top level).
2. **Repo Settings → Pages → Source = "GitHub Actions".**
3. Push to `main` (or hit "Run workflow" on the Actions tab). The site
   goes live at `https://<user>.github.io/<repo>/` in ~60 seconds.
4. Add that URL to the AGOL app's redirect URI list (see step 4 of
   First-time setup above) — without it, sign-in will fail with a
   "redirect_uri mismatch" error.

Optional: commit a `package-lock.json` (`npm install` once locally, then
commit) so subsequent builds use `npm ci` for speed and reproducibility.
The workflow falls back to `npm install` if no lockfile is present, so
the first deploy works either way.

To override config at build time without editing `src/config.js`, set
repository variables on GitHub (Settings → Secrets and variables →
Actions → Variables):

- `VITE_CLIENT_ID` — different AGOL App ID
- `VITE_SERVICE_URL` — different feature service / layer

### S3 / CloudFront

```bash
aws s3 sync dist/ s3://your-bucket/resl-kanban/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/resl-kanban/*"
```

### S3 / CloudFront

```bash
aws s3 sync dist/ s3://your-bucket/resl-kanban/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/resl-kanban/*"
```

### Experience Builder

Add a **Embed** widget pointing at the deployed URL. The app auto-detects
the iframe and switches the OAuth flow to popup mode (full-page redirects
are blocked inside the AGOL login page's `X-Frame-Options`).

## How it works

- `src/auth.js` — OAuth 2.0 with PKCE, popup-or-redirect, silent refresh.
  Token cached in `localStorage` under `resl_kanban_token_v1` (separate from
  Critical2TN so they don't collide).
- `src/service.js` — `fetchAllResources()` (paged query), `updateStatus()`
  (applyEdits), `fetchLayerMeta()` (logs schema + warns on mismatch).
- `src/components/Board.jsx` — top-level board, dnd-kit context, optimistic
  updates with rollback on failure.
- `src/components/Column.jsx` / `Card.jsx` — droppable column / draggable
  card. Cards are draggable on touch with a 150ms hold so they don't snag
  scroll.

## Troubleshooting

- **"Popup was blocked"** — happens the first time on a domain. Allow popups
  for the site, or use the "Open sign-in in a new tab" fallback link shown
  on the login screen when embedded.
- **"Token expired or invalid" then bounced back to login** — refresh token
  hit its 14-day cap. Just sign in again.
- **Card snaps back after a drop with an "Update failed" pill** — check
  `FIELDS.status` and that the column `value` matches a coded-value-domain
  entry. The console will have the exact AGOL error code.
- **Field names look wrong on cards** — open the console, find the
  `[RESL-Kanban] Layer metadata` group, copy the real names into
  `src/config.js#FIELDS`.
