import base64
import hashlib
import hmac
import secrets
import time

import jwt

from .config import get_settings

TOKEN_TTL_SECONDS = 3 * 60 * 60


def livekit_token(*, room: str, identity: str, name: str) -> str:
    # fixed identities: max two people per room, and rejoining kicks the older connection
    s = get_settings()
    now = int(time.time())
    claims = {
        "iss": s.livekit_api_key,
        "sub": identity,
        "name": name,
        "nbf": now - 10,
        "exp": now + TOKEN_TTL_SECONDS,
        "video": {"room": room, "roomJoin": True, "canPublish": True, "canSubscribe": True, "canPublishData": True},
    }
    return jwt.encode(claims, s.livekit_api_secret, algorithm="HS256")


def new_room_name(session_id: int) -> str:
    return f"session-{session_id}-{secrets.token_hex(6)}"


def new_join_nonce() -> str:
    return secrets.token_urlsafe(18)


def _mac(session_id: int, nonce: str) -> str:
    key = hashlib.sha256(b"join-link:" + get_settings().jwt_secret.encode()).digest()
    digest = hmac.new(key, f"{session_id}:{nonce}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest[:24]).decode().rstrip("=")


def join_key(session_id: int, nonce: str) -> str:
    return f"{session_id}.{_mac(session_id, nonce)}"


def parse_join_key(key: str) -> tuple[int, str] | None:
    sid, _, mac = key.partition(".")
    if not sid.isdigit() or not mac or len(key) > 100:
        return None
    return int(sid), mac


def mac_matches(session_id: int, nonce: str, mac: str) -> bool:
    return hmac.compare_digest(_mac(session_id, nonce), mac)


def join_url(session_id: int, nonce: str) -> str:
    return f"{get_settings().public_app_url.rstrip('/')}/join/{join_key(session_id, nonce)}"
