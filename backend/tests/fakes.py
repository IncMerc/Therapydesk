import json

from app.ai.providers import Utterance


class FakeTranscriber:
    # one script per call; tracks are transcribed earliest-first
    name = "fake-whisper"

    def __init__(self, *per_track: list[tuple[float, float, str]]):
        self.per_track = list(per_track)
        self.calls = []

    def transcribe(self, audio: bytes, mime: str):
        self.calls.append((len(audio), mime))
        script = self.per_track.pop(0) if self.per_track else []
        return [Utterance(a, b, t) for a, b, t in script]


class FakeLLM:
    name = "fake-llm"

    def __init__(self, *replies):
        self.replies = [r if isinstance(r, str) else json.dumps(r) for r in replies]
        self.prompts = []

    def complete_json(self, system: str, user: str) -> str:
        self.prompts.append((system, user))
        if not self.replies:
            raise AssertionError("FakeLLM ran out of replies")
        return self.replies.pop(0)


def note(**sections):
    base = {"subjective": [], "objective": [], "assessment": [], "plan": [], "risk_flags": []}
    base.update(sections)
    return base
