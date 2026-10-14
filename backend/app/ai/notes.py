# The model gets numbered lines (L1..Ln) and has to cite them. Statements with no valid citation are
# kept but marked unsupported so the therapist sees them. Long transcripts: draft per chunk, then merge.
import json
import re
from dataclasses import dataclass

from .providers import LLM, PipelineError

SECTIONS = ("subjective", "objective", "assessment", "plan")
MAX_STATEMENT_CHARS = 600

SYSTEM = """You help a licensed therapist by drafting a session note from a transcript of their session.
The therapist will review and edit everything you write. Rules:
- Use only what the transcript says. Never invent details, diagnoses, medications, history or names.
- Every statement must cite the transcript line numbers (the N in "LN") that support it.
- Write concise, professional, third-person clinical statements ("Client reports...", "Therapist introduced...").
- Leave a section as an empty list when the transcript has nothing for it.
SOAP sections:
- subjective: what the client reports: feelings, experiences, concerns, events since last session.
- objective: what happened in the session that the transcript shows: topics covered, exercises done,
  how the client engaged. No guesses about appearance or anything not in the words.
- assessment: a brief, tentative synthesis of themes and progress evident in the cited lines. No diagnoses.
- plan: homework, agreed next steps, focus for the next session, referrals mentioned.
- risk_flags: quote-level flags (not interpretations) of anything suggesting risk of harm to self or
  others, abuse, or crisis. Empty list if none.
Reply with JSON only, exactly this shape:
{"subjective":[{"text":"...","lines":[1,2]}],"objective":[],"assessment":[],"plan":[],"risk_flags":[]}"""

MERGE_SYSTEM = """You merge partial drafts of one therapy session note into a single SOAP note.
Combine duplicates, keep the order of events, and keep every cited line number of the statements you
merge. Do not add anything that isn't in the partial drafts. Reply with JSON only, same shape as the input:
{"subjective":[{"text":"...","lines":[1,2]}],"objective":[],"assessment":[],"plan":[],"risk_flags":[]}"""


@dataclass
class Line:
    segment_id: int
    speaker: str
    start_ms: int
    text: str


def _fmt_time(ms: int) -> str:
    s = ms // 1000
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def render(lines: list[Line], start_index: int = 0) -> str:
    return "\n".join(
        f"L{start_index + i + 1} [{_fmt_time(l.start_ms)}] {l.speaker.capitalize()}: {l.text}" for i, l in enumerate(lines)
    )


def _parse(raw: str) -> dict:
    text = raw.strip()
    fenced = re.search(r"\{.*\}", text, re.S)  # models like to wrap json in ``` or chat
    if not fenced:
        raise ValueError("no JSON object in reply")
    data = json.loads(fenced.group(0))
    if not isinstance(data, dict):
        raise ValueError("reply is not an object")
    return data


def _ask(llm: LLM, system: str, user: str) -> dict:
    try:
        return _parse(llm.complete_json(system, user))
    except (ValueError, json.JSONDecodeError):
        # small local models break format now and then, one retry usually fixes it
        retry = user + "\n\nYour previous reply was not valid JSON. Reply with the JSON object only."
        try:
            return _parse(llm.complete_json(system, retry))
        except (ValueError, json.JSONDecodeError) as exc:
            raise PipelineError("The AI model didn't return a usable note. Try again, or use a larger model.") from exc


def _items(data: dict, key: str) -> list[dict]:
    raw = data.get(key) or []
    out = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str):
            item = {"text": item, "lines": []}
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()[:MAX_STATEMENT_CHARS]
        nums = set()
        cited = item.get("lines") or []
        for n in cited if isinstance(cited, list) else []:
            try:
                nums.add(int(str(n).strip().lstrip("Ll")))  # 12, "12", "L12"
            except ValueError:
                pass
        if text:
            out.append({"text": text, "lines": sorted(nums)})
    return out


def _chunks(lines: list[Line], max_tokens: int) -> list[tuple[int, list[Line]]]:
    budget = max_tokens * 4  # ~4 chars/token
    out, start, size = [], 0, 0
    for i, line in enumerate(lines):
        cost = len(line.text) + 24
        if size + cost > budget and i > start:
            out.append((start, lines[start:i]))
            start, size = i, 0
        size += cost
    out.append((start, lines[start:]))
    return out


def draft_note(lines: list[Line], llm: LLM, chunk_tokens: int) -> dict:
    if not lines:
        raise PipelineError("There's no transcript to draft a note from.")
    parts = _chunks(lines, chunk_tokens)
    if len(parts) == 1:
        data = _ask(llm, SYSTEM, "Transcript:\n" + render(lines))
    else:
        partials = []
        for i, (offset, part) in enumerate(parts, 1):
            d = _ask(llm, SYSTEM, f"Transcript, part {i} of {len(parts)} (line numbers continue across parts):\n" + render(part, offset))
            partials.append({k: _items(d, k) for k in (*SECTIONS, "risk_flags")})
        data = _ask(llm, MERGE_SYSTEM, "Partial drafts:\n" + json.dumps(partials, ensure_ascii=False))
    return _to_content(data, lines)


def _to_content(data: dict, lines: list[Line]) -> dict:
    def convert(items: list[dict], prefix: str) -> list[dict]:
        out = []
        for i, item in enumerate(items, 1):
            ids = [lines[n - 1].segment_id for n in item["lines"] if 1 <= n <= len(lines)]
            out.append({"id": f"{prefix}{i}", "text": item["text"], "segmentIds": ids, "supported": bool(ids)})
        return out

    sections = {k: convert(_items(data, k), k[0]) for k in SECTIONS}
    risk = convert(_items(data, "risk_flags"), "r")
    total = sum(len(v) for v in sections.values())
    unsupported = sum(1 for v in sections.values() for s in v if not s["supported"])
    if total == 0:
        raise PipelineError("The AI model returned an empty note. Try again, or use a larger model.")
    return {"format": "SOAP", "sections": sections, "riskFlags": risk,
            "stats": {"statements": total, "unsupported": unsupported}}
