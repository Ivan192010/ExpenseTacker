"""Lightweight JWT auth with device binding.

* Only the two seeded users exist; there is no sign-up endpoint.
* Login requires a `device_id` (UUID the app generates once and keeps in
  SecureStore). Each user may bind at most MAX_DEVICES_PER_USER phones.
* Every token carries the device row id; revoking a device kills its token.
* The fingerprint gate lives on the phone (expo-local-authentication) and
  protects the stored token; the server never sees biometrics.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import Device, User
from app.schemas import LoginRequest, TokenResponse, UserRead

_bearer = HTTPBearer(auto_error=False)
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser", bcrypt.gensalt()).decode()
_LAST_SEEN_RESOLUTION = dt.timedelta(minutes=30)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:  # malformed hash or > 72 bytes
        return False


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def create_access_token(user_id: int, device_pk: int) -> tuple[str, dt.datetime]:
    s = get_settings()
    expires_at = _now() + dt.timedelta(days=s.jwt_expire_days)
    token = jwt.encode(
        {"sub": str(user_id), "did": device_pk, "exp": expires_at, "iat": _now()},
        s.jwt_secret,
        algorithm=s.jwt_algorithm,
    )
    return token, expires_at


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


async def login(session: AsyncSession, data: LoginRequest) -> TokenResponse:
    user = await session.scalar(select(User).where(func.lower(User.email) == data.email))
    if user is None:
        verify_password(data.password, _DUMMY_HASH)  # constant-ish time
        raise _unauthorized("Invalid email or password")
    if not verify_password(data.password, user.password_hash):
        raise _unauthorized("Invalid email or password")

    device = await session.scalar(
        select(Device).where(Device.user_id == user.id, Device.device_uid == data.device_id)
    )
    if device is None or device.revoked_at is not None:
        active = await session.scalar(
            select(func.count()).select_from(Device).where(Device.user_id == user.id, Device.revoked_at.is_(None))
        )
        limit = get_settings().max_devices_per_user
        if (active or 0) >= limit:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This account already has {limit} linked phone(s). "
                "Unlink one from Settings > Devices on a linked phone first.",
            )
        if device is None:
            device = Device(user_id=user.id, device_uid=data.device_id)
            session.add(device)
        device.revoked_at = None

    if data.device_name:
        device.device_name = data.device_name
    device.last_seen_at = _now()
    await session.commit()

    token, expires_at = create_access_token(user.id, device.id)
    return TokenResponse(access_token=token, expires_at=expires_at, user=UserRead.model_validate(user))


@dataclass
class AuthContext:
    user: User
    device: Device


async def get_auth_context(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext:
    if creds is None:
        raise _unauthorized()
    s = get_settings()
    try:
        payload = jwt.decode(creds.credentials, s.jwt_secret, algorithms=[s.jwt_algorithm])
        user_id = int(payload["sub"])
        device_pk = int(payload["did"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        raise _unauthorized("Invalid or expired token") from None

    device = await session.get(Device, device_pk)
    if device is None or device.user_id != user_id or device.revoked_at is not None:
        raise _unauthorized("This device has been unlinked. Please sign in again.")
    user = await session.get(User, user_id)
    if user is None:
        raise _unauthorized()

    now = _now()
    last_seen = device.last_seen_at
    if last_seen is not None and last_seen.tzinfo is None:  # SQLite returns naive datetimes
        last_seen = last_seen.replace(tzinfo=dt.timezone.utc)
    if last_seen is None or now - last_seen > _LAST_SEEN_RESOLUTION:
        device.last_seen_at = now
        await session.commit()
    return AuthContext(user=user, device=device)


async def get_current_user(ctx: Annotated[AuthContext, Depends(get_auth_context)]) -> User:
    return ctx.user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAuth = Annotated[AuthContext, Depends(get_auth_context)]
