from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile

from app.analyzers.python_analyzer import PythonAnalyzer
from app.models.code_models import ProjectAnalysis
from app.services.project_service import ProjectService
from app.analyzers.documentation_analyzer import DocumentationAnalyzer
from app.services.documentation_service import DocumentationService


app = FastAPI(
    title="AutoDocumentation",
    description="Система автоматической документации и анализа исходного кода",
    version="0.1.0",
)

analyzer = PythonAnalyzer()
project_service = ProjectService()
documentation_analyzer = DocumentationAnalyzer()
documentation_service = DocumentationService()

PROJECTS_DIR = Path("projects")
PROJECTS_DIR.mkdir(exist_ok=True)

# Временное хранилище проектов.
# Позже заменим его на SQLite.
projects: dict[str, ProjectAnalysis] = {}


@app.get("/")
def root():
    return {
        "message": "AutoDocumentation API работает!",
        "status": "ok",
    }


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

        projects[project_id] = analysis

        return {
            "project_id": project_id,
            "project": analysis,
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка обработки проекта: {error}",
        )

    finally:
        if zip_path.exists():
            zip_path.unlink()


@app.get("/projects/{project_id}")
def get_project(project_id: str):
    if project_id not in projects:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    return projects[project_id]


@app.get("/projects/{project_id}/structure")
def get_project_structure(project_id: str):
    if project_id not in projects:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    project = projects[project_id]

    return {
        "project_name": project.project_name,
        "files": [
            {
                "path": file.path,
            }
            for file in project.files
        ],
    }

@app.get("/projects/{project_id}/documentation")
def get_project_documentation(
    project_id: str,
):
    if project_id not in projects:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    project = projects[project_id]

    return documentation_service.analyze_project(
        project
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

        