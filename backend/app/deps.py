from collections.abc import Iterator

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from .db import SessionLocal
from .security import decode_token

_bearer = HTTPBearer(auto_error=False)


def public_db() -> Iterator[DbSession]:
    # signup/login only - no tenant set, so RLS tables look empty
    with SessionLocal() as db, db.begin():
        yield db


def current_therapist_id(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> int:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.")


def tenant_db(therapist_id: int = Depends(current_therapist_id)) -> Iterator[DbSession]:
    # set_config(..., true) is transaction-local, so it can't leak to the next request on a pooled conn
    with SessionLocal() as db, db.begin():
        db.execute(text("SELECT set_config('app.therapist_id', :tid, true)"), {"tid": str(therapist_id)})
        db.info["therapist_id"] = therapist_id
        yield db
