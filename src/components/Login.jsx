import { useEffect, useState } from 'react';
import { startOAuthFlow, isInIframe, prepareAuthorizeUrl } from '../auth.js';

export default function Login({ error, onClearError }) {
  const [fallbackUrl, setFallbackUrl] = useState('');
  const embedded = isInIframe();

  // Pre-build the authorize URL when embedded so the "Open in a new tab"
  // anchor is a real <a href=...> at click time — which dodges popup
  // blockers (anchor target=_blank is exempt).
  useEffect(() => {
    if (!embedded) return;
    prepareAuthorizeUrl()
      .then((u) => setFallbackUrl(u))
      .catch((err) => console.warn('Could not pre-build auth URL:', err));
  }, [embedded]);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Sign in</h1>
        <p className="muted">
          Connect with your ArcGIS Online account to view and assign deployed
          resources.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            onClearError && onClearError();
            startOAuthFlow((msg) => onClearError && onClearError(msg));
          }}
        >
          Sign in with ArcGIS Online
        </button>
        {embedded && fallbackUrl && (
          <a
            className="muted small"
            href={fallbackUrl}
            target="_blank"
            rel="noreferrer"
          >
            Trouble with the popup? Open sign-in in a new tab.
          </a>
        )}
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
