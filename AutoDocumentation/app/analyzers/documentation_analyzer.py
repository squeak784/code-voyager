from app.models.code_models import (
    DocumentationIssue,
    DocumentationReport,
    PythonFileAnalysis,
)


class DocumentationAnalyzer:
    """Определяет элементы, которым не хватает документации."""

    def analyze(
        self,
        analysis: PythonFileAnalysis,
    ) -> DocumentationReport:

        issues = []

        total_elements = 0
        documented_elements = 0

        # -------------------------
        # FUNCTIONS
        # -------------------------

        for function in analysis.functions:

            total_elements += 1

            if function.has_documentation:
                documented_elements += 1
            else:
                issues.append(
                    DocumentationIssue(
                        element_type="function",
                        name=function.name,
                        line=function.line,
                        scope=function.scope,
                        reason="Отсутствует документация функции",
                    )
                )

        # -------------------------
        # CLASSES
        # -------------------------

        for class_info in analysis.classes:

            total_elements += 1

            if class_info.has_documentation:
                documented_elements += 1
            else:
                issues.append(
                    DocumentationIssue(
                        element_type="class",
                        name=class_info.name,
                        line=class_info.line,
                        scope=class_info.scope,
                        reason="Отсутствует документация класса",
                    )
                )

        # -------------------------
        # VARIABLES
        # -------------------------

        for variable in analysis.variables:

            total_elements += 1

            if variable.has_documentation:
                documented_elements += 1
            else:
                issues.append(
                    DocumentationIssue(
                        element_type="variable",
                        name=variable.name,
                        line=variable.line,
                        scope=variable.scope,
                        reason="Отсутствует документация переменной",
                    )
                )

        return DocumentationReport(
            total_elements=total_elements,
            documented_elements=documented_elements,
            undocumented_elements=len(issues),
            issues=issues,
        )