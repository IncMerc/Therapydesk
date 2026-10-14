import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

CHUNK_SECONDS = 5.0  # keep in sync with CHUNK_MS in recorder.js


@dataclass
class Track:
    speaker: str
    segment: str
    mime: str
    started_at: dt.datetime
    audio: bytes


def estimate_start(chunks: list[tuple[int, dt.datetime]]) -> dt.datetime:
    # chunk n can't arrive before (n+1)*5s into the recording, and upload delay only pushes it later,
    # so the smallest (received_at - (n+1)*5s) is our best guess. server clock -> no client clock skew
    return min(received - dt.timedelta(seconds=(seq + 1) * CHUNK_SECONDS) for seq, received in chunks)


def build_tracks(rows, session_dir: Path) -> list[Track]:
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for r in rows:
        groups[(r.speaker, r.segment)].append(r)
    tracks = []
    for (speaker, segment), chunks in groups.items():
        chunks.sort(key=lambda r: r.seq)
        # chunks of a segment concatenate into one file; only chunk 0 has the webm header
        parts = [(session_dir / speaker / segment / f"{c.seq:06d}.chunk") for c in chunks]
        audio = b"".join(p.read_bytes() for p in parts if p.exists())
        if not audio or chunks[0].seq != 0:
            continue
        tracks.append(Track(speaker, segment, chunks[0].mime_type,
                            estimate_start([(c.seq, c.received_at) for c in chunks]), audio))
    return sorted(tracks, key=lambda t: t.started_at)
