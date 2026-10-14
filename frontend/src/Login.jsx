import { useState } from 'react';
import { auth } from './api';

export default function Login({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const therapist = isSignup
        ? await auth.signup(form.fullName, form.email, form.password)
        : await auth.login(form.email, form.password);
      onSignedIn(therapist);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, type = 'text', extra = {}) => (
    <div>
      <label htmlFor={key} className="block text-sm font-medium text-stone-600 mb-2">{label}</label>
      <input
        id={key}
        type={type}
        required
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
        {...extra}
      />
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50/30 p-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-xl border border-stone-200/60">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <span className="text-xl font-semibold text-stone-800">TherapyDesk</span>
        </div>
        <h1 className="text-2xl font-semibold text-stone-800 mb-6">{isSignup ? 'Create your practice' : 'Sign in'}</h1>
        <form onSubmit={submit} className="space-y-4">
          {isSignup && field('fullName', 'Your name', 'text', { autoComplete: 'name' })}
          {field('email', 'Email', 'email', { autoComplete: 'email' })}
          {field('password', 'Password', 'password', {
            autoComplete: isSignup ? 'new-password' : 'current-password',
            minLength: isSignup ? 10 : undefined,
          })}
          {isSignup && <p className="text-xs text-stone-400 -mt-2">At least 10 characters.</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }}
          className="mt-6 text-sm text-stone-500 hover:text-stone-700"
        >
          {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}
