from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class VulnerabilityOut(BaseModel):
    id: str
    audit_id: str
    osv_id: str
    package_name: str
    ecosystem: str
    installed_version: Optional[str]
    fixed_version: Optional[str]
    severity: str   # CRITICAL | HIGH | MEDIUM | LOW
    summary: str

    model_config = {"from_attributes": True}


class VulnAuditOut(BaseModel):
    id: str
    project_id: int
    snapshot_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    vuln_count: int
    error: Optional[str]
    vulns: List[VulnerabilityOut] = []

    model_config = {"from_attributes": True}
