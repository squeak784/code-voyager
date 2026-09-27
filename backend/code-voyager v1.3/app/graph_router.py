from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.auth.dependencies import get_current_user
from app.database.database import get_db
from app.database.models import User
from app.workspace_router import owned, project_lock
from app.services.code_graph import build_graph

router = APIRouter(tags=['Project map'])

@router.get('/projects/{project_id}/graph')
def project_graph(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with project_lock(project_id):
        project = owned(project_id, user, db)
        return build_graph(project.directory_path)
