import { useEffect, useState } from 'react';
import { Check, Link } from 'lucide-react';
import { video } from '../api';
import VideoRoom from './VideoRoom';

export default function TherapistRoom({ session, clientName, onClose }) {
  const [initialStatus, setInitialStatus] = useState(null);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([video.status(session.id), video.clientLink(session.id)])
      .then(([s, l]) => { if (!cancelled) { setInitialStatus(s); setLink(l.clientJoinUrl); } })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [session.id]);

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyButton = link && (
    <button onClick={copy} className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 text-sm">
      {copied ? <Check size={16} /> : <Link size={16} />}
      {copied ? 'Link copied' : `Copy ${clientName.split(' ')[0]}'s join link`}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-stone-100" role="dialog" aria-label={`Video session with ${clientName}`}>
      {error ? (
        <div className="h-full flex flex-col items-center justify-center gap-4 text-stone-600 p-4 text-center">
          <p>{error}</p>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-emerald-600 text-white">Back to sessions</button>
        </div>
      ) : !initialStatus ? (
        <div className="h-full flex items-center justify-center text-stone-400">Preparing the session…</div>
      ) : (
        <VideoRoom
          title={`Session with ${clientName}`}
          subtitle={link ? `Send ${clientName.split(' ')[0]} this link to join: ${link}` : undefined}
          selfRole="therapist"
          otherName={clientName.split(' ')[0]}
          initialStatus={initialStatus}
          api={{
            joinRoom: () => video.joinRoom(session.id),
            status: () => video.status(session.id),
            setConsent: (c) => video.setConsent(session.id, c),
            uploadChunk: (seg, seq, blob) => video.uploadChunk(session.id, seg, seq, blob),
          }}
          onLeave={onClose}
          headerAction={copyButton}
        />
      )}
    </div>
  );
}
