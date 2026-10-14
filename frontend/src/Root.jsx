import { useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './Login.jsx';
import ClientJoin from './room/ClientJoin.jsx';
import { auth, clearToken, getToken, practice } from './api';

async function loadPractice() {
  try {
    const [therapist, snapshot] = await Promise.all([auth.me(), practice.state()]);
    return { status: 'ready', therapist, snapshot };
  } catch (err) {
    if (err.status === 401) { clearToken(); return { status: 'signedOut' }; }
    return { status: 'error', error: err.message };
  }
}

const joinKey = window.location.pathname.match(/^\/join\/([^/]+)\/?$/)?.[1];

export default function Root() {
  if (joinKey) return <ClientJoin joinKey={decodeURIComponent(joinKey)} />;
  return <TherapistApp />;
}

function TherapistApp() {
  const [view, setView] = useState({ status: getToken() ? 'loading' : 'signedOut' });

  const load = () => {
    setView({ status: 'loading' });
    loadPractice().then(setView);
  };

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    loadPractice().then((next) => { if (!cancelled) setView(next); });
    return () => { cancelled = true; };
  }, []);

  const signOut = () => { clearToken(); setView({ status: 'signedOut' }); };

  if (view.status === 'signedOut') return <Login onSignedIn={load} />;
  if (view.status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-stone-400">Loading your practice…</div>;
  }
  if (view.status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-stone-600">
        <p>{view.error}</p>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-emerald-600 text-white">Try again</button>
      </div>
    );
  }
  return <App initialState={view.snapshot} therapist={view.therapist} onSignOut={signOut} />;
}
