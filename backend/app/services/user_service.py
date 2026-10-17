from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.user import User
from app.models.project import Project
from app.schemas.user import UserCreate
from app.core.security import get_password_hash, verify_password

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()

async def create_user(db: AsyncSession, user_in: UserCreate) -> User:
    try:
        db_user = User(
            email=user_in.email,
            password_hash=get_password_hash(user_in.password)
        )
        db.add(db_user)
        await db.flush()

        default_project = Project(
            name="Default Project",
            user_id=db_user.id
        )
        db.add(default_project)
        await db.commit()
        await db.refresh(db_user)
        return db_user
    except Exception:
        await db.rollback()
        raise

async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(db, email)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
