from pathlib import Path
import shutil
from uuid import uuid4
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends
from sqlalchemy.orm import Session



from app.analyzers.python_analyzer import PythonAnalyzer
from app.models.code_models import (
    CodeElement,
    FileAnalysisResponse,
    FileStatistics,
    ProjectAnalysis,
    ProjectFileResponse,
    ProjectStructureNode,
    ProjectStructureResponse,
    ProjectListItem,
)
from app.services.project_service import ProjectService
from app.analyzers.documentation_analyzer import DocumentationAnalyzer
from app.services.documentation_service import DocumentationService

from app.database.database import Base, engine
from app.database import models
from app.auth.router import router as auth_router
from app.auth.dependencies import get_current_user
from app.database.database import get_db
from app.database.models import User, Project
from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app):
    from app.services.rag_jobs import start, stop
    start()
    try:
        yield
    finally:
        stop()


app = FastAPI(
    title="AutoDocumentation",
    description="Система автоматической документации и анализа исходного кода",
    version="0.1.0",
    lifespan=lifespan,
)

Base.metadata.create_all(bind=engine)
app.include_router(auth_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analyzer = PythonAnalyzer()
project_service = ProjectService()
documentation_analyzer = DocumentationAnalyzer()
documentation_service = DocumentationService()

PROJECTS_DIR = Path("projects")
PROJECTS_DIR.mkdir(exist_ok=True)

@app.get("/")
def root():
    return {
        "message": "AutoDocumentation API работает!",
        "status": "ok",
    }

@app.get("/projects", response_model=list[ProjectListItem])
def get_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    projects = (
        db.query(Project)
        .filter(Project.user_id == current_user.id)
        .order_by(Project.created_at.desc())
        .all()
    )

    return [
        ProjectListItem(
            id=project.id,
            name=project.name,
            created_at=project.created_at,
        )
        for project in projects
    ]

def get_owned_project(
    project_id: str,
    current_user: User,
    db: Session,
) -> Project:
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.user_id == current_user.id,
        )
        .first()
    )

    if not project:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    return project

@app.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.workspace_router import project_lock
    from app.services.rag_core import remove_vectors
    with project_lock(project_id):
        project = get_owned_project(project_id, current_user, db)
        if project.rag_index is not None:
            try:
                remove_vectors(project.id, current_user.id)
            except Exception:
                raise HTTPException(503, 'Не удалось удалить индекс. Запустите Qdrant и повторите удаление проекта.') from None
        project_directory = Path(project.directory_path)
        if project_directory.exists():
            shutil.rmtree(project_directory)
        db.delete(project)
        db.commit()
    return {"message": "Проект удалён"}


@app.post("/analyze/python")
async def analyze_python(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".py"):
        raise HTTPException(
            status_code=400,
            detail="Необходимо загрузить Python-файл (.py)",
        )

    try:
        source_code = (await file.read()).decode("utf-8")

        return analyzer.analyze(
            source_code=source_code,
            file_name=file.filename,
        )

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Не удалось прочитать файл как UTF-8",
        )

    except SyntaxError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Ошибка синтаксиса Python: {error}",
        )


@app.post("/projects/upload")
async def upload_project(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Файл не имеет имени",
        )

    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=400,
            detail="Необходимо загрузить ZIP-архив проекта",
        )

    project_id = str(uuid4())

    project_directory = PROJECTS_DIR / project_id
    zip_path = PROJECTS_DIR / f"{project_id}.zip"

    try:
        file_content = await file.read()
        zip_path.write_bytes(file_content)

        project_service.extract_zip(
            zip_path=zip_path,
            destination=project_directory,
        )

        analysis = project_service.analyze_directory(
            directory=project_directory,
            project_name=file.filename,
        )

        project = Project(
            id=project_id,
            user_id=current_user.id,
            name=file.filename,
            directory_path=str(project_directory),
            analysis=analysis.model_dump_json(),
        )

        db.add(project)
        db.flush()
        from app.services.rag_jobs import invalidate, enqueue
        invalidate(db, project)
        db.commit()
        enqueue(project.id)
        db.refresh(project)

        return {
            "project_id": project.id,
            "project": analysis,
        }

    except Exception as error:
        db.rollback()

        if project_directory.exists():
            import shutil
            shutil.rmtree(project_directory, ignore_errors=True)

        raise HTTPException(
            status_code=500,
            detail=f"Ошибка обработки проекта: {error}",
        )

    finally:
        if zip_path.exists():
            zip_path.unlink()

def load_project_analysis(project: Project, db: Session) -> ProjectAnalysis:
    analysis = ProjectAnalysis.model_validate_json(project.analysis)
    if analysis.analysis_version < 3:
        directory = Path(project.directory_path)
        if directory.is_dir():
            analysis = project_service.analyze_directory(directory, project.name)
            project.analysis = analysis.model_dump_json()
            db.commit()
    return analysis


@app.get("/projects/{project_id}")
def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_owned_project(
        project_id,
        current_user,
        db,
    )

    return load_project_analysis(project, db)

