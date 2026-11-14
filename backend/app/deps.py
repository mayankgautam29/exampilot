from __future__ import annotations

import time
from collections import defaultdict, deque

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from .db import get_session
from .models.tables import User
from .services.auth import decode_token

bearer = HTTPBearer(auto_error=False)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), session: Session = Depends(get_session)) -> User:
    if credentials is None:
        raise HTTPException(401, "Not authenticated")
    try:
        claims = decode_token(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token")
    user = session.get(User, int(claims["sub"]))
    if user is None:
        raise HTTPException(401, "Unknown user")
    return user


def require_role(*roles: str):
    def checker(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(roles)}")
        return user

    return checker


admin_only = require_role("admin")
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(name: str, limit: int, window_seconds: int = 60):
    def checker(request: Request) -> None:
        key = f"{name}:{request.client.host if request.client else 'local'}"
        queue = _hits[key]
        current = time.time()
        while queue and queue[0] < current - window_seconds:
            queue.popleft()
        if len(queue) >= limit:
            raise HTTPException(429, "Too many requests, slow down")
        queue.append(current)

    return checker
