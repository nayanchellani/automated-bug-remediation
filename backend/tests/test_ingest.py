import pytest
from httpx import AsyncClient, ASGITransport
from app.core.security import generate_api_key, create_access_token
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey
from app.models.error_event import ErrorEvent
from app.main import app
from sqlalchemy.future import select

@pytest.mark.asyncio
async def test_error_ingestion_and_deduplication(test_db):
    async with test_db() as session:
        user = User(email="dev@example.com", password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Ingest App", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)

        raw_key, prefix, key_hash = generate_api_key()
        api_key = ApiKey(project_id=project.id, prefix=prefix, key_hash=key_hash)
        session.add(api_key)
        await session.commit()
        await session.refresh(api_key)

        project_id = project.id

    headers = {"X-API-Key": raw_key}
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Same error sent 3 times (count=1 each) gives one row with count 3
        payload_1 = {
            "name": "TypeError",
            "message": "Cannot read properties of undefined (reading 'token')",
            "stack": "TypeError: Cannot read properties of undefined\n    at login (/app/auth.ts:42:15)",
            "frames": [
                {"file": "/app/auth.ts", "line": 42, "function": "login", "in_app": True}
            ],
            "count": 1
        }
        for _ in range(3):
            res = await client.post("/ingest/error", headers=headers, json=payload_1)
            assert res.status_code == 202

        async with test_db() as session:
            rows = (await session.execute(select(ErrorEvent).where(ErrorEvent.project_id == project_id))).scalars().all()
            assert len(rows) == 1
            assert rows[0].count == 3
            assert rows[0].name == "TypeError"
            assert rows[0].file == "/app/auth.ts"
            assert rows[0].line == 42

        # 2. count=20 in a single payload gives a row with count 20 (for a new distinct error)
        payload_batched = {
            "name": "ReferenceError",
            "message": "foo is not defined",
            "stack": "ReferenceError: foo is not defined\n    at parse (/app/parser.ts:10:5)",
            "frames": [
                {"file": "/app/parser.ts", "line": 10, "function": "parse", "in_app": True}
            ],
            "count": 20
        }
        res = await client.post("/ingest/error", headers=headers, json=payload_batched)
        assert res.status_code == 202

        async with test_db() as session:
            row = (await session.execute(
                select(ErrorEvent).where(ErrorEvent.project_id == project_id, ErrorEvent.name == "ReferenceError")
            )).scalar_one()
            assert row.count == 20

        # 3. Same error from different lines gives two distinct rows
        payload_diff_line = {
            "name": "TypeError",
            "message": "Cannot read properties of undefined (reading 'token')",
            "stack": "TypeError: Cannot read properties of undefined\n    at login (/app/auth.ts:99:15)",
            "frames": [
                {"file": "/app/auth.ts", "line": 99, "function": "login", "in_app": True}
            ],
            "count": 1
        }
        res = await client.post("/ingest/error", headers=headers, json=payload_diff_line)
        assert res.status_code == 202

        async with test_db() as session:
            type_errors = (await session.execute(
                select(ErrorEvent).where(ErrorEvent.project_id == project_id, ErrorEvent.name == "TypeError")
            )).scalars().all()
            assert len(type_errors) == 2

        # 4. Messages that differ only by an ID still give one row (when frame exists)
        payload_id_1 = {
            "name": "ValueError",
            "message": "User 12345 failed verification",
            "stack": "ValueError: User 12345 failed verification\n    at verify (/app/user.ts:50:5)",
            "frames": [{"file": "/app/user.ts", "line": 50, "function": "verify", "in_app": True}],
            "count": 1
        }
        payload_id_2 = {
            "name": "ValueError",
            "message": "User 67890 failed verification",
            "stack": "ValueError: User 67890 failed verification\n    at verify (/app/user.ts:50:5)",
            "frames": [{"file": "/app/user.ts", "line": 50, "function": "verify", "in_app": True}],
            "count": 1
        }
        res1 = await client.post("/ingest/error", headers=headers, json=payload_id_1)
        res2 = await client.post("/ingest/error", headers=headers, json=payload_id_2)
        assert res1.status_code == 202
        assert res2.status_code == 202

        async with test_db() as session:
            val_errors = (await session.execute(
                select(ErrorEvent).where(ErrorEvent.project_id == project_id, ErrorEvent.name == "ValueError")
            )).scalars().all()
            assert len(val_errors) == 1
            assert val_errors[0].count == 2
            # Updated message reflects latest event
            assert "67890" in val_errors[0].message

        # 5. Invalid or revoked key gives 401
        res = await client.post("/ingest/error", headers={"X-API-Key": "invalid_key"}, json=payload_1)
        assert res.status_code == 401

        # 6. Oversized body gives 413
        oversized_headers = {
            "X-API-Key": raw_key,
            "Content-Length": "70000",
        }
        res = await client.post("/ingest/error", headers=oversized_headers, content=b"x" * 70000)
        assert res.status_code == 413

@pytest.mark.asyncio
async def test_cross_user_incidents_isolation(test_db):
    """User B cannot view User A's incidents (returns 404)."""
    async with test_db() as session:
        user_a = User(email="usera_incidents@test.com", password_hash="hash")
        session.add(user_a)
        await session.commit()
        await session.refresh(user_a)

        proj_a = Project(name="Project A", user_id=user_a.id)
        session.add(proj_a)
        await session.commit()
        await session.refresh(proj_a)

        user_b = User(email="userb_incidents@test.com", password_hash="hash")
        session.add(user_b)
        await session.commit()
        await session.refresh(user_b)

        proj_a_id = proj_a.id
        user_a_id = user_a.id
        user_b_id = user_b.id

    token_b = create_access_token(subject=user_b_id)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    token_a = create_access_token(subject=user_a_id)
    headers_a = {"Authorization": f"Bearer {token_a}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # User B queries User A's incidents -> 404
        res = await client.get(f"/projects/{proj_a_id}/incidents", headers=headers_b)
        assert res.status_code == 404

        # User A queries their own incidents -> 200
        res = await client.get(f"/projects/{proj_a_id}/incidents", headers=headers_a)
        assert res.status_code == 200
        assert res.json() == []

@pytest.mark.asyncio
async def test_rate_limiting_100_per_minute(test_db):
    """The 101st request in a minute gives 429."""
    async with test_db() as session:
        user = User(email="rate_limit@example.com", password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Rate Limited App", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)

        raw_key, prefix, key_hash = generate_api_key()
        api_key = ApiKey(project_id=project.id, prefix=prefix, key_hash=key_hash)
        session.add(api_key)
        await session.commit()

    headers = {"X-API-Key": raw_key}
    transport = ASGITransport(app=app)

    payload = {
        "name": "EvalError",
        "message": "Eval failed",
        "stack": "EvalError: Eval failed",
        "frames": [],
        "count": 1
    }

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Send 100 requests (all should succeed 202)
        for _ in range(100):
            res = await client.post("/ingest/error", headers=headers, json=payload)
            assert res.status_code == 202

        # 101st request gives 429 Too Many Requests
        res = await client.post("/ingest/error", headers=headers, json=payload)
        assert res.status_code == 429
