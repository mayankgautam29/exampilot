from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..deps import current_user, rate_limit
from ..models.tables import User
from ..services import audit
from ..services.auth import create_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


def user_payload(user: User) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role, "ref_id": user.ref_id}


@router.post("/login", dependencies=[Depends(rate_limit("login", 30))])
def login(body: LoginRequest, session: Session = Depends(get_session)) -> dict:
    user = session.exec(select(User).where(User.email == body.email.strip().lower())).first()
    if user is None or not verify_password(body.password, user.password_hash):
        audit.log(None, "anonymous", "auth.login_failed", body.email[:80])
        raise HTTPException(401, "Invalid email or password")
    audit.log(user.id, user.role, "auth.login", f"user:{user.id}")
    return {"token": create_token(user), "user": user_payload(user)}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return user_payload(user)
