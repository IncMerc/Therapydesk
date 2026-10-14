# real providers against httpx.MockTransport
import json

import httpx
import pytest

from app.ai.providers import GroqWhisper, OllamaLLM, OpenAICompatibleLLM, PipelineError


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_ollama_sends_json_mode_and_context_size():
    seen = {}
    def handler(req):
        seen.update(json.loads(req.content))
        seen["url"] = str(req.url)
        return httpx.Response(200, json={"message": {"content": '{"plan": []}'}})
    llm = OllamaLLM("http://host.docker.internal:11434/", "llama3.1:8b", 16384, client(handler))
    assert llm.complete_json("sys", "user") == '{"plan": []}'
    assert seen["url"] == "http://host.docker.internal:11434/api/chat"
    assert seen["format"] == "json" and seen["stream"] is False and seen["options"]["num_ctx"] == 16384
    assert [m["role"] for m in seen["messages"]] == ["system", "user"]


def test_ollama_errors_explain_what_to_do():
    missing = OllamaLLM("http://x", "llama3.1:8b", 8192, client(lambda r: httpx.Response(404, json={"error": "model not found"})))
    with pytest.raises(PipelineError, match="ollama pull llama3.1:8b"):
        missing.complete_json("s", "u")
    def refuse(req):
        raise httpx.ConnectError("refused")
    with pytest.raises(PipelineError, match="Is the Ollama app running"):
        OllamaLLM("http://x", "m", 8192, client(refuse)).complete_json("s", "u")


def test_groq_chat_uses_json_mode_and_retries_rate_limits(monkeypatch):
    monkeypatch.setattr("app.ai.providers.time.sleep", lambda s: None)
    calls = []
    def handler(req):
        calls.append(json.loads(req.content))
        if len(calls) == 1:
            return httpx.Response(429, headers={"retry-after": "1"})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": 1}'}}]})
    llm = OpenAICompatibleLLM("key", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", client=client(handler))
    assert llm.complete_json("s", "u") == '{"ok": 1}'
    assert len(calls) == 2 and calls[1]["response_format"] == {"type": "json_object"}


def test_groq_bad_key_and_missing_key():
    llm = OpenAICompatibleLLM("bad", "https://g", "m", client=client(lambda r: httpx.Response(401)))
    with pytest.raises(PipelineError, match="rejected the API key"):
        llm.complete_json("s", "u")
    with pytest.raises(PipelineError, match="GROQ_API_KEY isn't set"):
        OpenAICompatibleLLM("", "https://g", "m")


def test_groq_whisper_parses_segments_and_sends_file():
    seen = {}
    def handler(req):
        seen["body"] = req.content
        seen["url"] = str(req.url)
        return httpx.Response(200, json={"segments": [
            {"start": 0.0, "end": 2.1, "text": " I haven't slept well. "}, {"start": 2.5, "end": 3.0, "text": "  "}]})
    w = GroqWhisper("key", "https://api.groq.com/openai/v1", "whisper-large-v3-turbo", client(handler))
    [u] = w.transcribe(b"\x1aE\xdf\xa3audio", "audio/webm")
    assert (u.start, u.end, u.text) == (0.0, 2.1, "I haven't slept well.")
    assert seen["url"].endswith("/audio/transcriptions")
    assert b'filename="audio.webm"' in seen["body"] and b"verbose_json" in seen["body"]


def test_groq_whisper_rejects_files_over_free_tier_limit():
    w = GroqWhisper("key", "https://g", "m", client(lambda r: httpx.Response(200)))
    with pytest.raises(PipelineError, match="too large"):
        w.transcribe(b"x" * (25 * 1024 * 1024), "audio/webm")
