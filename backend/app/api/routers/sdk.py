from fastapi import APIRouter, Depends
from app.api.deps import get_project_from_api_key
from app.models.project import Project
from app.schemas.project import ProjectOut

router = APIRouter()

@router.get("/validate", response_model=ProjectOut)
async def validate_api_key(
    project: Project = Depends(get_project_from_api_key)
):
    """SDK-facing route called on init() to validate the API key and return project details."""
    return project
