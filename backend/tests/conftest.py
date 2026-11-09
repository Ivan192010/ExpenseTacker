import os
import tempfile
import uuid
from pathlib import Path

_DB = Path(tempfile.gettempdir()) / f"couplecount-test-{uuid.uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB.as_posix()}"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-1234"
os.environ["MAX_DEVICES_PER_USER"] = "2"

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from app import services  # noqa: E402
from app.auth import hash_password  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402


# SQLite needs help to behave like Postgres: real SAVEPOINTs and FK cascades.
@event.listens_for(engine.sync_engine, "connect")
def _sqlite_connect(dbapi_connection, _):
    dbapi_connection.isolation_level = None
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


@event.listens_for(engine.sync_engine, "begin")
def _sqlite_begin(conn):
    conn.exec_driver_sql("BEGIN")


@pytest_asyncio.fixture
async def db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        session.add_all(
            [
                User(name="Ivan", email="a@test.dev", password_hash=hash_password("pw-a")),
                User(name="Partner", email="b@test.dev", password_hash=hash_password("pw-b")),
            ]
        )
        await session.commit()
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/auth/login",
            json={"email": "a@test.dev", "password": "pw-a", "device_id": "device-a-0001", "device_name": "Pixel"},
        )
        assert r.status_code == 200, r.text
        c.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        yield c


@pytest.fixture
def today(monkeypatch):
    """Pin 'today' (drives current month for the installments hub)."""
    import datetime as dt

    def _set(d: dt.date):
        monkeypatch.setattr(services, "today_local", lambda: d)

    return _set


def pytest_sessionfinish(session, exitstatus):
    try:
        _DB.unlink(missing_ok=True)
    except OSError:
        pass
