import pytest
import hashlib
from httpx import AsyncClient, ASGITransport
from app.core.security import generate_api_key, create_access_token
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey
from app.main import app

def test_generate_api_key_format():
    raw, prefix, key_hash = generate_api_key()
    assert raw.startswith("tk_live_")
    assert len(raw) > 40
    assert prefix == raw[:12]
    expected_hash = hashlib.sha256(raw.encode()).hexdigest()
    assert key_hash == expected_hash
    assert len(key_hash) == 64

@pytest.mark.asyncio
async def test_api_key_lifecycle_and_sdk_validation(test_db):
    # Create test user and project
    async with test_db() as session:
        user = User(email="user_a@example.com", password_hash="hash_a")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Project A", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        user_id = user.id
        project_id = project.id

    token = create_access_token(subject=user_id)
    headers = {"Authorization": f"Bearer {token}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create API key
        res = await client.post(f"/projects/{project_id}/api-keys", headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert "raw_key" in data
        assert data["raw_key"].startswith("tk_live_")
        assert data["prefix"] == data["raw_key"][:12]
        key_id = data["id"]
        raw_key = data["raw_key"]

        # 2. List API keys (Never expose raw_key or key_hash)
        res = await client.get(f"/projects/{project_id}/api-keys", headers=headers)
        assert res.status_code == 200
        keys_list = res.json()
        assert len(keys_list) == 1
        listed = keys_list[0]
        assert listed["id"] == key_id
        assert listed["prefix"] == raw_key[:12]
        assert "raw_key" not in listed
        assert "key_hash" not in listed
        assert listed["revoked_at"] is None
        assert listed["last_used_at"] is None

        # 3. SDK validate route with X-API-Key header
        res = await client.get("/sdk/validate", headers={"X-API-Key": raw_key})
        assert res.status_code == 200
        proj_data = res.json()
        assert proj_data["id"] == project_id
        assert proj_data["name"] == "Project A"

        # Verify last_used_at was updated
        res = await client.get(f"/projects/{project_id}/api-keys", headers=headers)
        keys_list = res.json()
        assert keys_list[0]["last_used_at"] is not None

        # 4. Calling with invalid or missing key must yield constant 401
        res = await client.get("/sdk/validate", headers={"X-API-Key": "invalid_tk_live_key"})
        assert res.status_code == 401
        assert res.json()["detail"] == "Unauthorized"

        res = await client.get("/sdk/validate")
        assert res.status_code == 401
        assert res.json()["detail"] == "Unauthorized"

        # 5. Revoke key
        res = await client.delete(f"/projects/{project_id}/api-keys/{key_id}", headers=headers)
        assert res.status_code == 200

        # Verify revoked_at is now set
        res = await client.get(f"/projects/{project_id}/api-keys", headers=headers)
        keys_list = res.json()
        assert keys_list[0]["revoked_at"] is not None

        # 6. Revoked key must be rejected by /sdk/validate -> 401
        res = await client.get("/sdk/validate", headers={"X-API-Key": raw_key})
        assert res.status_code == 401
        assert res.json()["detail"] == "Unauthorized"

@pytest.mark.asyncio
async def test_cross_user_isolation_and_ownership_checks(test_db):
    """
    User B must NEVER be able to access, list, create, or revoke keys
    on User A's project, and must receive 404 for all cross-tenant requests.
    """
    async with test_db() as session:
        # Create User A with Project A and Key A
        user_a = User(email="usera@test.com", password_hash="hash_a")
        session.add(user_a)
        await session.commit()
        await session.refresh(user_a)

        proj_a = Project(name="User A Project", user_id=user_a.id)
        session.add(proj_a)
        await session.commit()
        await session.refresh(proj_a)

        raw_a, prefix_a, hash_a = generate_api_key()
        key_a = ApiKey(project_id=proj_a.id, prefix=prefix_a, key_hash=hash_a)
        session.add(key_a)

        # Create User B with Project B and Key B
        user_b = User(email="userb@test.com", password_hash="hash_b")
        session.add(user_b)
        await session.commit()
        await session.refresh(user_b)

        proj_b = Project(name="User B Project", user_id=user_b.id)
        session.add(proj_b)
        await session.commit()
        await session.refresh(proj_b)

        raw_b, prefix_b, hash_b = generate_api_key()
        key_b = ApiKey(project_id=proj_b.id, prefix=prefix_b, key_hash=hash_b)
        session.add(key_b)

        await session.commit()
        await session.refresh(key_a)
        await session.refresh(key_b)

        proj_a_id = proj_a.id
        proj_b_id = proj_b.id
        key_a_id = key_a.id
        key_b_id = key_b.id

    token_b = create_access_token(subject=user_b.id)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    token_a = create_access_token(subject=user_a.id)
    headers_a = {"Authorization": f"Bearer {token_a}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. User B tries to get User A's project -> 404
        res = await client.get(f"/projects/{proj_a_id}", headers=headers_b)
        assert res.status_code == 404

        # 2. User B tries to list keys for User A's project -> 404
        res = await client.get(f"/projects/{proj_a_id}/api-keys", headers=headers_b)
        assert res.status_code == 404

        # 3. User B tries to create an API key on User A's project -> 404
        res = await client.post(f"/projects/{proj_a_id}/api-keys", headers=headers_b)
        assert res.status_code == 404

        # 4. User B tries to revoke User A's key on User A's project -> 404
        res = await client.delete(f"/projects/{proj_a_id}/api-keys/{key_a_id}", headers=headers_b)
        assert res.status_code == 404

        # 5. User B tries to delete User A's project entirely -> 404
        res = await client.delete(f"/projects/{proj_a_id}", headers=headers_b)
        assert res.status_code == 404

        # 6. User A tries to revoke key belonging to Project B by passing key_b_id -> 404
        res = await client.delete(f"/projects/{proj_a_id}/api-keys/{key_b_id}", headers=headers_a)
        assert res.status_code == 404

        # 7. User A legitimately revokes key_a_id on project_a -> 200
        res = await client.delete(f"/projects/{proj_a_id}/api-keys/{key_a_id}", headers=headers_a)
        assert res.status_code == 200

        # Verify key_b is still unaffected (not revoked)
        res = await client.get(f"/projects/{proj_b_id}/api-keys", headers=headers_b)
        assert res.status_code == 200
        assert res.json()[0]["revoked_at"] is None

@pytest.mark.asyncio
async def test_active_api_key_limit(test_db):
    """A project is limited to 5 active API keys to prevent key sprawl."""
    async with test_db() as session:
        user = User(email="limit_test@example.com", password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Limit Project", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)
        user_id = user.id
        project_id = project.id

    token = create_access_token(subject=user_id)
    headers = {"Authorization": f"Bearer {token}"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created_key_ids = []
        # Create 5 active keys (should all succeed)
        for _ in range(5):
            res = await client.post(f"/projects/{project_id}/api-keys", headers=headers)
            assert res.status_code == 201
            created_key_ids.append(res.json()["id"])

        # Attempt to create the 6th active key -> must fail with 400
        res = await client.post(f"/projects/{project_id}/api-keys", headers=headers)
        assert res.status_code == 400
        assert "Active API key limit reached" in res.json()["detail"]

        # Revoke one key
        res = await client.delete(f"/projects/{project_id}/api-keys/{created_key_ids[0]}", headers=headers)
        assert res.status_code == 200

        # Now creating a 5th active key succeeds again
        res = await client.post(f"/projects/{project_id}/api-keys", headers=headers)
        assert res.status_code == 201
