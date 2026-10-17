from datetime import datetime, timezone
import uuid
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.db.session import Base

class Snapshot(Base):
    __tablename__ = "snapshots"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    sha256 = Column(String(64), nullable=False)
    file_count = Column(Integer, nullable=False)
    total_bytes = Column(Integer, nullable=False)
    tree = Column(JSONB().with_variant(JSONB, "postgresql"), nullable=False)
    archive_path = Column(String(500), nullable=False)

    project = relationship("Project", back_populates="snapshots")
    dependencies = relationship("Dependency", back_populates="snapshot", cascade="all, delete-orphan")
