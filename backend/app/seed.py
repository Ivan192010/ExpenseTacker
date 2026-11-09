"""Idempotently create the couple's two accounts from environment variables.

    SEED_USER_A_NAME, SEED_USER_A_EMAIL, SEED_USER_A_PASSWORD, SEED_USER_A_COLOR (optional)
    SEED_USER_B_NAME, SEED_USER_B_EMAIL, SEED_USER_B_PASSWORD, SEED_USER_B_COLOR (optional)
    SEED_RESET_PASSWORDS=true   -> overwrite passwords of existing users

Run:  python -m app.seed
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy import func, select

from app.auth import hash_password
from app.database import SessionLocal, engine
from app.models import User

DEFAULT_COLORS = {"A": "#5B8DEF", "B": "#F2709C"}


async def seed() -> None:
    reset = os.getenv("SEED_RESET_PASSWORDS", "").lower() in {"1", "true", "yes"}
    async with SessionLocal() as session:
        for key in ("A", "B"):
            name = os.getenv(f"SEED_USER_{key}_NAME")
            email = (os.getenv(f"SEED_USER_{key}_EMAIL") or "").strip().lower()
            password = os.getenv(f"SEED_USER_{key}_PASSWORD")
            if not (name and email and password):
                print(f"[seed] SEED_USER_{key}_* not fully set; skipping user {key}")
                continue
            if len(password.encode()) > 72:
                raise SystemExit(f"[seed] SEED_USER_{key}_PASSWORD must be at most 72 bytes")
            color = os.getenv(f"SEED_USER_{key}_COLOR", DEFAULT_COLORS[key])

            user = await session.scalar(select(User).where(func.lower(User.email) == email))
            if user is None:
                session.add(User(name=name, email=email, password_hash=hash_password(password), color=color))
                print(f"[seed] created user {key}: {email}")
            else:
                user.name = name
                user.color = color
                if reset:
                    user.password_hash = hash_password(password)
                print(f"[seed] user {key} already exists: {email}{' (password reset)' if reset else ''}")
        await session.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
