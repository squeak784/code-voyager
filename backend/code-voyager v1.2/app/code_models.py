from pydantic import BaseModel, Field


class ImportInfo(BaseModel):
    name: str
    line: int


class VariableInfo(BaseModel):
    name: str
    line: int
    line_end: int
    scope: str
    has_documentation: bool
    documentation: str | None = None


class FunctionInfo(BaseModel):
    name: str
    line: int
    line_end: int
    arguments: list[str]
    scope: str
    return_annotation: str | None = None
    has_documentation: bool
    documentation: str | None = None


class ClassInfo(BaseModel):
    name: str
    line: int
    line_end: int
    scope: str
    bases: list[str]
    has_documentation: bool
    documentation: str | None = None


class CodeElement(BaseModel):
    """Унифицированное представление элемента для frontend."""

    id: str
    type: str
    name: str
    line: int
    line_end: int
    scope: str
    documented: bool
    documentation: str | None = None


class FileStatistics(BaseModel):
    total: int
    documented: int
    undocumented: int
    documentation_percentage: float


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


class ProjectStructureNode(BaseModel):
    name: str
    path: str
    type: str
    children: list["ProjectStructureNode"] = Field(default_factory=list)


class ProjectStructureResponse(BaseModel):
    project_name: str
    files: list[dict]
    tree: list[ProjectStructureNode]


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


class FileDocumentationReport(BaseModel):
    path: str
    total_elements: int
    documented_elements: int
    undocumented_elements: int
    documentation_percentage: float
    issues: list[DocumentationIssue]


class ProjectDocumentationReport(BaseModel):
    total_elements: int
    documented_elements: int
    undocumented_elements: int
    documentation_percentage: float
    issues: list[DocumentationIssue]
    files: list[FileDocumentationReport]


class FileAnalysisResponse(BaseModel):
    """Удобный формат анализа одного файла для React."""

    file_name: str
    language: str
    statistics: FileStatistics
    elements: list[CodeElement]
    imports: list[ImportInfo]
    functions: list[FunctionInfo]
    classes: list[ClassInfo]
    variables: list[VariableInfo]


class ProjectFileResponse(BaseModel):
    path: str
    language: str | None
    content: str
    analysis: FileAnalysisResponse | None
