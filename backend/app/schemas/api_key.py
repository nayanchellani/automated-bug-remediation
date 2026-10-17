from datetime import datetime
from pydantic import BaseModel, ConfigDict

class ApiKeyOut(BaseModel):
    id: int
    project_id: int
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

class ApiKeyCreatedOut(BaseModel):
    id: int
    project_id: int
    prefix: str
    raw_key: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
