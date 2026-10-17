import os
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncEngine
from sqlalchemy import text
from app.db.session import Base
from app.api.deps import get_db
from app.main import app

POSTGRES_TEST_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://triage:triage@localhost:5433/triage_test"
)

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

async def _init_engine() -> AsyncEngine:
    """Connects to PostgreSQL test DB. Fails loudly if Postgres is unavailable."""
    urls_to_try = [
        POSTGRES_TEST_URL,
        "postgresql+asyncpg://triage:triage@localhost:5432/triage_test",
    ]
    for url in urls_to_try:
        try:
            pg_engine = create_async_engine(url, echo=False)
            async with pg_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return pg_engine
        except Exception:
            continue

    raise RuntimeError(
        "Postgres test database unavailable. Start Docker and run 'docker compose up -d db_test' "
        "to run tests against Postgres."
    )

@pytest_asyncio.fixture(scope="function")
async def test_db():
    engine = await _init_engine()
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        except Exception:
            pass
        await conn.run_sync(Base.metadata.create_all)

    async def override_get_db():
        async with async_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    yield async_session

    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()
