from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict

class ScanOut(BaseModel):
    id: str
    project_id: int
    snapshot_id: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    files_analyzed: int
    finding_count: int
    error: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class FindingOut(BaseModel):
    id: str
    scan_id: str
    type: str
    severity: str
    rule: str
    file: str
    line: int
    column: int
    message: str
    snippet: str
    source_tool: str

    model_config = ConfigDict(from_attributes=True)
