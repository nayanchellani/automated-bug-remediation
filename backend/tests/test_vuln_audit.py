"""
Integration tests for Feature 4 — Dependency Vulnerability Audit.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.future import select

from app.main import app
from app.api.deps import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.snapshot import Snapshot
from app.models.dependency import Dependency
from app.models.vuln_audit import VulnAudit, Vulnerability


@pytest_asyncio.fixture
async def db_session(test_db):
    async with test_db() as session:
        yield session


@pytest_asyncio.fixture
async def user(db_session) -> User:
    u = User(
        email=f"test_{uuid.uuid4().hex[:6]}@test.com",
        password_hash="x",
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def other_user(db_session) -> User:
    u = User(
        email=f"other_{uuid.uuid4().hex[:6]}@test.com",
        password_hash="x",
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def project(db_session, user: User) -> Project:
    p = Project(name="test-project", user_id=user.id)
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


@pytest_asyncio.fixture
async def snapshot_with_deps(db_session, project: Project) -> Snapshot:
    snap = Snapshot(
        id=str(uuid.uuid4()),
        project_id=project.id,
        sha256="abc123",
        file_count=1,
        total_bytes=100,
        tree=[],
        archive_path="/tmp/test.zip",
    )
    db_session.add(snap)
    await db_session.flush()

    deps = [
        Dependency(snapshot_id=snap.id, ecosystem="npm", name="express", version="4.17.1", is_dev=False, source_file="package.json"),
        Dependency(snapshot_id=snap.id, ecosystem="PyPI", name="requests", version="2.26.0", is_dev=False, source_file="requirements.txt"),
    ]
    db_session.add_all(deps)
    await db_session.commit()
    await db_session.refresh(snap)
    return snap


def make_client(current_user: User) -> AsyncClient:
    app.dependency_overrides[get_current_user] = lambda: current_user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_run_vuln_audit_success(test_db, user, project, snapshot_with_deps):
    """POST /projects/{id}/vuln-audits should create an audit and store vulns."""
    with patch("app.api.routers.vuln_audit.batch_query", new_callable=AsyncMock) as mock_batch:
        from app.core.osv import OSVVuln
        mock_batch.return_value = [
            OSVVuln(
                osv_id="GHSA-test-1234-abcd",
                package_name="express",
                ecosystem="npm",
                installed_version="4.17.1",
                fixed_version="4.18.0",
                severity="HIGH",
                summary="Test vulnerability in express",
                details="Some details",
            )
        ]

        async with make_client(user) as client:
            resp = await client.post(f"/projects/{project.id}/vuln-audits")

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "completed"
    assert data["vuln_count"] == 1
    assert len(data["vulns"]) == 1
    assert data["vulns"][0]["osv_id"] == "GHSA-test-1234-abcd"
    assert data["vulns"][0]["severity"] == "HIGH"
    assert data["vulns"][0]["fixed_version"] == "4.18.0"


@pytest.mark.asyncio
async def test_get_latest_vuln_audit(test_db, db_session, user, project, snapshot_with_deps):
    """GET /projects/{id}/vuln-audits/latest should return the latest audit."""
    audit = VulnAudit(
        project_id=project.id,
        snapshot_id=snapshot_with_deps.id,
        status="completed",
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        vuln_count=0,
    )
    db_session.add(audit)
    await db_session.commit()

    async with make_client(user) as client:
        resp = await client.get(f"/projects/{project.id}/vuln-audits/latest")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_ownership_check(test_db, other_user, project, snapshot_with_deps):
    """Another user should get 403 when triggering an audit."""
    async with make_client(other_user) as client:
        resp = await client.post(f"/projects/{project.id}/vuln-audits")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_no_snapshot_returns_404(test_db, db_session, user):
    """POST should 404 if the project has no snapshot."""
    proj = Project(name="empty-project", user_id=user.id)
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)

    async with make_client(user) as client:
        resp = await client.post(f"/projects/{proj.id}/vuln-audits")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_latest_audit_404_when_none(test_db, db_session, user):
    """GET /latest should 404 when no audit exists for the project."""
    proj = Project(name="no-audit-project", user_id=user.id)
    db_session.add(proj)
    await db_session.commit()
    await db_session.refresh(proj)

    async with make_client(user) as client:
        resp = await client.get(f"/projects/{proj.id}/vuln-audits/latest")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_vulnerabilities_severity_filter(test_db, db_session, user, project, snapshot_with_deps):
    """GET /vulnerabilities?severity=HIGH should filter correctly."""
    audit = VulnAudit(
        project_id=project.id,
        snapshot_id=snapshot_with_deps.id,
        status="completed",
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        vuln_count=2,
    )
    db_session.add(audit)
    await db_session.flush()

    db_session.add_all([
        Vulnerability(audit_id=audit.id, osv_id="GHSA-high", package_name="pkg-a", ecosystem="npm",
                      installed_version="1.0.0", fixed_version="1.0.1", severity="HIGH",
                      summary="High vuln", details=None),
        Vulnerability(audit_id=audit.id, osv_id="GHSA-low", package_name="pkg-b", ecosystem="npm",
                      installed_version="2.0.0", fixed_version=None, severity="LOW",
                      summary="Low vuln", details=None),
    ])
    await db_session.commit()

    async with make_client(user) as client:
        resp = await client.get(f"/projects/{project.id}/vulnerabilities?severity=HIGH")

    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["severity"] == "HIGH"
    assert items[0]["osv_id"] == "GHSA-high"
