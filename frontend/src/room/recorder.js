// each side records only its own mic. uploads are queued so they stay in order

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const CHUNK_MS = 5000; // backend assumes 5s (CHUNK_SECONDS)
const RETRIES = 3;

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export class ChunkRecorder {
  constructor({ track, upload, onStopped, onError }) {
    this.track = track;
    this.upload = upload;
    this.onStopped = onStopped;
    this.onError = onError;
    this.queue = Promise.resolve();
    this.recorder = null;
  }

  get active() {
    return this.recorder?.state === 'recording';
  }

  start() {
    const mimeType = pickMimeType();
    if (!mimeType) {
      this.onError?.(new Error('This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.'));
      return;
    }
    const segment = crypto.randomUUID();
    let seq = 0;
    this.recorder = new MediaRecorder(new MediaStream([this.track]), { mimeType, audioBitsPerSecond: 32000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const n = seq++;
      const blob = e.data.type ? e.data : new Blob([e.data], { type: mimeType });
      this.queue = this.queue.then(() => this.#send(segment, n, blob));
    };
    this.recorder.start(CHUNK_MS);
  }

  async #send(segment, seq, blob) {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.upload(segment, seq, blob);
        return;
      } catch (err) {
        if (err.status === 409 || err.status === 410) {
          // recording turned off server-side
          this.#halt();
          this.onStopped?.(err.message);
          return;
        }
        if (attempt >= RETRIES) {
          this.onError?.(new Error('Some audio could not be uploaded. Check your connection.'));
          return;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  #halt() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.ondataavailable = null;
      this.recorder.stop();
    }
  }

  async stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      const done = new Promise((resolve) => { this.recorder.onstop = resolve; });
      this.recorder.stop(); // flushes one last chunk
      await done;
    }
    await this.queue;
  }
}
