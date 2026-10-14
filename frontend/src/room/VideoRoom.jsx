import { useEffect, useRef, useState } from 'react';
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, PhoneOff, CircleDot, CircleOff } from 'lucide-react';
import { ChunkRecorder } from './recorder';

const STATUS_POLL_MS = 4000;

const consentCopy = (selfRole, otherName) =>
  selfRole === 'therapist'
    ? `Record audio for session notes. Recording only starts if ${otherName} also agrees. Either of you can stop it at any time, which deletes what was recorded.`
    : `Allow ${otherName} to record this session's audio for their session notes. Recording only starts if you both agree. You can stop it at any time, which deletes what was recorded.`;

function recordingLabel(status, selfRole, otherName) {
  if (!status) return { live: false, text: 'Not recording' };
  const self = selfRole === 'therapist' ? status.therapistConsented : status.clientConsented;
  const other = selfRole === 'therapist' ? status.clientConsented : status.therapistConsented;
  if (status.recording) return { live: true, text: 'Recording audio for session notes' };
  if (self && !other) return { live: false, text: `Recording starts when ${otherName} agrees` };
  if (!self && other) return { live: false, text: `${otherName} agreed to recording. It stays off unless you agree too.` };
  return { live: false, text: 'Not recording' };
}

const selfConsented = (status, role) => Boolean(role === 'therapist' ? status?.therapistConsented : status?.clientConsented);

