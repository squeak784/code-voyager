"""Change project labels without moving source files or revisions."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.database import get_db
from app.database.models import User
from app.models.code_models import ProjectListItem
from app.workspace_router import owned, project_lock, service

router = APIRouter(tags=['Проекты'])


class RenameProjectRequest(BaseModel):
    name: str = Field(max_length=1024)


@router.patch('/projects/{project_id}', response_model=ProjectListItem)
def rename_project(project_id: str, body: RenameProjectRequest,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = body.name.strip()
    if not 1 <= len(name) <= 255 or any(ord(c) < 32 or ord(c) == 127 or c in '/\\' for c in name):
        raise HTTPException(422, 'Название: от 1 до 255 символов, без слешей и управляющих символов.')
    with project_lock(project_id):
        project = owned(project_id, current_user, db)
        try:
            analysis = json.loads(project.analysis or 'null')
            if not isinstance(analysis, dict):
                raise ValueError('Missing analysis')
        except (ValueError, TypeError):
            from pathlib import Path
            analysis = service.analyze_directory(Path(project.directory_path), name).model_dump()
        analysis['project_name'] = name
        project.name = name
        project.analysis = json.dumps(analysis, ensure_ascii=False)
        db.commit()
        return ProjectListItem(id=project.id, name=project.name, created_at=project.created_at)
