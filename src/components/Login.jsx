import { useEffect, useState } from 'react';
import { startOAuthFlow, isInIframe, prepareAuthorizeUrl } from '../auth.js';
import TnBadge from './TnBadge.jsx';

export default function Login({ error, onClearError }) {
  const [fallbackUrl, setFallbackUrl] = useState('');
  const embedded = isInIframe();

  useEffect(() => {
    if (!embedded) return;
    prepareAuthorizeUrl()
      .then((u) => setFallbackUrl(u))
      .catch((err) => console.warn('Could not pre-build auth URL:', err));
  }, [embedded]);

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <TnBadge size={64} />
          <h1>Resource Deployment Status</h1>
        </div>
        <p className="muted">
          Sign in with your ArcGIS Online account to view and assign deployed
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
