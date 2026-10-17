import hashlib
import io
import os
import zipfile
from pathlib import PurePosixPath
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.deps import get_db, get_project_from_api_key, get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.snapshot import Snapshot
from app.models.dependency import Dependency
from app.schemas.snapshot import SnapshotOut, DependencyOut
from app.core.manifest_parser import parse_manifests

router = APIRouter()

MAX_ARCHIVE = 20 * 1024 * 1024          # 20 MB compressed limit
MAX_UNCOMPRESSED = 100 * 1024 * 1024    # 100 MB zip-bomb guard
MAX_FILES = 5000                         # 5,000 files limit
MAX_SNAPSHOTS_TO_KEEP = 3               # Keep latest 3 snapshots per project
STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "storage"))

BLOCKED = (".env", ".pem", ".key", "id_rsa", ".p12", ".pfx")

@router.post("/snapshots", status_code=status.HTTP_201_CREATED, response_model=SnapshotOut)
async def upload_snapshot(
    file: UploadFile = File(...),
    project: Project = Depends(get_project_from_api_key),
    db: AsyncSession = Depends(get_db)
):
    # 1. Read archive with size cap
    data = await file.read(MAX_ARCHIVE + 1)
    if len(data) > MAX_ARCHIVE:
        raise HTTPException(status_code=413, detail="Archive exceeds 20MB limit")

    # 2. Verify valid zip format
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, Exception):
        raise HTTPException(status_code=422, detail="Invalid archive file")

    # 3. Zip bomb & file count check
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
        raise HTTPException(status_code=413, detail="Uncompressed size or file count exceeds safety limits")

    archive_sha = hashlib.sha256(data).hexdigest()
    tree = []
    manifests = {}
    total_uncompressed_bytes = 0

    # 4. Safe in-memory traversal (Never extract to disk on ingest)
    for i in infos:
        p = PurePosixPath(i.filename)
        # Zip-slip prevention
        if p.is_absolute() or ".." in p.parts:
            raise HTTPException(status_code=422, detail="Unsafe path in archive")

        # Server-side secret filter: drop secrets from tree & storage
        if any(p.name.startswith(b) or p.name.endswith(b) for b in BLOCKED):
            continue

        tree.append({"path": str(p), "size": i.file_size})
        total_uncompressed_bytes += i.file_size

        if p.name in {"package.json", "package-lock.json", "requirements.txt"} and i.file_size < 5_000_000:
            try:
                manifests[str(p)] = zf.read(i).decode("utf-8", "ignore")
            except Exception:
                pass

    # 5. Parse dependencies server-side
    parsed_deps = parse_manifests(manifests)

    # 6. Save archive safely to storage directory
    project_storage = os.path.join(STORAGE_DIR, str(project.id))
    os.makedirs(project_storage, exist_ok=True)
    archive_file_path = os.path.join(project_storage, f"{archive_sha}.zip")
    with open(archive_file_path, "wb") as f:
        f.write(data)

    now = datetime.now(timezone.utc)
    snapshot = Snapshot(
        project_id=project.id,
        created_at=now,
        sha256=archive_sha,
        file_count=len(tree),
        total_bytes=total_uncompressed_bytes,
        tree=tree,
        archive_path=archive_file_path,
    )
    db.add(snapshot)
    await db.flush()

    for dep_data in parsed_deps:
        dep = Dependency(
            snapshot_id=snapshot.id,
            ecosystem=dep_data["ecosystem"],
            name=dep_data["name"],
            version=dep_data["version"],
            is_dev=dep_data["is_dev"],
            source_file=dep_data["source_file"],
        )
        db.add(dep)

    # 7. Prune older snapshots beyond retention limit
    past_snapshots_res = await db.execute(
        select(Snapshot)
        .where(Snapshot.project_id == project.id)
        .order_by(Snapshot.created_at.desc())
    )
    past_snapshots = past_snapshots_res.scalars().all()
    if len(past_snapshots) > MAX_SNAPSHOTS_TO_KEEP:
        for old_snap in past_snapshots[MAX_SNAPSHOTS_TO_KEEP:]:
            try:
                if os.path.exists(old_snap.archive_path):
                    os.remove(old_snap.archive_path)
            except Exception:
                pass
            await db.delete(old_snap)

    await db.commit()
    await db.refresh(snapshot)
    return snapshot

@router.get("/projects/{project_id}/snapshots/latest", response_model=SnapshotOut)
async def get_latest_snapshot(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    snap_res = await db.execute(
        select(Snapshot)
        .where(Snapshot.project_id == project.id)
        .order_by(Snapshot.created_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_res.scalar_one_or_none()
    if not latest_snapshot:
        raise HTTPException(status_code=404, detail="No snapshots found for this project")

    return latest_snapshot

@router.get("/projects/{project_id}/dependencies", response_model=List[DependencyOut])
async def get_latest_dependencies(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership
    res = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get latest snapshot
    snap_res = await db.execute(
        select(Snapshot)
        .where(Snapshot.project_id == project.id)
        .order_by(Snapshot.created_at.desc())
        .limit(1)
    )
    latest_snapshot = snap_res.scalar_one_or_none()
    if not latest_snapshot:
        return []

    deps_res = await db.execute(
        select(Dependency)
        .where(Dependency.snapshot_id == latest_snapshot.id)
        .order_by(Dependency.name.asc())
    )
    return deps_res.scalars().all()
