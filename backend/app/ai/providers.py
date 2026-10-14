import io
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from ..config import get_settings


class PipelineError(Exception):
    """Message is shown to the therapist, keep it readable."""


@dataclass
class Utterance:
    start: float
    end: float
    text: str


class Transcriber(Protocol):
    name: str
    def transcribe(self, audio: bytes, mime: str) -> list[Utterance]: ...


class LLM(Protocol):
    name: str
    def complete_json(self, system: str, user: str) -> str: ...


class LocalWhisper:

    def __init__(self, model_size: str, language: str | None, models_dir: str):
        self.model_size, self.language, self.models_dir = model_size, language or None, models_dir
        self.name = f"whisper-{model_size} (local)"
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # heavy import, worker only
            self._model = WhisperModel(self.model_size, device="cpu", compute_type="int8", download_root=self.models_dir)
        return self._model

    def transcribe(self, audio: bytes, mime: str) -> list[Utterance]:
        from faster_whisper.audio import decode_audio
        try:
            samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        except Exception as exc:
            raise PipelineError("The recording couldn't be decoded. It may be incomplete.") from exc
        # vad_filter also stops whisper hallucinating text during silence
        segments, _info = self._load().transcribe(samples, language=self.language, vad_filter=True, beam_size=5)
        return [Utterance(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]


class GroqWhisper:
    MAX_BYTES = 24 * 1024 * 1024  # free tier caps uploads at 25MB

    def __init__(self, api_key: str, base_url: str, model: str, client: httpx.Client | None = None):
        if not api_key:
            raise PipelineError("GROQ_API_KEY isn't set. Add it to .env or switch TRANSCRIPTION_PROVIDER to local.")
        self.base_url, self.model, self.name = base_url.rstrip("/"), model, f"{model} (Groq)"
        self.client = client or httpx.Client(timeout=300, headers={"Authorization": f"Bearer {api_key}"})

    def transcribe(self, audio: bytes, mime: str) -> list[Utterance]:
        if len(audio) > self.MAX_BYTES:
            raise PipelineError("This recording is too large for Groq's free tier. Use local transcription instead.")
        ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4"}.get(mime, "webm")
        resp = _with_retries(lambda: self.client.post(
            f"{self.base_url}/audio/transcriptions",
            files={"file": (f"audio.{ext}", audio, mime)},
            data={"model": self.model, "response_format": "verbose_json", "temperature": "0"},
        ), "Groq transcription")
        return [Utterance(float(s["start"]), float(s["end"]), s["text"].strip())
                for s in resp.json().get("segments", []) if s.get("text", "").strip()]


class OllamaLLM:
    def __init__(self, url: str, model: str, num_ctx: int, client: httpx.Client | None = None):
        self.url, self.model, self.num_ctx, self.name = url.rstrip("/"), model, num_ctx, f"{model} (Ollama)"
        self.client = client or httpx.Client(timeout=900)

    def complete_json(self, system: str, user: str) -> str:
        try:
            resp = self.client.post(f"{self.url}/api/chat", json={
                "model": self.model, "stream": False, "format": "json",
                "options": {"num_ctx": self.num_ctx, "temperature": 0.2},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            })
        except httpx.HTTPError as exc:
            raise PipelineError(f"Can't reach Ollama at {self.url}. Is the Ollama app running?") from exc
        if resp.status_code == 404:
            raise PipelineError(f"The model {self.model} isn't downloaded. Run: ollama pull {self.model}")
        if resp.status_code >= 400:
            raise PipelineError(f"Ollama returned an error ({resp.status_code}): {resp.text[:200]}")
        return resp.json()["message"]["content"]


class OpenAICompatibleLLM:

    def __init__(self, api_key: str, base_url: str, model: str, label: str = "Groq", client: httpx.Client | None = None):
        if not api_key:
            raise PipelineError("GROQ_API_KEY isn't set. Add it to .env or switch LLM_PROVIDER to ollama.")
        self.base_url, self.model, self.name = base_url.rstrip("/"), model, f"{model} ({label})"
        self.client = client or httpx.Client(timeout=300, headers={"Authorization": f"Bearer {api_key}"})

    def complete_json(self, system: str, user: str) -> str:
        resp = _with_retries(lambda: self.client.post(f"{self.base_url}/chat/completions", json={
            "model": self.model, "temperature": 0.2, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }), "Groq")
        return resp.json()["choices"][0]["message"]["content"]


def _with_retries(send, label: str, attempts: int = 4) -> httpx.Response:
    for attempt in range(1, attempts + 1):
        try:
            resp = send()
        except httpx.HTTPError as exc:
            if attempt == attempts:
                raise PipelineError(f"Can't reach {label}. Check your internet connection.") from exc
            time.sleep(2 * attempt)
            continue
        if resp.status_code == 429 and attempt < attempts:
            time.sleep(min(float(resp.headers.get("retry-after", 5 * attempt)), 60))
            continue
        if resp.status_code == 401:
            raise PipelineError(f"{label} rejected the API key. Check GROQ_API_KEY in .env.")
        if resp.status_code >= 400:
            raise PipelineError(f"{label} returned an error ({resp.status_code}): {resp.text[:200]}")
        return resp
    raise PipelineError(f"{label} kept rate-limiting the request. Try again in a minute.")


def get_transcriber() -> Transcriber:
    s = get_settings()
    if s.transcription_provider == "groq":
        return GroqWhisper(s.groq_api_key, s.groq_base_url, s.groq_whisper_model)
    return LocalWhisper(s.whisper_model, s.whisper_language, s.models_dir)


def get_llm() -> LLM:
    s = get_settings()
    if s.llm_provider == "groq":
        return OpenAICompatibleLLM(s.groq_api_key, s.groq_base_url, s.groq_llm_model)
    return OllamaLLM(s.ollama_url, s.ollama_model, s.ollama_num_ctx)
