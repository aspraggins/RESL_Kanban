# Architecture & Design Decisions

This document captures the high-level decisions made building **Resource
Deployment Status** so they can be reused intentionally (not by accident)
in sibling apps that build on the same TEMA / AGOL stack.

## Tech stack — what and why

| Choice | Why |
| --- | --- |
| **React 19 + Vite** | Fast dev server, small build output, no runtime framework lock-in. JSX is familiar to GIS staff who've touched Experience Builder widgets. |
| **No `@arcgis/core`** | Direct REST calls to the AGOL service (`?f=json&token=…`) keep the bundle small (under 100KB gzipped vs. 2MB+ for the Esri SDK), give us full control over the auth flow, and avoid SDK version compatibility headaches. We only use the Esri SDK when we genuinely need map rendering or geometry ops. |
| **Hand-rolled OAuth (PKCE)** | Mirrors the Critical2TN flow. Works in standalone tabs AND inside Experience Builder iframes (via popup + `postMessage`). No client secret needed — registered as a Native App in AGOL. |
| **`@dnd-kit/core` for drag-drop** | Modern, accessible, touch-friendly, actively maintained. `react-beautiful-dnd` is deprecated. Drop entirely if the new app doesn't need drag-drop. |
| **Plain CSS with custom properties** | One `styles.css` per app with `--primary`, `--surface`, etc. No Tailwind, no CSS-in-JS — no build-time tax, no class-name vocabulary to remember. Modern CSS handles theming, `color-mix`, container queries. |
| **No state library** | All app state lives in a single `Board.jsx` (or equivalent root component) using `useState`. No Redux, Zustand, or Context. The scope is small enough that prop drilling 1–2 levels is clearer than ceremony. |
| **GitHub Pages + GitHub Actions** | Free hosting, free CI, public OAuth callback URLs (TEMA-owned `*.github.io` is added to the AGOL app's redirect URI list). Deploy on push to `main`. |

## Auth — OAuth 2.0 with PKCE

Two render modes, picked at runtime based on whether the app is in an
iframe:

- **Standalone (regular tab)**: full-page redirect to AGOL authorize → user
  signs in → AGOL redirects back to our redirect URI with `?code=…` →
  exchange code for tokens → render the app.
- **Embedded (Experience Builder iframe)**: open a popup window (top-level
  browser context, no X-Frame-Options issues) → popup goes through the
  redirect flow → the redirect URI page detects it's running in a popup,
  `postMessage`s the code back to the parent, then closes itself →
  parent exchanges the code → renders the app.

Tokens are cached in `localStorage` under an app-specific key (`*_token_v1`)
so each app has its own session. The refresh token (14-day lifetime) is
used silently when the access token (~2 hr) is near expiry — `arcgisFetch`
detects 498/499 responses and retries once with a fresh token before
giving up.

## State model

Single root component (e.g., `Board.jsx`) owns:

- The list/collection of records fetched from AGOL
- Loading and error state
- Filter state (search, dropdowns, hidden columns, sort)
- Currently-selected detail row (for the modal)
- Pending writes (Set of OBJECTIDs being saved, for optimistic-update UI)

Child components receive everything via props. No Context, no Redux. If
something needs to be lifted further (e.g., shared between sibling apps),
that's the signal to extract a shared package — not yet warranted with
one app.

## Optimistic updates with rollback

Every write to AGOL follows the same shape:

1. **Snapshot** the current value(s) for the affected row.
2. **Optimistically update** local state (and `EditDate = Date.now()` so
   the freshness highlight fires immediately).
3. **Add the OBJECTID** to a `pending` Set so the card shows a "Saving…"
   indicator.
4. **`await applyEdits`**. On success, the snapshot is discarded.
5. **On failure**, roll the local state back to the snapshot and surface
   the AGOL error in an inline pill.
6. **Always**: remove the OBJECTID from `pending` in `finally`.

This pattern shows up in the drag-drop handler and the detail-modal
update handler. Centralize it in a `useOptimisticUpdate` hook if a new
app has many edit interactions.

## Configuration via `src/config.js`

Everything app-specific lives here:

- `CONFIG.serviceUrl` (or `SERVICES = {…}` if multiple services — see
  PATTERNS.md for the multi-service shape)
- `CONFIG.clientId` (AGOL app registration)
- `CONFIG.redirectUri` (auto-detected from `window.location` unless
  overridden by `VITE_REDIRECT_URI`)
- `FIELDS` map from semantic names to AGOL field names
- Coded-value-domain lists (`COLUMNS`, `MISSION_TYPES`, etc.)
- `refreshInterval` for auto-refresh

The mantra: **no AGOL field name appears outside `config.js`**.
Components reference `FIELDS.requestNumber` not the literal
`'request_number_rpt'`. Saves a lot of grepping when schemas change.

## URL parameter contract

App-level state that should be shareable goes in the query string:

- `?mission=…&esf=…` — pre-fills AND locks filters for that session
- Locked filters get the 🔒 indicator and aren't counted in "Clear (N)"

Use `URLSearchParams` (browsers handle decoding). `#` in values must be
encoded as `%23` — anything after a literal `#` is treated as the URL
fragment and dropped from the query string.

## Style tokens

CSS custom properties on `:root` in `styles.css` define the theme:

```css
:root {
  --bg:      #f4f6fa;
  --surface: #ffffff;
  --border:  #e3e7ee;
  --text:    #1f2937;
  --muted:   #64748b;
  --primary: #0b5fa5;
  --shadow:  …;
}
```

Sibling apps should reuse these tokens (and add app-specific tokens
alongside) so they look like they belong to the same family. The TN
flag badge (`TnBadge.jsx`) is the canonical brand mark.

## Deploy pipeline

`.github/workflows/deploy.yml` builds with Vite on every push to `main`
and publishes `dist/` to GitHub Pages. Key points:

- `VITE_BASE_PATH=/<repo-name>/` is set automatically from
  `github.event.repository.name` so the same workflow works for any
  repo without editing.
- `npm ci || npm install` — works whether or not `package-lock.json` is
  committed.
- The redirect URI on the deployed Pages site (`https://<user>.github.io/<repo>/`)
  must be added to the AGOL app's redirect URI list before sign-in
  works.

## Things we deliberately don't do

- **No SSR / Next.js** — the app is fully client-side, served as static
  files. AGOL token lives in the user's browser; no server has it.
- **No analytics / telemetry** — sensitive operational data.
- **No multi-language / i18n framework** — we're English-only.
- **No service worker / PWA caching** — operators are usually online;
  stale data would be worse than no data.
- **No router** — the app is a single screen.
