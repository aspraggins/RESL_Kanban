import { useEffect, useState } from 'react';
import {
  handleOAuthCallback,
  tryResume,
  isSignedIn,
  onAuthChange,
  signOut,
} from './auth.js';
import Login from './components/Login.jsx';
import Board from './components/Board.jsx';

export default function App() {
  const [boot, setBoot] = useState({ stage: 'starting' });
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');

  // Boot sequence: handle any ?code= callback first, then try to resume a
  // cached session, then render either Login or Board.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const consumed = await handleOAuthCallback({
        onError: (msg) => !cancelled && setAuthError(msg),
      });
      if (consumed) {
        // We're the popup — handleOAuthCallback already replaced the body.
        setBoot({ stage: 'popup-done' });
        return;
      }
      const ok = await tryResume();
      if (cancelled) return;
      setAuthed(ok || isSignedIn());
      setBoot({ stage: 'ready' });
    })();
    const off = onAuthChange((tok) => setAuthed(!!(tok && tok.accessToken)));
    return () => { cancelled = true; off(); };
  }, []);

  if (boot.stage !== 'ready') {
    return (
      <div className="boot-screen">
        <div className="spinner" />
        <p>Starting…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-dot" />
          <span>Resource Deployment Kanban</span>
        </div>
        {authed && (
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        )}
      </header>
      {authed ? (
        <Board />
      ) : (
        <Login error={authError} onClearError={() => setAuthError('')} />
      )}
    </div>
  );
}
