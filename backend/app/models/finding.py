import uuid
from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base

class Finding(Base):
    __tablename__ = "findings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scan_id = Column(String(36), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(20), nullable=False)       # "syntax" | "lint"
    severity = Column(String(20), nullable=False)   # "error" | "warning"
    rule = Column(String(100), nullable=False)
    file = Column(String(500), nullable=False)
    line = Column(Integer, nullable=False)
    column = Column(Integer, nullable=False)
    message = Column(Text, nullable=False)
    snippet = Column(Text, nullable=False, default="")
    source_tool = Column(String(50), nullable=False, default="triage-analyzer")

    scan = relationship("Scan", back_populates="findings")
