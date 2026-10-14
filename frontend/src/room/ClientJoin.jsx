import { useEffect, useState } from 'react';
import { join } from '../api';
import VideoRoom from './VideoRoom';

const formatWhen = (date, time) =>
  new Date(`${date}T${time}`).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ClientJoin({ joinKey }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    join.info(joinKey).then((i) => { if (!cancelled) setInfo(i); }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [joinKey]);

  const shell = (children) => (
    <div className="h-screen bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50/30" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {children}
    </div>
  );
  const message = (heading, body, action) => shell(
    <div className="h-full flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-xl border border-stone-200/60 text-center">
        <h1 className="text-xl font-semibold text-stone-800">{heading}</h1>
        <p className="text-stone-500 mt-2">{body}</p>
        {action}
      </div>
    </div>,
  );

  if (error) return message("Can't open this session", error);
  if (!info) return message('Loading your session…', '');
  if (left) {
    return message('You left the session', 'You can rejoin while the session is still open.',
      <button onClick={() => setLeft(false)} className="mt-6 px-5 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">Rejoin</button>);
  }

  return shell(
    <VideoRoom
      title={`Session with ${info.therapistName}`}
      subtitle={`Hi ${info.clientFirstName}. ${formatWhen(info.date, info.time)}, ${info.duration} minutes.`}
      selfRole="client"
      otherName={info.therapistName}
      initialStatus={info.status}
      api={{
        joinRoom: () => join.joinRoom(joinKey),
        status: () => join.status(joinKey),
        setConsent: (c) => join.setConsent(joinKey, c),
        uploadChunk: (seg, seq, blob) => join.uploadChunk(joinKey, seg, seq, blob),
      }}
      onLeave={() => setLeft(true)}
    />,
  );
}
