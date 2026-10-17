import hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.api.deps import get_db, get_project_from_api_key
from app.models.error_event import ErrorEvent
from app.models.project import Project
from app.schemas.ingest import ErrorIn
from app.core.fingerprint import compute_fingerprint

MAX_PAYLOAD_SIZE = 65536  # 64 KB

def api_key_rate_key(request: Request) -> str:
    key = request.headers.get("X-API-Key")
    return hashlib.sha256(key.encode()).hexdigest() if key else get_remote_address(request)

limiter = Limiter(key_func=api_key_rate_key)
router = APIRouter(prefix="/ingest", tags=["ingest"])

async def verify_content_length(request: Request):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_PAYLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Payload too large (maximum 64KB)",
        )

@router.post("/error", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("100/minute")
async def ingest_error(
    request: Request,
    payload: ErrorIn,
    project: Project = Depends(get_project_from_api_key),
    db: AsyncSession = Depends(get_db),
    _len_check: None = Depends(verify_content_length),
):
    fp, frame = compute_fingerprint(payload.name, payload.message, payload.frames)
    now = datetime.now(timezone.utc)

    file_val = getattr(frame, "file", None) if frame else None
    line_val = getattr(frame, "line", None) if frame else None
    func_val = getattr(frame, "function", None) if frame else None

    stmt = pg_insert(ErrorEvent).values(
        project_id=project.id,
        fingerprint=fp,
        name=payload.name,
        message=payload.message,
        stack=payload.stack,
        file=file_val,
        line=line_val,
        function=func_val,
        route=payload.route,
        method=payload.method,
        environment=payload.environment,
        release=payload.release,
        count=payload.count,
        first_seen=now,
        last_seen=now,
    )

    stmt = stmt.on_conflict_do_update(
        constraint="uq_error_project_fingerprint",
        set_={
            "count": ErrorEvent.count + payload.count,
            "last_seen": now,
            "message": stmt.excluded.message,
        },
    )

    await db.execute(stmt)
    await db.commit()
    return {"status": "accepted"}
