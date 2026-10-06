from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.user import User
from app.schemas.user import UserCreate


try:
    from app.core.security import get_password_hash, verify_password
except ImportError:

    def get_password_hash(password: str) -> str:
        return password + "_hashed"
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        return hashed_password == plain_password + "_hashed"

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:

    query = select(User).where(User.email == email)

    result = await db.execute(query)

    return result.scalar_one_or_none()

async def create_user(db: AsyncSession, user_in: UserCreate) -> User:

    hashed_password = get_password_hash(user_in.password)
    

    db_user = User(
        email=user_in.email,
        password_hash=hashed_password
    )
    

    db.add(db_user)

    await db.commit()

    await db.refresh(db_user)
    
    return db_user

async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:

    user = await get_user_by_email(db, email)
    if not user:
        return None
        

    if not verify_password(password, user.password_hash):
        return None
        
    return user

