from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

class Frame(BaseModel):
    file: str = Field(max_length=500)
    line: int | None = None
    function: str | None = Field(None, max_length=200)
    in_app: bool = True

class ErrorIn(BaseModel):
    name: str = Field(max_length=200)
    message: str = Field(max_length=2000)
    stack: str = Field(max_length=16000)
    frames: list[Frame] = Field(default_factory=list, max_length=50)
    route: str | None = Field(None, max_length=500)
    method: str | None = Field(None, max_length=10)
    environment: str | None = Field(None, max_length=50)
    release: str | None = Field(None, max_length=100)
    count: int = Field(1, ge=1, le=10000)

class IncidentOut(BaseModel):
    id: int
    name: str
    message: str
    file: str | None = None
    line: int | None = None
    count: int
    first_seen: datetime
    last_seen: datetime

    model_config = ConfigDict(from_attributes=True)
