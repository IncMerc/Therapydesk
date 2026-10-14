const TOKEN_KEY = 'therapydesk.token';
const BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request(method, path, body) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : detail || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data;
}

async function upload(path, blob) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'audio/webm', ...(token && { Authorization: `Bearer ${token}` }) },
      body: blob,
    });
  } catch {
    throw new ApiError("Can't reach the server.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.detail || `Upload failed (${res.status})`, res.status);
  return data;
}

async function authenticate(path, body) {
  const data = await request('POST', path, body);
  localStorage.setItem(TOKEN_KEY, data.accessToken);
  return data.therapist;
}

export const auth = {
  signup: (fullName, email, password) => authenticate('/auth/signup', { fullName, email, password }),
  login: (email, password) => authenticate('/auth/login', { email, password }),
  me: () => request('GET', '/auth/me'),
};

export const practice = {
  state: () => request('GET', '/state'),
  createClient: (client) => request('POST', '/clients', client),
  updateClient: (id, patch) => request('PATCH', `/clients/${id}`, patch),
  deleteClient: (id) => request('DELETE', `/clients/${id}`),
  setMeetLink: (id, meetLink) => request('PUT', `/clients/${id}/meet-link`, { meetLink }),
  createSession: (session) => request('POST', '/sessions', session),
  updateSession: (id, patch) => request('PATCH', `/sessions/${id}`, patch),
  completeSession: (id) => request('POST', `/sessions/${id}/complete`),
  toggleSessionPayment: (id) => request('POST', `/sessions/${id}/toggle-payment`),
  deleteSession: (id) => request('DELETE', `/sessions/${id}`),
  recordPayment: (payment) => request('POST', '/payments', payment),
};

export const video = {
  joinRoom: (sessionId) => request('POST', `/sessions/${sessionId}/room`),
  clientLink: (sessionId, rotate = false) => request('POST', `/sessions/${sessionId}/client-link${rotate ? '?rotate=true' : ''}`),
  status: (sessionId) => request('GET', `/sessions/${sessionId}/recording`),
  setConsent: (sessionId, consent) => request('POST', `/sessions/${sessionId}/consent`, { consent }),
  uploadChunk: (sessionId, segment, seq, blob) => upload(`/sessions/${sessionId}/recording/${segment}/${seq}`, blob),
};

// no auth token here - the join key is the auth
export const join = {
  info: (key) => request('GET', `/join/${key}`),
  joinRoom: (key) => request('POST', `/join/${key}/room`),
  status: (key) => request('GET', `/join/${key}/recording`),
  setConsent: (key, consent) => request('POST', `/join/${key}/consent`, { consent }),
  uploadChunk: (key, segment, seq, blob) => upload(`/join/${key}/recording/${segment}/${seq}`, blob),
};

export const notes = {
  get: (sessionId) => request('GET', `/sessions/${sessionId}/notes`),
  generate: (sessionId) => request('POST', `/sessions/${sessionId}/notes/generate`),
  save: (sessionId, note) => request('PUT', `/sessions/${sessionId}/notes`, note),
  approve: (sessionId) => request('POST', `/sessions/${sessionId}/notes/approve`),
  reopen: (sessionId) => request('POST', `/sessions/${sessionId}/notes/reopen`),
};
