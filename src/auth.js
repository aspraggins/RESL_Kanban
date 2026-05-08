// ============================================================================
//  AUTH — OAuth 2.0 with PKCE + silent refresh
//  Ported from the Critical2TN flow:
//    • Standalone tab → full-page redirect to AGOL authorize, callback
//      lands back on the same URL with ?code=, we exchange it.
//    • Embedded iframe (Experience Builder) → can't redirect inside the
//      iframe (X-Frame-Options on the AGOL login page), so we open a
//      popup, the popup hits the redirect URI which posts the auth code
//      back to the parent via window.opener.postMessage.
//
//  Token shape (cached in localStorage):
//    { accessToken, refreshToken, expiresAt, refreshExpiresAt, username }
//  expiresAt / refreshExpiresAt are absolute epoch ms.
// ============================================================================

import { CONFIG } from './config.js';

let TOKEN = null;
const listeners = new Set();
function notify() { listeners.forEach((fn) => fn(TOKEN)); }

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getToken() { return TOKEN; }
export function isSignedIn() { return !!(TOKEN && TOKEN.accessToken); }

// ── PKCE helpers ───────────────────────────────────────────────────────────
function _randomString(byteLen = 48) {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return _base64url(arr);
}
function _base64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _sha256base64url(s) {
  const buf  = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return _base64url(new Uint8Array(hash));
}

// ── Token cache helpers ────────────────────────────────────────────────────
export function loadStoredToken() {
  try {
    const raw = localStorage.getItem(CONFIG.tokenKey);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t.accessToken || !t.expiresAt) return null;
    TOKEN = t;
    notify();
    return t;
  } catch { return null; }
}
function saveToken(t) {
  TOKEN = t;
  localStorage.setItem(CONFIG.tokenKey, JSON.stringify(t));
  notify();
}
export function clearStoredToken() {
  TOKEN = null;
  localStorage.removeItem(CONFIG.tokenKey);
  sessionStorage.removeItem('oauth_verifier');
  sessionStorage.removeItem('oauth_state');
  notify();
}
function _tokenFromResponse(data) {
  const now = Date.now();
  const expSec = Number(data.expires_in) || 7200;
  const refSec = Number(data.refresh_token_expires_in) || 0;
  return {
    accessToken:      data.access_token,
    refreshToken:     data.refresh_token || (TOKEN && TOKEN.refreshToken) || null,
    expiresAt:        now + expSec * 1000,
    refreshExpiresAt: refSec ? now + refSec * 1000 : (TOKEN && TOKEN.refreshExpiresAt) || null,
    username:         data.username || (TOKEN && TOKEN.username) || null,
  };
}

// ── Iframe detection ───────────────────────────────────────────────────────
export function isInIframe() {
  try { return window.self !== window.top; } catch { return true; }
}

// ── OAuth flow: kick off the authorize step ────────────────────────────────
//   • Standalone (regular tab): redirect the whole page.
//   • Embedded in an iframe: open a popup (top-level browser context) and
//     pipe the auth code back via postMessage.
//
// IMPORTANT: window.open() must run synchronously inside the user's click
// handler, otherwise the browser blocks it as "programmatic". We open the
// popup at about:blank first, then navigate it once PKCE crypto resolves.
let _preparedAuthUrl = null;

export function startOAuthFlow(onError = () => {}) {
  if (isInIframe()) {
    const w = 540, h = 720;
    const left = Math.max(0, (screen.width  - w) / 2);
    const top  = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(
      'about:blank', 'resl_kanban_oauth',
      `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,scrollbars=1`,
    );
    if (!popup) {
      onError('Popup was blocked — please allow popups for this site, then click Sign in again.');
      return;
    }
    try {
      popup.document.write(
        '<!doctype html><meta charset="utf-8"><title>Signing in…</title>' +
        '<style>body{font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333;background:#f0f2f5}' +
        '.s{margin-top:20px;color:#666;font-size:13px}</style>' +
        '<div><strong>Connecting to ArcGIS Online…</strong><div class="s">One moment.</div></div>',
      );
    } catch { /* cross-origin popup just before nav — fine to ignore */ }

    const urlPromise = _preparedAuthUrl ? Promise.resolve(_preparedAuthUrl) : _buildAuthorizeUrl();
    urlPromise
      .then((url) => { popup.location.href = url; })
      .catch((err) => {
        try { popup.close(); } catch {}
        console.error('OAuth start failed:', err);
        onError('Could not start sign-in. ' + (err.message || ''));
      });
    _waitForOAuthResult(popup, onError);
  } else {
    const urlPromise = _preparedAuthUrl ? Promise.resolve(_preparedAuthUrl) : _buildAuthorizeUrl();
    urlPromise
      .then((url) => { window.location.href = url; })
      .catch((err) => {
        console.error('OAuth start failed:', err);
        onError('Could not start sign-in. ' + (err.message || ''));
      });
  }
}

// Pre-build the URL so the "open in new tab" fallback link can use it.
export async function prepareAuthorizeUrl() {
  _preparedAuthUrl = await _buildAuthorizeUrl();
  return _preparedAuthUrl;
}

