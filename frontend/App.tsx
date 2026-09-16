import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from './api';
import type {
  ClassInfo,
  FunctionInfo,
  ProjectAnalysis,
  ProjectDocumentationReport,
  ProjectFile,
  ProjectFileResponse,
  VariableInfo,
} from './types';

type ElementItem =
  | (ClassInfo & { type: 'class' })
  | (FunctionInfo & { type: 'function' })
  | (VariableInfo & { type: 'variable' });

const FILE_ICONS: Record<string, string> = {
  py: 'PY',
  js: 'JS',
  jsx: 'JS',
  ts: 'TS',
  tsx: 'TS',
  json: '{}',
  md: 'MD',
  css: '#',
  html: '<>',
};

function getExtension(path: string): string {
  const name = path.split('/').pop() || path;
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function App() {
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem('projectId'));
  const [project, setProject] = useState<ProjectAnalysis | null>(null);
  const [report, setReport] = useState<ProjectDocumentationReport | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<ProjectFileResponse | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((message: string) => setError(message), []);

  const selectFile = useCallback(async (id: string, path: string) => {
    setSelectedPath(path);
    setLoadingFile(true);
    setError('');

    try {
      const result = await api.getFile(id, path);
      setFile(result);
    } catch (error) {
      setFile(null);
      showError(getErrorMessage(error, 'Не удалось загрузить файл.'));
    } finally {
      setLoadingFile(false);
    }
  }, [showError]);

  const loadProject = useCallback(async (id: string) => {
    setLoadingProject(true);
    setError('');

    try {
      const [loadedProject, loadedReport] = await Promise.all([
        api.getProject(id),
        api.getDocumentation(id),
      ]);

      setProjectId(id);
      setProject(loadedProject);
      setReport(loadedReport);
      localStorage.setItem('projectId', id);

      const firstFile = loadedProject.files[0];
      if (firstFile) {
        setSelectedPath(firstFile.path);
        setLoadingFile(true);
        try {
          setFile(await api.getFile(id, firstFile.path));
        } finally {
          setLoadingFile(false);
        }
      } else {
        setSelectedPath(null);
        setFile(null);
      }
    } catch (error) {
      localStorage.removeItem('projectId');
      setProjectId(null);
      setProject(null);
      setReport(null);
      setSelectedPath(null);
      setFile(null);
      showError(getErrorMessage(error, 'Не удалось загрузить проект.'));
    } finally {
      setLoadingProject(false);
    }
  }, [showError]);

  useEffect(() => {
    if (projectId) {
      void loadProject(projectId);
    }
  }, [projectId, loadProject]);

  async function handleUpload(uploadedFile: File) {
    if (!uploadedFile.name.toLowerCase().endsWith('.zip')) {
      showError('Загрузите проект в формате ZIP.');
      return;
    }

    setLoadingProject(true);
    setError('');

    try {
      const result = await api.uploadProject(uploadedFile);
      localStorage.setItem('projectId', result.project_id);
      setProjectId(result.project_id);
      setProject(result.project);
      setReport(await api.getDocumentation(result.project_id));

      const firstFile = result.project.files[0];
      if (firstFile) {
        await selectFile(result.project_id, firstFile.path);
      } else {
        setSelectedPath(null);
        setFile(null);
      }
    } catch (error) {
      showError(getErrorMessage(error, 'Не удалось загрузить проект.'));
    } finally {
      setLoadingProject(false);
    }
  }

  function resetProject() {
    localStorage.removeItem('projectId');
    setProjectId(null);
    setProject(null);
    setReport(null);
    setSelectedPath(null);
    setFile(null);
    setFilter('');
    setError('');
  }

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!project || !query) return project?.files || [];
    return project.files.filter((item) => item.path.toLowerCase().includes(query));
  }, [project, filter]);

  const stats = report
    ? {
        total: report.total_elements,
        documented: report.documented_elements,
        missing: report.undocumented_elements,
        percent: Math.round(report.documentation_percentage),
      }
    : null;

  if (!project) {
    return (
      <div className="app-shell">
        <Header projectName={null} onNewProject={resetProject} />
        <Welcome onUpload={() => inputRef.current?.click()} loading={loadingProject} />
        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) void handleUpload(selected);
          }}
        />
        {error && <Toast message={error} onClose={() => setError('')} />}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header projectName={project.project_name} onNewProject={resetProject} />

      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept=".zip,application/zip"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = '';
          if (selected) void handleUpload(selected);
        }}
      />

      <main className="workspace">
        <aside className="sidebar panel">
          <div className="panel-title">
            <span>Файлы проекта</span>
            <b>{project.files.length}</b>
          </div>

          <div className="file-search">
            <span>⌕</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Поиск файла..."
              aria-label="Поиск файла"
            />
          </div>

          <div className="file-list">
            {visibleFiles.length === 0 ? (
              <div className="no-files">Ничего не найдено</div>
            ) : (
              visibleFiles.map((item) => (
                <FileRow
                  key={item.path}
                  file={item}
                  selected={selectedPath === item.path}
                  onClick={() => void selectFile(projectId!, item.path)}
                />
              ))
            )}
          </div>

          <button className="upload-btn" onClick={() => inputRef.current?.click()} disabled={loadingProject}>
            ＋ Загрузить другой ZIP
          </button>
        </aside>

        <section className="code-panel">
          <div className="code-header">
            <div className="code-title-wrap">
              <div className="breadcrumb">PROJECT / {selectedPath || '—'}</div>
              <h1>{selectedPath ? getFileName(selectedPath) : 'Файл не выбран'}</h1>
            </div>
            {selectedPath && <span className="language-badge">{getExtension(selectedPath).toUpperCase() || 'FILE'}</span>}
          </div>

          {loadingFile ? (
            <div className="code-loading">Загрузка файла…</div>
          ) : (
            <CodeViewer content={file?.content || ''} />
          )}
        </section>

        <aside className="inspector panel">
          <Inspector analysis={file?.analysis || null} report={report} path={selectedPath} />
        </aside>
      </main>

      {stats && (
        <footer className="statusbar">
          <Stat label="Документировано" value={`${stats.percent}%`} tone="good" />
          <Stat label="Элементов" value={stats.total} />
          <Stat label="Есть документация" value={stats.documented} />
          <Stat label="Нужна документация" value={stats.missing} tone="danger" />
          <span className="status-spacer" />
          {loadingProject && <span className="loading-label">Обновление…</span>}
        </footer>
      )}

      {error && <Toast message={error} onClose={() => setError('')} />}
    </div>
  );
}

