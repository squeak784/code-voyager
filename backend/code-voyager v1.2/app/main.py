from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.analyzers.python_analyzer import PythonAnalyzer
from app.models.code_models import (
    CodeElement,
    FileAnalysisResponse,
    FileStatistics,
    ProjectAnalysis,
    ProjectFileResponse,
    ProjectStructureNode,
    ProjectStructureResponse,
)
from app.services.project_service import ProjectService
from app.analyzers.documentation_analyzer import DocumentationAnalyzer
from app.services.documentation_service import DocumentationService


app = FastAPI(
    title="AutoDocumentation",
    description="Система автоматической документации и анализа исходного кода",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
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
def get_project_file(project_id: str, file_path: str):
    if project_id not in projects:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    project_directory = PROJECTS_DIR / project_id
    normalized_path = file_path.replace("\\", "/").lstrip("/")

    # Сначала пробуем прямой путь.
    target_file = project_directory / normalized_path

    # Если архив содержит корневую папку, например:
    # AutoDocumentation/app/main.py,
    # а клиент запросил app/main.py — ищем файл рекурсивно.
    if not target_file.is_file():
        possible_files = list(
            project_directory.rglob(normalized_path)
        )

        if possible_files:
            target_file = possible_files[0]
        else:
            raise HTTPException(
                status_code=404,
                detail="Файл не найден",
            )

    # Защита от выхода за пределы директории проекта.
    try:
        target_file.resolve().relative_to(
            project_directory.resolve()
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Некорректный путь к файлу",
        )

    try:
        content = target_file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Не удалось прочитать файл как UTF-8",
        )

    relative_target_path = (
        target_file
        .relative_to(project_directory)
        .as_posix()
    )

    project_file = next(
        (
            stored_file
            for stored_file in projects[project_id].files
            if stored_file.path.replace("\\", "/")
            == relative_target_path
        ),
        None,
    )

    file_analysis = None

    if project_file and project_file.analysis:
        file_analysis = _build_file_analysis_response(
            project_file.analysis
        )

    language = None

    if target_file.suffix.lower() == ".py":
        language = "python"

    return ProjectFileResponse(
        path=relative_target_path,
        language=language,
        content=content,
        analysis=file_analysis,
    )


@app.get(
    "/projects/{project_id}/structure",
    response_model=ProjectStructureResponse,
)
def get_project_structure(project_id: str):
    if project_id not in projects:
        raise HTTPException(
            status_code=404,
            detail="Проект не найден",
        )

    project = projects[project_id]

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
        for file in project.files
    ]

    # Строим готовое дерево, чтобы React не приходилось
    # самостоятельно группировать пути.
    root: list[ProjectStructureNode] = []

    for file in sorted(project.files, key=lambda item: item.path.lower()):
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
        project_name=project.project_name,
        files=files,
        tree=root,
    )


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

        