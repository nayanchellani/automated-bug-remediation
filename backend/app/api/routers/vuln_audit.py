from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.snapshot import Snapshot
from app.models.dependency import Dependency
from app.models.vuln_audit import VulnAudit, Vulnerability
from app.schemas.vuln_audit import VulnAuditOut, VulnerabilityOut
from app.core.osv import batch_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["vuln-audits"])

MAX_AUDITS_PER_PROJECT = 5


# ---------------------------------------------------------------------------
# Helper: ownership check
# ---------------------------------------------------------------------------

async def _get_owned_project(project_id: int, user: User, db: AsyncSession) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return project


# ---------------------------------------------------------------------------
# POST /projects/{project_id}/vuln-audits  — trigger a new audit
# ---------------------------------------------------------------------------

@router.post(
    "/{project_id}/vuln-audits",
    response_model=VulnAuditOut,
    status_code=status.HTTP_201_CREATED,
)
async def run_vuln_audit(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_project(project_id, current_user, db)

    # Find latest snapshot for this project
    snap_result = await db.execute(
        select(Snapshot)
        .where(Snapshot.project_id == project_id)
        .order_by(Snapshot.created_at.desc())
        .limit(1)
    )
    snapshot = snap_result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="No snapshot found for this project — push one with `npx triage push` first")

    # Load all dependencies for that snapshot
    dep_result = await db.execute(
        select(Dependency).where(Dependency.snapshot_id == snapshot.id)
    )
    deps = dep_result.scalars().all()

    # Create the audit record (status=running)
    audit = VulnAudit(
        project_id=project_id,
        snapshot_id=snapshot.id,
        status="running",
        started_at=datetime.now(timezone.utc),
    )
    db.add(audit)
    await db.flush()   # get audit.id before inserting vulns

    try:
        osv_vulns = await batch_query(list(deps))
    except Exception as exc:
        audit.status = "failed"
        audit.finished_at = datetime.now(timezone.utc)
        audit.error = str(exc)
        await db.commit()
        await db.refresh(audit)
        return audit

    # Persist vulnerabilities
    vuln_rows = [
        Vulnerability(
            audit_id=audit.id,
            osv_id=v.osv_id,
            package_name=v.package_name,
            ecosystem=v.ecosystem,
            installed_version=v.installed_version,
            fixed_version=v.fixed_version,
            severity=v.severity,
            summary=v.summary,
            details=v.details,
        )
        for v in osv_vulns
    ]
    db.add_all(vuln_rows)

    audit.status = "completed"
    audit.finished_at = datetime.now(timezone.utc)
    audit.vuln_count = len(vuln_rows)

    # Prune: keep only the most recent MAX_AUDITS_PER_PROJECT audits
    old_result = await db.execute(
        select(VulnAudit.id)
        .where(VulnAudit.project_id == project_id)
        .order_by(VulnAudit.started_at.desc())
        .offset(MAX_AUDITS_PER_PROJECT)
    )
    old_ids = old_result.scalars().all()
    if old_ids:
        await db.execute(delete(VulnAudit).where(VulnAudit.id.in_(old_ids)))

    await db.commit()

    # Reload with vulns eager-loaded
    fresh = await db.execute(
        select(VulnAudit)
        .options(selectinload(VulnAudit.vulns))
        .where(VulnAudit.id == audit.id)
    )
    return fresh.scalar_one()


# ---------------------------------------------------------------------------
# GET /projects/{project_id}/vuln-audits/latest
# ---------------------------------------------------------------------------

@router.get(
    "/{project_id}/vuln-audits/latest",
    response_model=VulnAuditOut,
)
async def get_latest_vuln_audit(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_project(project_id, current_user, db)

    result = await db.execute(
        select(VulnAudit)
        .options(selectinload(VulnAudit.vulns))
        .where(VulnAudit.project_id == project_id)
        .order_by(VulnAudit.started_at.desc())
        .limit(1)
    )
    audit = result.scalar_one_or_none()
    if not audit:
        raise HTTPException(status_code=404, detail="No vulnerability audit found — run one first")
    return audit


# ---------------------------------------------------------------------------
# GET /projects/{project_id}/vulnerabilities?severity=HIGH
# ---------------------------------------------------------------------------

@router.get(
    "/{project_id}/vulnerabilities",
    response_model=list[VulnerabilityOut],
)
async def list_vulnerabilities(
    project_id: int,
    severity: Optional[str] = Query(None, description="Filter by severity: CRITICAL, HIGH, MEDIUM, LOW"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_owned_project(project_id, current_user, db)

    # Find latest audit for this project
    audit_result = await db.execute(
        select(VulnAudit.id)
        .where(VulnAudit.project_id == project_id)
        .order_by(VulnAudit.started_at.desc())
        .limit(1)
    )
    audit_id = audit_result.scalar_one_or_none()
    if not audit_id:
        return []

    q = select(Vulnerability).where(Vulnerability.audit_id == audit_id)
    if severity:
        q = q.where(Vulnerability.severity == severity.upper())
    q = q.order_by(Vulnerability.severity)  # CRITICAL first alphabetically not ideal — see below

    result = await db.execute(q)
    return result.scalars().all()
