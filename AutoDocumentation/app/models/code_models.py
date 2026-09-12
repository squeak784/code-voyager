from pydantic import BaseModel


class ImportInfo(BaseModel):
    name: str
    line: int


class VariableInfo(BaseModel):
    name: str
    line: int
    scope: str
    has_documentation: bool
    documentation: str | None = None


class FunctionInfo(BaseModel):
    name: str
    line: int
    arguments: list[str]
    scope: str
    return_annotation: str | None = None
    has_documentation: bool
    documentation: str | None = None


class ClassInfo(BaseModel):
    name: str
    line: int
    scope: str
    bases: list[str]
    has_documentation: bool
    documentation: str | None = None


class PythonFileAnalysis(BaseModel):
    file_name: str
    imports: list[ImportInfo]
    functions: list[FunctionInfo]
    classes: list[ClassInfo]
    variables: list[VariableInfo]


class ProjectFile(BaseModel):
    path: str
    analysis: PythonFileAnalysis | None = None


class ProjectAnalysis(BaseModel):
    project_name: str
    files: list[ProjectFile]

class DocumentationIssue(BaseModel):
    element_type: str
    name: str
    line: int
    scope: str
    reason: str


class DocumentationReport(BaseModel):
    total_elements: int
    documented_elements: int
    undocumented_elements: int
    issues: list[DocumentationIssue]

class ProjectDocumentationReport(BaseModel):
    total_elements: int
    documented_elements: int
    undocumented_elements: int
    documentation_percentage: float
    issues: list[DocumentationIssue]