import io
import json
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.future import select

from app.core.security import generate_api_key, create_access_token
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey
from app.models.snapshot import Snapshot
from app.models.dependency import Dependency
from app.main import app

def create_mock_zip(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, content in files.items():
            if isinstance(content, str):
                zf.writestr(filename, content)
            else:
                zf.writestr(filename, content)
    return buf.getvalue()

@pytest.mark.asyncio
async def test_snapshot_upload_and_manifest_parsing(test_db):
    async with test_db() as session:
        user = User(email="snap_tester@example.com", password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Snapshot App", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)

        raw_key, prefix, key_hash = generate_api_key()
        api_key = ApiKey(project_id=project.id, prefix=prefix, key_hash=key_hash)
        session.add(api_key)
        await session.commit()

        project_id = project.id

    package_json_content = json.dumps({
        "name": "sample-app",
        "dependencies": {
            "express": "^4.18.2"
        },
        "devDependencies": {
            "typescript": "^5.0.0"
        }
    })

    package_lock_content = json.dumps({
        "name": "sample-app",
        "lockfileVersion": 3,
        "packages": {
            "node_modules/express": {
                "version": "4.18.2"
            },
            "node_modules/typescript": {
                "version": "5.0.4",
                "dev": True
            }
        }
    })

    requirements_txt_content = (
        "# Core dependencies\n"
        "requests==2.31.0\n"
        "pytest>=7.0.0\n"
        "-r other.txt\n"
        "flake8\n"
    )

    zip_bytes = create_mock_zip({
        "src/index.js": "console.log('hello world');",
        "package.json": package_json_content,
        "package-lock.json": package_lock_content,
        "requirements.txt": requirements_txt_content,
        ".env": "SECRET_KEY=12345",
        "certs/server.pem": "CERT_KEY",
    })

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Valid zip upload gives a tree and correct dependencies
        files = {"file": ("project.zip", zip_bytes, "application/zip")}
        res = await client.post("/snapshots", headers={"X-API-Key": raw_key}, files=files)
        assert res.status_code == 201
        data = res.json()
        assert data["file_count"] == 4 # .env and server.pem filtered out
        stored_paths = [item["path"] for item in data["tree"]]
        assert "src/index.js" in stored_paths
        assert ".env" not in stored_paths
        assert "certs/server.pem" not in stored_paths

        # Check dependencies in DB
        async with test_db() as session:
            deps = (await session.execute(
                select(Dependency).where(Dependency.snapshot_id == data["id"])
            )).scalars().all()
            dep_dict = {d.name: d for d in deps}

            # Exact lockfile versions used over package.json ranges
            assert "express" in dep_dict
            assert dep_dict["express"].version == "4.18.2"
            assert dep_dict["express"].ecosystem == "npm"
            assert dep_dict["express"].is_dev is False

            assert "typescript" in dep_dict
            assert dep_dict["typescript"].version == "5.0.4"
            assert dep_dict["typescript"].is_dev is True

            assert "requests" in dep_dict
            assert dep_dict["requests"].version == "2.31.0"
            assert dep_dict["requests"].ecosystem == "PyPI"

            # Inexact/unpinned line has version None (or unknown)
            assert "pytest" in dep_dict
            assert dep_dict["pytest"].version is None

@pytest.mark.asyncio
async def test_zip_security_guards(test_db):
    async with test_db() as session:
        user = User(email="sec_tester@example.com", password_hash="hash")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        project = Project(name="Security App", user_id=user.id)
        session.add(project)
        await session.commit()
        await session.refresh(project)

        raw_key, prefix, key_hash = generate_api_key()
        api_key = ApiKey(project_id=project.id, prefix=prefix, key_hash=key_hash)
        session.add(api_key)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Non-zip upload -> 422
        files = {"file": ("project.zip", b"not a zip archive", "application/zip")}
        res = await client.post("/snapshots", headers={"X-API-Key": raw_key}, files=files)
        assert res.status_code == 422

        # 2. Zip-slip path (../evil.js) -> 422
        slip_zip = create_mock_zip({"../evil.js": "malicious code"})
        files = {"file": ("project.zip", slip_zip, "application/zip")}
        res = await client.post("/snapshots", headers={"X-API-Key": raw_key}, files=files)
        assert res.status_code == 422
        assert "Unsafe path" in res.json()["detail"]

        # 3. Invalid or revoked API key -> 401
        res = await client.post("/snapshots", headers={"X-API-Key": "invalid_key"}, files=files)
        assert res.status_code == 401

@pytest.mark.asyncio
async def test_cross_user_snapshot_isolation(test_db):
    async with test_db() as session:
        user_a = User(email="user_a_snap@example.com", password_hash="hash")
        user_b = User(email="user_b_snap@example.com", password_hash="hash")
        session.add_all([user_a, user_b])
        await session.commit()
        await session.refresh(user_a)
        await session.refresh(user_b)

        proj_a = Project(name="Project A", user_id=user_a.id)
        session.add(proj_a)
        await session.commit()
        await session.refresh(proj_a)

        raw_key_a, prefix_a, hash_a = generate_api_key()
        api_key_a = ApiKey(project_id=proj_a.id, prefix=prefix_a, key_hash=hash_a)
        session.add(api_key_a)
        await session.commit()

        proj_a_id = proj_a.id
        user_a_id = user_a.id
        user_b_id = user_b.id

    token_b = create_access_token(subject=user_b_id)
    token_a = create_access_token(subject=user_a_id)

    valid_zip = create_mock_zip({"src/index.js": "code"})

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Upload snapshot to Project A
        files = {"file": ("project.zip", valid_zip, "application/zip")}
        res = await client.post("/snapshots", headers={"X-API-Key": raw_key_a}, files=files)
        assert res.status_code == 201

        # User B queries Project A's latest snapshot -> 404
        res = await client.get(f"/projects/{proj_a_id}/snapshots/latest", headers={"Authorization": f"Bearer {token_b}"})
        assert res.status_code == 404

        # User B queries Project A's dependencies -> 404
        res = await client.get(f"/projects/{proj_a_id}/dependencies", headers={"Authorization": f"Bearer {token_b}"})
        assert res.status_code == 404

        # User A queries their own snapshot -> 200
        res = await client.get(f"/projects/{proj_a_id}/snapshots/latest", headers={"Authorization": f"Bearer {token_a}"})
        assert res.status_code == 200
        assert res.json()["file_count"] == 1
