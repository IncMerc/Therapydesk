import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Plus, RefreshCw, X } from 'lucide-react';
import { notes as notesApi } from '../api';

const POLL_MS = 3000;
const SECTIONS = [
  ['subjective', 'Subjective', "What the client reported"],
  ['objective', 'Objective', 'What happened in the session'],
  ['assessment', 'Assessment', 'Themes and progress'],
  ['plan', 'Plan', 'Homework and next steps'],
];
const STAGE_TEXT = {
  waiting: 'Waiting to start…',
  transcribing: 'Transcribing the recording. On a laptop this can take a while for a long session.',
  drafting: 'Drafting the session note…',
};

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
};
let newId = 0;

export default function NotesPanel({ session, clientName, onClose }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState([]);
  const lineRefs = useRef({});

  const load = (next) => {
    setData(next);
    if (next.note) {
      setDraft({ sections: structuredClone(next.note.sections), riskFlags: structuredClone(next.note.riskFlags) });
      setDirty(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    notesApi.get(session.id).then((d) => { if (!cancelled) load(d); }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [session.id]);

  const processing = data?.status === 'processing';
  useEffect(() => {
    if (!processing) return undefined;
    const id = setInterval(() => { notesApi.get(session.id).then(load).catch(() => {}); }, POLL_MS);
    return () => clearInterval(id);
  }, [processing, session.id]);

  const linesById = useMemo(() => Object.fromEntries((data?.transcript || []).map((l) => [l.id, l])), [data]);
  const approved = data?.note?.status === 'approved';

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try { load(await fn()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = () => act(() => notesApi.save(session.id, draft));
  const approve = () => act(async () => {
    if (dirty) await notesApi.save(session.id, draft);
    return notesApi.approve(session.id);
  });
  const regenerate = () => {
    if (data?.note && !window.confirm('Generate a new draft? This replaces the current draft, including your edits.')) return;
    act(() => notesApi.generate(session.id));
  };
  const close = () => {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onClose();
  };

  const edit = (key, index, patch) => {
    setDraft((d) => {
      const next = structuredClone(d);
      const list = key === 'riskFlags' ? next.riskFlags : next.sections[key];
      if (patch === null) list.splice(index, 1);
      else Object.assign(list[index], patch);
      return next;
    });
    setDirty(true);
  };
  const add = (key) => {
    setDraft((d) => {
      const next = structuredClone(d);
      next.sections[key].push({ id: `new-${++newId}`, text: '', segmentIds: [], supported: true });
      return next;
    });
    setDirty(true);
  };
  const showLines = (ids) => {
    setHighlight(ids);
    lineRefs.current[ids[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const when = new Date(`${session.date}T${session.time}`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const unsupported = draft ? [...Object.values(draft.sections).flat(), ...draft.riskFlags].filter((s) => !s.supported).length : 0;

  return (
    <div className="fixed inset-0 z-50 bg-stone-50 flex flex-col" role="dialog" aria-label={`Session notes for ${clientName}`}
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 py-4 border-b border-stone-200 bg-white">
        <div>
          <h1 className="text-xl font-semibold text-stone-800">Session notes: {clientName}</h1>
          <p className="text-sm text-stone-500">{when}{data?.note?.model ? ` · drafted by ${data.note.model}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.note && !approved && (
            <>
              <button onClick={regenerate} disabled={busy} className="px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 flex items-center gap-2 disabled:opacity-50">
                <RefreshCw size={16} /> New draft
              </button>
              <button onClick={save} disabled={busy || !dirty} className="px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                {dirty ? 'Save changes' : 'Saved'}
              </button>
              <button onClick={approve} disabled={busy} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50">
                <Check size={16} /> Approve note
              </button>
            </>
          )}
          {approved && (
            <>
              <span className="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium flex items-center gap-2"><Check size={16} /> Approved</span>
              <button onClick={() => act(() => notesApi.reopen(session.id))} disabled={busy} className="px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">Reopen to edit</button>
            </>
          )}
          <button onClick={close} aria-label="Close" className="p-2 rounded-xl text-stone-500 hover:bg-stone-100"><X size={20} /></button>
        </div>
      </header>

      {error && <p role="alert" className="mx-4 sm:mx-8 mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}

      {!data ? (
        <Centered>Loading…</Centered>
      ) : processing ? (
        <Centered>
          <div className="h-8 w-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto mb-4" aria-hidden="true" />
          <p className="text-stone-700 font-medium">{STAGE_TEXT[data.job?.stage] || 'Working…'}</p>
          <p className="text-sm text-stone-400 mt-2">You can close this. The notes keep processing in the background.</p>
        </Centered>
      ) : !data.note ? (
        <Centered>
          {data.status === 'failed' ? (
            <>
              <AlertTriangle className="mx-auto text-amber-500 mb-3" />
              <p className="text-stone-700 font-medium">The notes couldn't be generated</p>
              <p className="text-sm text-stone-500 mt-2 max-w-md mx-auto">{data.job?.error}</p>
              <button onClick={regenerate} disabled={busy} className="mt-6 px-5 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">Try again</button>
            </>
          ) : data.status === 'recorded' ? (
            <>
              <p className="text-stone-700 font-medium">This session was recorded</p>
              <p className="text-sm text-stone-500 mt-2">Generate a transcript and a draft SOAP note from it.</p>
              <button onClick={regenerate} disabled={busy} className="mt-6 px-5 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700">Generate notes</button>
            </>
          ) : (
            <p className="text-stone-500">This session wasn't recorded, so there's nothing to transcribe.</p>
          )}
        </Centered>
      ) : (
        <div className="flex-1 min-h-0 grid lg:grid-cols-5 gap-6 p-4 sm:p-8 overflow-y-auto lg:overflow-hidden">
          <section className="lg:col-span-3 lg:overflow-y-auto space-y-6 lg:pr-2" aria-label="Draft note">
            {unsupported > 0 && (
              <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                {unsupported} {unsupported === 1 ? 'statement isn\'t' : 'statements aren\'t'} backed by the transcript. They're highlighted below: check, edit or remove them before approving.
              </p>
            )}
            {draft.riskFlags.length > 0 && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <h2 className="font-semibold text-red-800 flex items-center gap-2"><AlertTriangle size={18} /> Flagged for your attention</h2>
                <p className="text-xs text-red-700/80 mt-1 mb-3">Possible risk indicators the model noticed. Review them against the transcript; they aren't an assessment.</p>
                {draft.riskFlags.map((st, i) => (
                  <StatementRow key={st.id} st={st} readOnly={approved} linesById={linesById} onShow={showLines}
                    onChange={(p) => edit('riskFlags', i, p)} onRemove={() => edit('riskFlags', i, null)} />
                ))}
              </div>
            )}
            {SECTIONS.map(([key, label, hint]) => (
              <div key={key} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
                <h2 className="font-semibold text-stone-800">{label}</h2>
                <p className="text-xs text-stone-400 mb-3">{hint}</p>
                {draft.sections[key].length === 0 && <p className="text-sm text-stone-400 italic mb-2">Nothing drafted.</p>}
                {draft.sections[key].map((st, i) => (
                  <StatementRow key={st.id} st={st} readOnly={approved} linesById={linesById} onShow={showLines}
                    onChange={(p) => edit(key, i, p)} onRemove={() => edit(key, i, null)} />
                ))}
                {!approved && (
                  <button onClick={() => add(key)} className="mt-1 text-sm text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                    <Plus size={14} /> Add a statement
                  </button>
                )}
              </div>
            ))}
          </section>

          <section className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white lg:overflow-y-auto" aria-label="Transcript">
            <h2 className="sticky top-0 bg-white px-4 sm:px-5 py-3 border-b border-stone-100 font-semibold text-stone-800">
              Transcript <span className="font-normal text-stone-400 text-sm">· {data.transcript.length} lines</span>
            </h2>
            <ol className="p-2">
              {data.transcript.map((l) => (
                <li key={l.id} ref={(el) => { lineRefs.current[l.id] = el; }}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${highlight.includes(l.id) ? 'bg-amber-100' : ''}`}>
                  <span className="text-xs text-stone-400 tabular-nums mr-2">{fmt(l.startMs)}</span>
                  <span className={`font-medium mr-1 ${l.speaker === 'therapist' ? 'text-violet-700' : 'text-emerald-700'}`}>
                    {l.speaker === 'therapist' ? 'Therapist' : clientName.split(' ')[0]}:
                  </span>
                  <span className="text-stone-700">{l.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

function StatementRow({ st, readOnly, linesById, onShow, onChange, onRemove }) {
  return (
    <div className={`group mb-2 rounded-xl ${st.supported ? '' : 'bg-amber-50 ring-1 ring-amber-200 p-2'}`}>
      <div className="flex items-start gap-2">
        {readOnly ? (
          <p className="flex-1 text-stone-700 text-sm py-1">{st.text}</p>
        ) : (
          <textarea value={st.text} onChange={(e) => onChange({ text: e.target.value })} rows={Math.max(1, Math.ceil(st.text.length / 80))}
            aria-label="Statement" placeholder="Write a statement…"
            className="flex-1 resize-none rounded-lg border border-transparent hover:border-stone-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none px-2 py-1 text-sm text-stone-700 bg-transparent" />
        )}
        {!readOnly && (
          <button onClick={onRemove} aria-label="Remove statement" title="Remove"
            className="p-1 rounded text-stone-300 hover:text-red-500 opacity-60 group-hover:opacity-100"><X size={16} /></button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2">
        {st.segmentIds.map((id) => linesById[id] && (
          <button key={id} onClick={() => onShow([id])} title="Show in transcript"
            className="text-xs tabular-nums px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 hover:bg-amber-100 hover:text-amber-800">
            {fmt(linesById[id].startMs)}
          </button>
        ))}
        {!st.supported && (
          <span className="text-xs text-amber-800 flex items-center gap-2">
            Not found in the transcript.
            {!readOnly && <button onClick={() => onChange({ supported: true })} className="underline hover:no-underline">I've checked it</button>}
          </span>
        )}
      </div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="flex-1 flex items-center justify-center p-6 text-center"><div>{children}</div></div>;
}