export default function VideoRoom({ title, subtitle, selfRole, otherName, initialStatus, api, onLeave, headerAction }) {
  const [stage, setStage] = useState('prejoin'); // prejoin | connecting | live | left
  const [consent, setConsent] = useState(selfConsented(initialStatus, selfRole));
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [otherPresent, setOtherPresent] = useState(false);
  const [otherVideo, setOtherVideo] = useState(false);
  const [micTrack, setMicTrack] = useState(null);

  const roomRef = useRef(null);
  const leavingRef = useRef(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const audioSinkRef = useRef(null);
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  // the other side can flip consent anytime
  useEffect(() => {
    if (stage !== 'live') return undefined;
    const id = setInterval(() => { apiRef.current.status().then(setStatus).catch(() => {}); }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [stage]);

  const recording = Boolean(status?.recording);
  useEffect(() => {
    if (stage !== 'live' || !recording || !micTrack) return undefined;
    const recorder = new ChunkRecorder({
      track: micTrack,
      upload: (segment, seq, blob) => apiRef.current.uploadChunk(segment, seq, blob).then((r) => setStatus(r.status)),
      onStopped: () => apiRef.current.status().then(setStatus).catch(() => {}),
      onError: (err) => setError(err.message),
    });
    recorder.start();
    return () => { recorder.stop(); };
  }, [stage, recording, micTrack]);

  const join = async () => {
    setError('');
    setStage('connecting');
    try {
      if (consent !== selfConsented(status, selfRole)) setStatus(await api.setConsent(consent));
      const { serverUrl, token, status: fresh } = await api.joinRoom();
      setStatus(fresh);

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      leavingRef.current = false;
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video) { track.attach(remoteVideoRef.current); setOtherVideo(true); }
          else if (track.kind === Track.Kind.Audio) audioSinkRef.current?.appendChild(track.attach());
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => { if (el !== remoteVideoRef.current) el.remove(); });
          if (track.kind === Track.Kind.Video) setOtherVideo(false);
        })
        .on(RoomEvent.TrackMuted, (pub, p) => { if (p !== room.localParticipant && pub.kind === Track.Kind.Video) setOtherVideo(false); })
        .on(RoomEvent.TrackUnmuted, (pub, p) => { if (p !== room.localParticipant && pub.kind === Track.Kind.Video) setOtherVideo(true); })
        .on(RoomEvent.ParticipantConnected, () => setOtherPresent(true))
        .on(RoomEvent.ParticipantDisconnected, () => { setOtherPresent(room.remoteParticipants.size > 0); setOtherVideo(false); })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.Camera) pub.track.attach(localVideoRef.current);
          if (pub.source === Track.Source.Microphone) setMicTrack(pub.track.mediaStreamTrack);
        })
        .on(RoomEvent.Disconnected, (reason) => {
          setMicTrack(null);
          if (leavingRef.current) return;
          setError(reason === DisconnectReason.DUPLICATE_IDENTITY
            ? 'You joined this session from another tab or device, so this one was disconnected.'
            : 'You were disconnected. Rejoin when your connection is back.');
          setStage('prejoin');
        });

      await room.connect(serverUrl, token);
      setOtherPresent(room.remoteParticipants.size > 0);
      setStage('live');
      try {
        await room.localParticipant.enableCameraAndMicrophone();
      } catch {
        setCamOn(false);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setError('Camera unavailable, so you joined with audio only.');
        } catch {
          setMicOn(false);
          setError('Your browser blocked the camera and microphone. Allow access in the address bar, then leave and rejoin.');
        }
      }
    } catch (err) {
      roomRef.current?.disconnect();
      setError(err.message || 'Could not join the session.');
      setStage('prejoin');
    }
  };

  const toggleMic = async () => {
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
  };
  const toggleCam = async () => {
    try {
      await roomRef.current?.localParticipant.setCameraEnabled(!camOn);
      setCamOn(!camOn);
    } catch { setError('Camera unavailable.'); }
  };
  const toggleRecording = async () => {
    const turningOff = selfConsented(status, selfRole);
    if (turningOff && !window.confirm('Stop recording? This deletes the audio recorded so far in this session, for both of you.')) return;
    try { setStatus(await api.setConsent(!turningOff)); } catch (err) { setError(err.message); }
  };
  const leave = async () => {
    leavingRef.current = true;
    setMicTrack(null); // effect cleanup stops the recorder + uploads the last chunk
    await new Promise((r) => setTimeout(r, 300));
    await roomRef.current?.disconnect();
    setStage('left');
    onLeave();
  };

  const rec = recordingLabel(status, selfRole, otherName);

  if (stage === 'prejoin') {
    return (
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-xl border border-stone-200/60">
          <h1 className="text-2xl font-semibold text-stone-800">{title}</h1>
          {subtitle && <p className="text-stone-500 mt-1">{subtitle}</p>}
          <label className="mt-6 flex items-start gap-3 rounded-xl bg-stone-50 p-4 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 h-4 w-4 accent-emerald-600" />
            <span className="text-sm text-stone-600">{consentCopy(selfRole, otherName)}</span>
          </label>
          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 flex gap-3">
            <button onClick={onLeave} className="flex-1 px-4 py-3 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50">Cancel</button>
            <button onClick={join} className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">Join session</button>
          </div>
          <p className="mt-4 text-xs text-stone-400">Your browser will ask to use your camera and microphone.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-stone-900 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <div className="min-w-0">
          <p className="font-medium truncate">{title}</p>
          <p role="status" className={`text-sm flex items-center gap-2 ${rec.live ? 'text-red-300' : 'text-stone-400'}`}>
            {rec.live && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />}
            {rec.text}
          </p>
        </div>
        {headerAction}
      </header>

      {error && (
        <div role="alert" className="mx-4 sm:mx-6 mb-2 rounded-xl bg-red-500/15 border border-red-400/30 px-4 py-2 text-sm text-red-100 flex justify-between gap-4">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-200 hover:text-white" aria-label="Dismiss">×</button>
        </div>
      )}

      <main className="relative flex-1 mx-4 sm:mx-6 rounded-2xl bg-stone-800 overflow-hidden">
        <video ref={remoteVideoRef} autoPlay playsInline className={`h-full w-full object-cover ${otherVideo ? '' : 'invisible'}`} />
        {!otherVideo && (
          <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-center px-6">
            {stage === 'connecting' ? 'Connecting…' : otherPresent ? `${otherName}'s camera is off` : `Waiting for ${otherName} to join…`}
          </div>
        )}
        <video ref={localVideoRef} autoPlay playsInline muted
          className={`absolute bottom-3 right-3 w-28 sm:w-48 aspect-video rounded-xl object-cover bg-stone-700 border border-white/10 -scale-x-100 ${camOn ? '' : 'invisible'}`} />
        <div ref={audioSinkRef} className="hidden" />
      </main>

      <footer className="flex items-center justify-center gap-3 py-4">
        <CallButton onClick={toggleMic} label={micOn ? 'Mute microphone' : 'Unmute microphone'} off={!micOn}>
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </CallButton>
        <CallButton onClick={toggleCam} label={camOn ? 'Turn camera off' : 'Turn camera on'} off={!camOn}>
          {camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </CallButton>
        <CallButton onClick={toggleRecording} label={selfConsented(status, selfRole) ? 'Stop recording' : 'Allow recording'}>
          {selfConsented(status, selfRole) ? <CircleOff size={20} /> : <CircleDot size={20} />}
        </CallButton>
        <button onClick={leave} aria-label="Leave session" title="Leave session"
          className="h-12 px-5 rounded-full bg-red-600 hover:bg-red-700 flex items-center gap-2 font-medium">
          <PhoneOff size={20} /> Leave
        </button>
      </footer>
    </div>
  );
}

function CallButton({ onClick, label, off, children }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`h-12 w-12 rounded-full flex items-center justify-center ${off ? 'bg-white text-stone-900' : 'bg-white/10 hover:bg-white/20'}`}>
      {children}
    </button>
  );
}
