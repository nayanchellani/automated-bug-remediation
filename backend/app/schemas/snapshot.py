from datetime import datetime
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, ConfigDict

class SnapshotOut(BaseModel):
    id: str
    project_id: int
    created_at: datetime
    sha256: str
    file_count: int
    total_bytes: int
    tree: List[Dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)

class DependencyOut(BaseModel):
    id: str
    snapshot_id: str
    ecosystem: str
    name: str
    version: Optional[str] = None
    is_dev: bool
    source_file: str

    model_config = ConfigDict(from_attributes=True)
