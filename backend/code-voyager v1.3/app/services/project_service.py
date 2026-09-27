from pathlib import Path
from zipfile import ZipFile

from app.analyzers.python_analyzer import PythonAnalyzer
from app.models.code_models import ProjectAnalysis, ProjectFile


class ProjectService:
    """Работа с загруженными проектами."""

    IGNORED_DIRECTORIES = {
        ".venv",
        "venv",
        ".git",
        "__pycache__",
        "node_modules",
        ".idea",
        ".vscode",
        "dist",
        "build",
    }

    IGNORED_FILES = {
        ".pyc",
    }

    def __init__(self):
        self.analyzer = PythonAnalyzer()

    def should_ignore(self, path: Path) -> bool:
        """Проверяет, нужно ли пропустить файл или папку."""

        if any(
            part in self.IGNORED_DIRECTORIES
            for part in path.parts
        ):
            return True

        if path.suffix.lower() in self.IGNORED_FILES:
            return True

        return False

    def analyze_directory(
        self,
        directory: Path,
        project_name: str,
    ) -> ProjectAnalysis:

        files = []

        for file_path in directory.rglob("*"):

            if self.should_ignore(file_path.relative_to(directory)):
                continue

            if not file_path.is_file():
                continue

            relative_path = file_path.relative_to(directory)

            result = ProjectFile(path=relative_path.as_posix(), analysis=None)
            if file_path.suffix.lower() == ".py":
                try:
                    source_code = file_path.read_bytes().decode("utf-8-sig")
                    result.analysis = self.analyzer.analyze(source_code, relative_path.as_posix())
                except (UnicodeDecodeError, SyntaxError, ValueError) as error:
                    result.error = str(error)
            files.append(result)

        return ProjectAnalysis(
            analysis_version=3,
            project_name=project_name,
            files=files,
        )

    def extract_zip(
        self,
        zip_path: Path,
        destination: Path,
    ) -> None:

        destination.mkdir(
            parents=True,
            exist_ok=True,
        )

        with ZipFile(zip_path, "r") as zip_file:
            zip_file.extractall(destination)