def _build_file_analysis_response(analysis):
    """Преобразует внутренний AST-анализ в удобный формат для React."""

    raw_elements = []

    for function in analysis.functions:
        raw_elements.append(
            CodeElement(
                id=f"function:{function.scope}.{function.name}:{function.line}",
                type="function",
                name=function.name,
                line=function.line,
                line_end=function.line_end,
                scope=function.scope,
                documented=function.has_documentation,
                documentation=function.documentation,
            )
        )

    for class_info in analysis.classes:
        raw_elements.append(
            CodeElement(
                id=f"class:{class_info.scope}.{class_info.name}:{class_info.line}",
                type="class",
                name=class_info.name,
                line=class_info.line,
                line_end=class_info.line_end,
                scope=class_info.scope,
                documented=class_info.has_documentation,
                documentation=class_info.documentation,
            )
        )

    for variable in analysis.variables:
        raw_elements.append(
            CodeElement(
                id=f"variable:{variable.scope}.{variable.name}:{variable.line}",
                type="variable",
                name=variable.name,
                line=variable.line,
                line_end=variable.line_end,
                scope=variable.scope,
                documented=variable.has_documentation,
                documentation=variable.documentation,
            )
        )

    # Для отображения структуры файла элементы идут по номеру строки.
    raw_elements.sort(key=lambda element: (element.line, element.line_end))

    total = len(raw_elements)
    documented = sum(
        1 for element in raw_elements if element.documented
    )
    undocumented = total - documented

    percentage = (
        round(documented / total * 100, 2)
        if total > 0
        else 100.0
    )

    return FileAnalysisResponse(
        file_name=analysis.file_name,
        language="python",
        statistics=FileStatistics(
            total=total,
            documented=documented,
            undocumented=undocumented,
            documentation_percentage=percentage,
        ),
        elements=raw_elements,
        imports=analysis.imports,
        functions=analysis.functions,
        classes=analysis.classes,
        variables=analysis.variables,
    )


@app.get(
    "/projects/{project_id}/files/{file_path:path}",
    response_model=ProjectFileResponse,
)
def get_project_file(
    project_id: str,
    file_path: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Проверяем, что проект принадлежит текущему пользователю
    project = get_owned_project(
        project_id,
        current_user,
        db,
    )

    # Получаем сохранённый анализ проекта из PostgreSQL
    project_analysis = load_project_analysis(project, db)

    # Папка, куда был распакован проект
    project_directory = Path(project.directory_path)

    # Нормализуем путь файла
    relative_target_path = file_path.replace("\\", "/")

    # Проверяем, что файл действительно существует в анализе проекта
    project_file = next(
        (
            stored_file
            for stored_file in project_analysis.files
            if stored_file.path.replace("\\", "/")
            == relative_target_path
        ),
        None,
    )

    if project_file is None:
        raise HTTPException(
            status_code=404,
            detail="Файл проекта не найден",
        )

    # Получаем физический файл
    target_file = project_directory / project_file.path

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(
            status_code=404,
            detail="Файл проекта не найден на диске",
        )

    try:
        content = target_file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Не удалось прочитать файл как UTF-8",
        )

    analysis_response = None

    if project_file.analysis is not None:
        analysis_response = _build_file_analysis_response(
            project_file.analysis
        )

    return ProjectFileResponse(
        path=project_file.path,
        language="python" if target_file.suffix.lower() == ".py" else None,
        content=content,
        analysis=analysis_response,
    )


@app.get(
    "/projects/{project_id}/structure",
    response_model=ProjectStructureResponse,
)
def get_project_structure(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_owned_project(
        project_id,
        current_user,
        db,
    )

    project_analysis = load_project_analysis(project, db)

    # Плоский список сохраняем для обратной совместимости.
    files = [
        {
            "path": file.path,
            "language": (
                "python"
                if file.path.lower().endswith(".py")
                else None
            ),
            "analyzed": file.analysis is not None,
        }
        for file in project_analysis.files
    ]

    # Строим готовое дерево, чтобы React не приходилось
    # самостоятельно группировать пути.
    root: list[ProjectStructureNode] = []

    for file in sorted(project_analysis.files, key=lambda item: item.path.lower()):
        parts = file.path.replace("\\", "/").split("/")
        current = root
        current_path_parts = []

        for index, part in enumerate(parts):
            current_path_parts.append(part)
            current_path = "/".join(current_path_parts)
            is_file = index == len(parts) - 1

            existing = next(
                (
                    node
                    for node in current
                    if node.name == part
                ),
                None,
            )

            if existing is None:
                existing = ProjectStructureNode(
                    name=part,
                    path=current_path,
                    type="file" if is_file else "directory",
                    children=[],
                )
                current.append(existing)

            current = existing.children

    return ProjectStructureResponse(
        project_name=project_analysis.project_name,
        files=files,
        tree=root,
    )


@app.get("/projects/{project_id}/documentation")
def get_project_documentation(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = get_owned_project(
        project_id,
        current_user,
        db,
    )

    project_analysis = load_project_analysis(project, db)

    return documentation_service.analyze_project(
        project_analysis
    )

@app.post("/analyze/python/documentation")
async def analyze_python_documentation(
    file: UploadFile = File(...),
):
    if not file.filename or not file.filename.lower().endswith(".py"):
        raise HTTPException(
            status_code=400,
            detail="Необходимо загрузить Python-файл (.py)",
        )

    try:
        source_code = (await file.read()).decode("utf-8")

        analysis = analyzer.analyze(
            source_code=source_code,
            file_name=file.filename,
        )

        return documentation_analyzer.analyze(
            analysis
        )

    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Не удалось прочитать файл как UTF-8",
        )

    except SyntaxError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Ошибка синтаксиса Python: {error}",
        )

        
from app.workspace_router import router as workspace_router
app.include_router(workspace_router)
from app.comments_router import router as comments_router
app.include_router(comments_router)
from app.graph_router import router as graph_router
app.include_router(graph_router)
from app.project_settings_router import router as project_settings_router
app.include_router(project_settings_router)

from app.rag_router import router as rag_router
app.include_router(rag_router)
