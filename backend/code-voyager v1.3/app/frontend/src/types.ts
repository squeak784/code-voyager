export type ElementType = 'function' | 'class' | 'variable';

export interface ImportInfo {
  name: string;
  line: number;
}

export interface VariableInfo {
  name: string;
  line: number;
  scope: string;
  has_documentation: boolean;
  documentation?: string | null;
}

export interface FunctionInfo {
  name: string;
  line: number;
  arguments: string[];
  scope: string;
  return_annotation?: string | null;
  has_documentation: boolean;
  documentation?: string | null;
}

export interface ClassInfo {
  name: string;
  line: number;
  scope: string;
  bases: string[];
  has_documentation: boolean;
  documentation?: string | null;
}

export interface PythonFileAnalysis {
  file_name: string;
  imports: ImportInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  variables: VariableInfo[];
}

export interface ProjectFile {
  error?: string | null;
  path: string;
  analysis: PythonFileAnalysis | null;
}

export interface ProjectAnalysis {
  project_name: string;
  files: ProjectFile[];
}

export interface ProjectUploadResponse {
  project_id: string;
  project: ProjectAnalysis;
}

export interface ProjectFileResponse {
  version: string;
  editable: boolean;
  analysis_error: string | null;
  read_only_reason: string | null;
  path: string;
  content: string;
  analysis: PythonFileAnalysis | null;
}

export interface DocumentationIssue {
  element_type: ElementType;
  name: string;
  line: number;
  scope: string;
  reason: string;
}

export interface FileDocumentationReport {
  path: string;
  total_elements: number;
  documented_elements: number;
  undocumented_elements: number;
  documentation_percentage: number;
  issues: DocumentationIssue[];
}

export interface ProjectDocumentationReport {
  total_elements: number;
  documented_elements: number;
  undocumented_elements: number;
  documentation_percentage: number;
  issues: DocumentationIssue[];
  files: FileDocumentationReport[];
}

export interface ProjectListItem {
  id: string;
  name: string;
  created_at: string;
}

export interface FileRevision { id: string; created_at: string; size: number; }
export interface SaveResult { file: ProjectFileResponse; project: ProjectAnalysis; report: ProjectDocumentationReport; }
