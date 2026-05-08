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
import Brand from './components/Brand.jsx';

export default function App() {
  const [boot, setBoot] = useState({ stage: 'starting' });
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const consumed = await handleOAuthCallback({
        onError: (msg) => !cancelled && setAuthError(msg),
      });
      if (consumed) {
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

  // Authenticated → Board provides its own full chrome (header, filters,
  // toolbar, columns). Unauthenticated → render a slim header-less Login.
  if (authed) return <Board onSignOut={signOut} />;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
      </header>
      <Login error={authError} onClearError={() => setAuthError('')} />
    </div>
  );
}
