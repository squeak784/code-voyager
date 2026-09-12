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

            if self.should_ignore(file_path):
                continue

            if not file_path.is_file():
                continue

            relative_path = file_path.relative_to(directory)

            # Python анализируем полностью
            if file_path.suffix.lower() == ".py":

                try:
                    source_code = file_path.read_text(
                        encoding="utf-8"
                    )

                    analysis = self.analyzer.analyze(
                        source_code=source_code,
                        file_name=str(relative_path),
                    )

                    files.append(
                        ProjectFile(
                            path=str(relative_path),
                            analysis=analysis,
                        )
                    )

                except UnicodeDecodeError:
                    print(
                        f"Пропущен файл с неподдерживаемой кодировкой: "
                        f"{relative_path}"
                    )

                except SyntaxError as error:
                    print(
                        f"Ошибка синтаксиса в {relative_path}: "
                        f"{error}"
                    )

            # Остальные файлы просто добавляем
            else:
                files.append(
                    ProjectFile(
                        path=str(relative_path),
                        analysis=None,
                    )
                )

        return ProjectAnalysis(
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