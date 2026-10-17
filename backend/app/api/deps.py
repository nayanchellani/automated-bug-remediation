import hashlib
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
import jwt
from app.core.config import settings
from app.core.security import ALGORITHM
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.models.project import Project
from app.models.api_key import ApiKey

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type")
        if user_id is None or token_type != "access":
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

async def get_project_from_api_key(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db)
) -> Project:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized",
    )
    if not x_api_key:
        raise unauthorized

    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()

    result = await db.execute(
        select(ApiKey)
        .options(selectinload(ApiKey.project))
        .where(
            ApiKey.key_hash == key_hash,
            ApiKey.revoked_at.is_(None)
        )
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise unauthorized

    now = datetime.now(timezone.utc)
    if api_key.last_used_at is None or (now - api_key.last_used_at).total_seconds() > 60:
        api_key.last_used_at = now
        await db.commit()

    if not api_key.project:
        raise unauthorized

    return api_key.project
