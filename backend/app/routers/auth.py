from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..deps import current_therapist_id, public_db
from ..models import Therapist
from ..schemas import LoginIn, SignupIn, TherapistOut, TokenOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, db: DbSession = Depends(public_db)):
    if not get_settings().allow_signup:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sign-ups are closed")
    email = body.email.lower()
    if db.scalar(select(Therapist.id).where(func.lower(Therapist.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    t = Therapist(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password))
    db.add(t)
    db.flush()
    return TokenOut(access_token=create_token(t.id), therapist=TherapistOut.model_validate(t))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: DbSession = Depends(public_db)):
    t = db.scalar(select(Therapist).where(func.lower(Therapist.email) == body.email.lower()))
    if not verify_password(body.password, t.password_hash if t else None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    return TokenOut(access_token=create_token(t.id), therapist=TherapistOut.model_validate(t))


@router.get("/me", response_model=TherapistOut)
def me(therapist_id: int = Depends(current_therapist_id), db: DbSession = Depends(public_db)):
    t = db.get(Therapist, therapist_id)
    if t is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")
    return t
