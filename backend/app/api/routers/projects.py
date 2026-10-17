from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.api.deps import get_db, get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey
from app.models.error_event import ErrorEvent
from app.schemas.project import ProjectCreate, ProjectOut
from app.schemas.api_key import ApiKeyOut, ApiKeyCreatedOut
from app.schemas.ingest import IncidentOut
from app.core.security import generate_api_key

router = APIRouter()

MAX_ACTIVE_KEYS_PER_PROJECT = 5

@router.get("", response_model=List[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Project).where(Project.user_id == current_user.id).order_by(Project.created_at.asc())
    )
    return result.scalars().all()

@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_in: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    project = Project(name=project_in.name.strip(), user_id=current_user.id)
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project

@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.delete("/{project_id}", status_code=status.HTTP_200_OK)
async def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.commit()
    return {"message": "Project deleted successfully", "id": project_id}

@router.post("/{project_id}/api-keys", response_model=ApiKeyCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership and lock row to serialize concurrent key creations
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
        .with_for_update()
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Limit active keys per project (max 5)
    active_count_res = await db.execute(
        select(func.count(ApiKey.id)).where(
            ApiKey.project_id == project.id,
            ApiKey.revoked_at.is_(None)
        )
    )
    active_count = active_count_res.scalar() or 0
    if active_count >= MAX_ACTIVE_KEYS_PER_PROJECT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Active API key limit reached (maximum {MAX_ACTIVE_KEYS_PER_PROJECT} active keys per project). Revoke an existing key first."
        )

    raw_key, prefix, key_hash = generate_api_key()
    api_key = ApiKey(
        project_id=project.id,
        prefix=prefix,
        key_hash=key_hash,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyCreatedOut(
        id=api_key.id,
        project_id=api_key.project_id,
        prefix=api_key.prefix,
        raw_key=raw_key,
        created_at=api_key.created_at,
    )

@router.get("/{project_id}/api-keys", response_model=List[ApiKeyOut])
async def list_api_keys(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    keys_result = await db.execute(
        select(ApiKey)
        .where(ApiKey.project_id == project.id)
        .order_by(ApiKey.created_at.desc())
    )
    return keys_result.scalars().all()

@router.delete("/{project_id}/api-keys/{key_id}")
async def revoke_api_key(
    project_id: int,
    key_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify key belongs to this project
    key_result = await db.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.project_id == project.id)
    )
    api_key = key_result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    if not api_key.revoked_at:
        api_key.revoked_at = datetime.now(timezone.utc)
        await db.commit()

    return {"message": "API key revoked successfully", "id": key_id}

@router.get("/{project_id}/incidents", response_model=List[IncidentOut])
async def list_project_incidents(
    project_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Verify project ownership
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    incidents_res = await db.execute(
        select(ErrorEvent)
        .where(ErrorEvent.project_id == project.id)
        .order_by(ErrorEvent.last_seen.desc())
        .limit(limit)
        .offset(offset)
    )
    return incidents_res.scalars().all()