function Header({ projectName, onNewProject }: { projectName: string | null; onNewProject: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">⌁</div>
        <div>
          <strong>Code Voyager</strong>
          <span>Автодокументация кода</span>
        </div>
      </div>
      {projectName && <div className="top-project" title={projectName}>{projectName}</div>}
      <button className="ghost-btn" onClick={onNewProject}>
        Новый проект
      </button>
    </header>
  );
}

function Welcome({ onUpload, loading }: { onUpload: () => void; loading: boolean }) {
  return (
    <main className="welcome">
      <div className="hero-glow" />
      <div className="hero-icon">⌁</div>
      <p className="eyebrow">CODE ANALYSIS PLATFORM</p>
      <h1>
        Понимай код.<br />
        <em>Документируй автоматически.</em>
      </h1>
      <p className="hero-copy">
        Загрузите Python-проект, чтобы увидеть структуру файлов, найти недокументированные элементы и разобраться в коде.
      </p>
      <button className="primary-btn" onClick={onUpload} disabled={loading}>
        {loading ? 'Анализируем…' : 'Загрузить ZIP-проект'} <span>→</span>
      </button>
      <div className="feature-row">
        <span>AST-анализ</span>
        <span>Структура проекта</span>
        <span>Документация</span>
        <span>AI-ready</span>
      </div>
    </main>
  );
}

function FileRow({ file, selected, onClick }: { file: ProjectFile; selected: boolean; onClick: () => void }) {
  const extension = getExtension(file.path);
  const count = file.analysis
    ? file.analysis.functions.length + file.analysis.classes.length + file.analysis.variables.length
    : 0;

  return (
    <button className={`file-row ${selected ? 'selected' : ''}`} onClick={onClick} title={file.path}>
      <span className={`file-icon ext-${extension}`}>{FILE_ICONS[extension] || '·'}</span>
      <span className="file-name">{file.path}</span>
      <span className={`file-state ${count === 0 ? 'empty' : ''}`}>{count || '—'}</span>
    </button>
  );
}

