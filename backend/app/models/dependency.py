import uuid
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base

class Dependency(Base):
    __tablename__ = "dependencies"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    snapshot_id = Column(String(36), ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    ecosystem = Column(String(20), nullable=False)   # "npm" | "PyPI"
    name = Column(String(200), nullable=False)
    version = Column(String(100), nullable=True)
    is_dev = Column(Boolean, default=False, nullable=False)
    source_file = Column(String(300), nullable=False)

    snapshot = relationship("Snapshot", back_populates="dependencies")