async function _buildAuthorizeUrl() {
  const verifier  = _randomString(48);
  const challenge = await _sha256base64url(verifier);
  const state     = _randomString(16);
  sessionStorage.setItem('oauth_verifier', verifier);
  sessionStorage.setItem('oauth_state',    state);
  const params = new URLSearchParams({
    client_id:             CONFIG.clientId,
    response_type:         'code',
    redirect_uri:          CONFIG.redirectUri,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    expiration:            String(CONFIG.tokenExpirationMinutes),
    state,
  });
  return `${CONFIG.authorizeUrl}?${params}`;
}

function _waitForOAuthResult(popup, onError) {
  let settled = false;
  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    clearInterval(closedTimer);
  };
  const onMessage = async (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'resl_kanban_oauth') return;
    settled = true;
    cleanup();
    if (event.data.error) {
      onError(event.data.error_description || event.data.error);
      return;
    }
    try {
      const tok = await exchangeCodeForToken(event.data.code);
      saveToken(tok);
    } catch (err) {
      console.error('Token exchange failed:', err);
      onError(err.message || 'Sign-in failed.');
    }
  };
  window.addEventListener('message', onMessage);
  const closedTimer = setInterval(() => {
    if (popup.closed && !settled) cleanup();
  }, 500);
}

// ── OAuth flow: exchange the authorization code for tokens ────────────────
async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('oauth_verifier');
  if (!verifier) throw new Error('Missing PKCE verifier — please sign in again.');
  const params = new URLSearchParams({
    client_id:     CONFIG.clientId,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  CONFIG.redirectUri,
    code_verifier: verifier,
    f:             'json',
  });
  const res  = await fetch(CONFIG.tokenUrl, { method: 'POST', body: params });
  const data = await res.json();
  if (data.error) {
    const msg = (data.error.details && data.error.details[0]) || data.error.message || 'Sign-in failed';
    throw new Error(msg);
  }
  if (!data.access_token) throw new Error('No access token returned');
  sessionStorage.removeItem('oauth_verifier');
  sessionStorage.removeItem('oauth_state');
  return _tokenFromResponse(data);
}

// ── Silent refresh ────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!TOKEN || !TOKEN.refreshToken) throw new Error('No refresh token available');
  if (TOKEN.refreshExpiresAt && Date.now() > TOKEN.refreshExpiresAt) {
    throw new Error('Refresh token expired');
  }
  const params = new URLSearchParams({
    client_id:     CONFIG.clientId,
    grant_type:    'refresh_token',
    refresh_token: TOKEN.refreshToken,
    f:             'json',
  });
  const res  = await fetch(CONFIG.tokenUrl, { method: 'POST', body: params });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Token refresh failed');
  if (!data.access_token) throw new Error('No access token in refresh response');
  return _tokenFromResponse(data);
}

export async function ensureFreshToken() {
  if (!TOKEN) throw new Error('Not signed in');
  if (TOKEN.expiresAt && Date.now() < TOKEN.expiresAt - CONFIG.refreshBufferMs) return;
  const fresh = await refreshAccessToken();
  saveToken(fresh);
}

// Try to silently refresh on app boot if we have a refresh token but the
// access token is stale. Returns true if we end up with a valid token.
export async function tryResume() {
  loadStoredToken();
  if (!TOKEN) return false;
  if (TOKEN.expiresAt && Date.now() < TOKEN.expiresAt - CONFIG.refreshBufferMs) return true;
  if (!TOKEN.refreshToken) { clearStoredToken(); return false; }
  try {
    const fresh = await refreshAccessToken();
    saveToken(fresh);
    return true;
  } catch (err) {
    console.warn('Silent refresh failed:', err);
    clearStoredToken();
    return false;
  }
}

// ── Handle the OAuth redirect callback ────────────────────────────────────
// Returns true if the page was loaded as an OAuth callback (so callers can
// suppress the normal app render, e.g. while the popup posts back to its
// opener and closes itself).
export async function handleOAuthCallback({ onError = () => {} } = {}) {
  const url = new URL(window.location.href);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;

  // Popup branch — relay to opener and close.
  if (window.opener && window.opener !== window) {
    try {
      window.opener.postMessage({
        type:               'resl_kanban_oauth',
        code,
        state,
        error,
        error_description:  url.searchParams.get('error_description') || null,
      }, window.location.origin);
    } catch (e) { console.error('postMessage to opener failed:', e); }
    setTimeout(() => { try { window.close(); } catch {} }, 50);
    document.body.innerHTML =
      '<div style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333">' +
      'Sign-in complete. You can close this window.</div>';
    return true;
  }

  // Standalone branch — exchange the code in this same page.
  if (error) {
    onError(`Sign-in error: ${url.searchParams.get('error_description') || error}`);
    history.replaceState({}, '', url.pathname);
    return false;
  }
  const expectedState = sessionStorage.getItem('oauth_state');
  if (expectedState && state !== expectedState) {
    onError('Sign-in failed: state mismatch. Please try again.');
    history.replaceState({}, '', url.pathname);
    return false;
  }
  try {
    const tok = await exchangeCodeForToken(code);
    saveToken(tok);
    history.replaceState({}, '', url.pathname);
    return false;     // not the popup — we DO want to render the app
  } catch (err) {
    console.error('Token exchange failed:', err);
    onError(err.message || 'Sign-in failed.');
    history.replaceState({}, '', url.pathname);
    return false;
  }
}

export function signOut() {
  clearStoredToken();
}