function CodeViewer({ content }: { content: string }) {
  if (!content) {
    return (
      <div className="empty-code">
        <div className="empty-code-icon">⌁</div>
        <strong>Файл пуст или недоступен</strong>
        <span>Выберите другой файл проекта.</span>
      </div>
    );
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n');

  return (
    <div className="code-scroll">
      <div className="code-table">
        {lines.map((line, index) => (
          <div className="code-line" key={index}>
            <span className="line-number">{index + 1}</span>
            <code>{line || ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function Inspector({
  analysis,
  report,
  path,
}: {
  analysis: ProjectFileResponse['analysis'];
  report: ProjectDocumentationReport | null;
  path: string | null;
}) {
  const items = useMemo<ElementItem[]>(() => {
    if (!analysis) return [];

    return [
      ...analysis.classes.map((item) => ({ ...item, type: 'class' as const })),
      ...analysis.functions.map((item) => ({ ...item, type: 'function' as const })),
      ...analysis.variables.map((item) => ({ ...item, type: 'variable' as const })),
    ].sort((a, b) => a.line - b.line);
  }, [analysis]);

  const fileReport = report?.files.find((item) => item.path === path);
  const percent = Math.max(0, Math.min(100, fileReport?.documentation_percentage ?? 100));
  const ringStyle = { '--progress': `${percent * 3.6}deg` } as CSSProperties;

  if (!analysis) {
    return (
      <div className="empty-inspector">
        <div className="empty-symbol">⌁</div>
        <p>Выберите Python-файл</p>
        <small>Здесь появится структура, импорты и состояние документации.</small>
      </div>
    );
  }

  return (
    <div className="inspector-inner">
      <div className="inspector-head">
        <div>
          <div className="panel-kicker">FILE ANALYSIS</div>
          <h2>Структура</h2>
        </div>
        <div className="ring" style={ringStyle} aria-label={`Документация ${Math.round(percent)} процентов`}>
          <b>{Math.round(percent)}%</b>
        </div>
      </div>

      <div className="element-list">
        {items.length === 0 ? (
          <div className="no-elements">AST не обнаружил классов, функций или переменных.</div>
        ) : (
          items.map((item, index) => (
            <ElementRow key={`${item.type}-${item.name}-${item.line}-${index}`} item={item} />
          ))
        )}
      </div>

      {analysis.imports.length > 0 && (
        <div className="imports">
          <div className="section-label">
            ИМПОРТЫ <span>{analysis.imports.length}</span>
          </div>
          {analysis.imports.map((item, index) => (
            <div className="import-row" key={`${item.name}-${item.line}-${index}`}>
              <span>↳</span>
              <span className="import-name">{item.name}</span>
              <small>{item.line}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ElementRow({ item }: { item: ElementItem }) {
  const label = item.type === 'class' ? 'КЛАСС' : item.type === 'function' ? 'ФУНКЦИЯ' : 'ПЕРЕМЕННАЯ';
  const symbol = item.type === 'class' ? 'C' : item.type === 'function' ? 'ƒ' : 'x';

  return (
    <div className="element-row">
      <span className={`element-symbol ${item.type}`}>{symbol}</span>
      <div className="element-main">
        <div className="element-name-line">
          <strong>{item.name}</strong>
          <span className="element-type">{label}</span>
        </div>
        {item.type === 'function' && <small>({item.arguments.join(', ')})</small>}
        {item.type === 'class' && item.bases.length > 0 && <small>extends {item.bases.join(', ')}</small>}
        {item.type === 'variable' && <small>{item.scope}</small>}
      </div>
      <span className={`doc-status ${item.has_documentation ? 'ok' : 'bad'}`} title={item.has_documentation ? 'Есть документация' : 'Нет документации'}>
        {item.has_documentation ? '✓' : '!'}
      </span>
      <span className="element-line">{item.line}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'danger' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone || ''}>{value}</strong>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="toast error" role="alert">
      <span>{message}</span>
      <button onClick={onClose} aria-label="Закрыть сообщение">×</button>
    </div>
  );
}

export default App;
