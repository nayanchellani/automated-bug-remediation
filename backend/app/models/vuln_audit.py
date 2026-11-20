import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.db.session import Base


class VulnAudit(Base):
    __tablename__ = "vuln_audits"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_id = Column(String(36), ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False)  # "running" | "completed" | "failed"
    started_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime(timezone=True), nullable=True)
    vuln_count = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)

    project = relationship("Project", back_populates="vuln_audits")
    vulns = relationship("Vulnerability", back_populates="audit", cascade="all, delete-orphan")


class Vulnerability(Base):
    __tablename__ = "vulnerabilities"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    audit_id = Column(String(36), ForeignKey("vuln_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    osv_id = Column(String(100), nullable=False)         # e.g. GHSA-... or CVE-...
    package_name = Column(String(200), nullable=False)
    ecosystem = Column(String(20), nullable=False)
    installed_version = Column(String(100), nullable=True)
    fixed_version = Column(String(100), nullable=True)
    severity = Column(String(20), nullable=False)        # CRITICAL | HIGH | MEDIUM | LOW
    summary = Column(Text, nullable=False)
    details = Column(Text, nullable=True)

    audit = relationship("VulnAudit", back_populates="vulns")
