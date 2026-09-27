from app.analyzers.documentation_analyzer import DocumentationAnalyzer
from app.models.code_models import (
    DocumentationIssue,
    FileDocumentationReport,
    ProjectAnalysis,
    ProjectDocumentationReport,
)


class DocumentationService:
    """Формирует общий и файловые отчёты по документации проекта."""

    def __init__(self):
        self.analyzer = DocumentationAnalyzer()

    def analyze_project(
        self,
        project: ProjectAnalysis,
    ) -> ProjectDocumentationReport:

        all_issues: list[DocumentationIssue] = []
        file_reports: list[FileDocumentationReport] = []

        total_elements = 0
        documented_elements = 0

        for project_file in project.files:
            if project_file.analysis is None:
                continue

            report = self.analyzer.analyze(project_file.analysis)

            file_reports.append(
                FileDocumentationReport(
                    path=project_file.path,
                    total_elements=report.total_elements,
                    documented_elements=report.documented_elements,
                    undocumented_elements=report.undocumented_elements,
                    documentation_percentage=(
                        round(
                            report.documented_elements
                            / report.total_elements
                            * 100,
                            2,
                        )
                        if report.total_elements > 0
                        else 100.0
                    ),
                    issues=report.issues,
                )
            )

            total_elements += report.total_elements
            documented_elements += report.documented_elements

            for issue in report.issues:
                all_issues.append(
                    issue.model_copy(
                        update={
                            "scope": f"{project_file.path}:{issue.scope}"
                        }
                    )
                )

        undocumented_elements = total_elements - documented_elements

        if total_elements > 0:
            documentation_percentage = round(
                documented_elements / total_elements * 100,
                2,
            )
        else:
            documentation_percentage = 100.0

        return ProjectDocumentationReport(
            total_elements=total_elements,
            documented_elements=documented_elements,
            undocumented_elements=undocumented_elements,
            documentation_percentage=documentation_percentage,
            issues=all_issues,
            files=file_reports,
        )
