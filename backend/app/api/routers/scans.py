import asyncio
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.deps import get_db, get_current_user
from app.core.analyzer_runner import AnalyzerError, run_analysis
from app.models.user import User
from app.models.project import Project
from app.models.snapshot import Snapshot
from app.models.scan import Scan
from app.models.finding import Finding
from app.schemas.scan import ScanOut, FindingOut

router = APIRouter()

MAX_SCANS_TO_KEEP = 5


async def _get_owned_project(db: AsyncSession, project_id: int, user: User) -> Project:
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == user.id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def _latest_scan(db: AsyncSession, project_id: int) -> Optional[Scan]:
    res = await db.execute(
        select(Scan)
        .where(Scan.project_id == project_id)
        .order_by(Scan.started_at.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


@router.post("/projects/{project_id}/scans", response_model=ScanOut, status_code=status.HTTP_201_CREATED)
async def run_scan(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned_project(db, project_id, current_user)

    snap_res = await db.execute(
        select(Snapshot)
        .where(Snapshot.project_id == project.id)
        .order_by(Snapshot.created_at.desc())
        .limit(1)
    )
    snapshot = snap_res.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="No snapshots found. Run 'npx triage push' first.")

    scan = Scan(
        project_id=project.id,
        snapshot_id=snapshot.id,
        status="completed",
        started_at=datetime.now(timezone.utc),
    )
    db.add(scan)

    try:
        files_analyzed, raw_findings = await asyncio.to_thread(run_analysis, snapshot.archive_path)
        scan.files_analyzed = files_analyzed
        scan.finding_count = len(raw_findings)
        await db.flush()
        for f in raw_findings:
            db.add(Finding(
                scan_id=scan.id,
                type=str(f.get("type", "lint"))[:20],
                severity=str(f.get("severity", "warning"))[:20],
                rule=str(f.get("rule", "unknown"))[:100],
                file=str(f.get("file", ""))[:500],
                line=int(f.get("line") or 1),
                column=int(f.get("column") or 1),
                message=str(f.get("message", "")),
                snippet=str(f.get("snippet", "")),
            ))
    except AnalyzerError as exc:
        scan.status = "failed"
        scan.error = str(exc)

    scan.finished_at = datetime.now(timezone.utc)
    await db.flush()

    # Retention: keep only the most recent scans per project
    old_res = await db.execute(
        select(Scan)
        .where(Scan.project_id == project.id)
        .order_by(Scan.started_at.desc())
    )
    for old in old_res.scalars().all()[MAX_SCANS_TO_KEEP:]:
        await db.delete(old)

    await db.commit()
    await db.refresh(scan)
    return scan


@router.get("/projects/{project_id}/scans/latest", response_model=ScanOut)
async def get_latest_scan(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned_project(db, project_id, current_user)
    scan = await _latest_scan(db, project.id)
    if not scan:
        raise HTTPException(status_code=404, detail="No scans found for this project")
    return scan


@router.get("/projects/{project_id}/findings", response_model=List[FindingOut])
async def list_findings(
    project_id: int,
    severity: Optional[str] = Query(None, pattern="^(error|warning)$"),
    type: Optional[str] = Query(None, pattern="^(syntax|lint)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_owned_project(db, project_id, current_user)
    scan = await _latest_scan(db, project.id)
    if not scan:
        return []

    stmt = select(Finding).where(Finding.scan_id == scan.id)
    if severity:
        stmt = stmt.where(Finding.severity == severity)
    if type:
        stmt = stmt.where(Finding.type == type)
    # "error" sorts before "warning" alphabetically
    stmt = stmt.order_by(Finding.severity.asc(), Finding.file.asc(), Finding.line.asc())
    res = await db.execute(stmt)
    return res.scalars().all()
