from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.db.session import Base

class ErrorEvent(Base):
    __tablename__ = "error_events"
    __table_args__ = (
        UniqueConstraint("project_id", "fingerprint", name="uq_error_project_fingerprint"),
        Index("ix_error_project_last_seen", "project_id", "last_seen"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    name = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    stack = Column(Text, nullable=False)
    file = Column(String(500), nullable=True)
    line = Column(Integer, nullable=True)
    function = Column(String(200), nullable=True)
    route = Column(String(500), nullable=True)
    method = Column(String(10), nullable=True)
    environment = Column(String(50), nullable=True)
    release = Column(String(100), nullable=True)
    count = Column(Integer, default=1, nullable=False)
    first_seen = Column(DateTime(timezone=True), nullable=False)
    last_seen = Column(DateTime(timezone=True), nullable=False)

    project = relationship("Project", back_populates="error_events")
