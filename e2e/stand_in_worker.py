# worker loop with fake whisper/llm so the browser flow can run without models
import json, logging, sys, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "backend"))
from app import worker
from app.ai.providers import Utterance

SCRIPT = {
    "therapist": [(0.5, 3.0, "Thanks for joining. How has your week been?"),
                  (9.0, 12.0, "That sounds exhausting. Shall we try a thought record together?")],
    "client": [(2.0, 6.0, "Honestly not great. I haven't been sleeping, work deadlines keep me up."),
               (10.0, 14.0, "Sometimes I feel like there's no point in any of it."),
               (15.0, 18.0, "Okay, I can try one before next week.")],
}
order = []
real_build = worker.build_tracks
def build_tracks(rows, d):
    tracks = real_build(rows, d)
    order[:] = [t.speaker for t in tracks]
    return tracks
worker.build_tracks = build_tracks

class Transcriber:
    name = "stand-in whisper"
    def __init__(self): self.i = 0
    def transcribe(self, audio, mime):
        speaker = order[self.i]; self.i += 1
        return [Utterance(a, b, t) for a, b, t in SCRIPT[speaker]]

class LLM:
    name = "stand-in LLM"
    def complete_json(self, system, user):
        lines = [l for l in user.splitlines() if l.startswith("L")]
        num = {key: next(int(l.split()[0][1:]) for l in lines if key in l) for key in ("week been", "sleeping", "thought record", "no point", "before next")}
        return json.dumps({
            "subjective": [{"text": "Client reports poor sleep this week, linked to work deadlines.", "lines": [num["sleeping"]]},
                           {"text": "Client reports starting a new medication.", "lines": [99]}],
            "objective": [{"text": "Therapist introduced a thought record exercise.", "lines": [num["thought record"]]}],
            "assessment": [{"text": "Work stress appears to be affecting sleep and mood.", "lines": [num["sleeping"], num["no point"]]}],
            "plan": [{"text": "Client will complete one thought record before next session.", "lines": [num["before next"]]}],
            "risk_flags": [{"text": "Client said: \"Sometimes I feel like there's no point in any of it.\"", "lines": [num["no point"]]}],
        })

logging.basicConfig(level=logging.INFO)
t, l = Transcriber(), LLM()
end = time.time() + 150
while time.time() < end:
    if not worker.process_one(t, l):
        time.sleep(1)
