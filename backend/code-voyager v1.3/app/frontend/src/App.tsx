import { WorkspaceEditor, type EditorHandle } from './WorkspaceEditor';
import { RenameProjectDialog } from './RenameProjectDialog';
import { CodeChat } from './CodeChat';
import { WorkspaceDivider, useWorkspaceLayout } from './WorkspaceLayout';
import { ProjectMap } from './ProjectMap';
import { Profile } from './Profile';
import { CommentPanel } from './CommentPanel';
import { useSettings } from './settings';
import { t, locale } from './i18n';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { api, type User } from './api';
import type {
  ClassInfo,
  FunctionInfo,
  ProjectAnalysis,
  ProjectDocumentationReport,
  ProjectFile,
  ProjectFileResponse,
  ProjectListItem,
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
  useSettings();
  const [pageReady, setPageReady] = useState(false);
  const restoredUser = useRef<string | null>(null);
  const workspaceLayout = useWorkspaceLayout();
  const [showProfile, setShowProfile] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [revealLine, setRevealLine] = useState(1);
  const editorRef = useRef<EditorHandle>(null);
  const fileRequest = useRef(0);
  const [dirty, setDirty] = useState(false);
  const [exporting, setExporting] = useState(false);
  async function canLeave() { return editorRef.current ? await editorRef.current.canLeave() : true; }
  async function openProfile() { if (await canLeave()) { setDirty(false); setShowProfile(true); } }
  async function exportProject() {
    if (!projectId || !project || exporting) return;
    if (editorRef.current && !await editorRef.current.prepareExport()) return;
    setExporting(true);
    try { await api.exportProject(projectId, project.project_name); }
    catch (reason) { setError(getErrorMessage(reason, t('Не удалось экспортировать проект'))); }
    finally { setExporting(false); }
  }
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectListItem | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectAnalysis | null>(null);
  const [report, setReport] = useState<ProjectDocumentationReport | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<ProjectFileResponse | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const authCheckStartedRef = useRef(false);

  const showError = useCallback((message: string) => setError(message), []);

  const clearProjectState = useCallback(() => {
    fileRequest.current++;
    setDirty(false);
    localStorage.removeItem('projectId');
    setProjectId(null);
    setShowChat(false);
    setShowMap(false);
    setProject(null);
    setReport(null);
    setSelectedPath(null);
    setFile(null);
    setFilter('');
  }, []);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);

    try {
      const loadedProjects = await api.getProjects();
      setProjects(loadedProjects);
    } catch (requestError) {
      showError(
        getErrorMessage(
          requestError,
          t("Не удалось загрузить список проектов."),
        ),
      );
    } finally {
      setLoadingProjects(false);
    }
  }, [showError]);

  const selectFile = useCallback(
    async (id: string, path: string, line = 1) => {
      if (editorRef.current && !await editorRef.current.canLeave()) return;
      setShowMap(false); setRevealLine(line);
      const request = ++fileRequest.current;
      setDirty(false); setFile(null);
      setSelectedPath(path);
      setLoadingFile(true);
      setError('');

      try {
        const loadedFile = await api.getFile(id, path);
        if (request === fileRequest.current) setFile(loadedFile);
      } catch (requestError) {
        if (request !== fileRequest.current) return;
        setFile(null);
        showError(
          getErrorMessage(requestError, t("Не удалось загрузить файл.")),
        );
      } finally {
        if (request === fileRequest.current) setLoadingFile(false);
      }
    },
    [showError],
  );

  const loadProject = useCallback(
    async (id: string, preferredPath?: string | null) => {
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

        const firstFile = loadedProject.files.find(item => item.path === preferredPath) || loadedProject.files[0];
        if (firstFile) {
          setSelectedPath(firstFile.path);
          await selectFile(id, firstFile.path);
        } else {
          setSelectedPath(null);
          setFile(null);
        }
      } catch (requestError) {
        clearProjectState();
        showError(
          getErrorMessage(requestError, t("Не удалось загрузить проект.")),
        );
      } finally {
        setLoadingProject(false);
      }
    },
    [clearProjectState, selectFile, showError],
  );

  useEffect(() => {
    if (authCheckStartedRef.current) return;
    authCheckStartedRef.current = true;

    async function checkAuth() {
      if (!api.getToken()) {
        setCheckingAuth(false);
        return;
      }

      try {
        const currentUser = await api.getMe();
        setUser(currentUser);
      } catch {
        api.logout();
        clearProjectState();
        setProjects([]);
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    }

    void checkAuth();
  }, [clearProjectState]);

  // После входа или восстановления сессии получаем все проекты пользователя.
  useEffect(() => {
    if (!user) return;
    void loadProjects();
  }, [user, loadProjects]);

  // Restore only after authentication; saved pages are isolated by user and browser tab.
  useEffect(() => {
    if (!user) { restoredUser.current = null; setPageReady(false); return; }
    if (restoredUser.current === user.id) return;
    restoredUser.current = user.id;
    async function restore() {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`code-voyager.page.${user!.id}`) || 'null');
        if (saved && typeof saved === 'object') {
          if (typeof saved.projectId === 'string') await loadProject(saved.projectId, typeof saved.path === 'string' ? saved.path : null);
          setShowProfile(saved.profile === true);
          setShowChat(saved.chat === true);
          setShowMap(saved.map === true);
        }
      } catch { /* Invalid or unavailable storage falls back to the project list. */ }
      finally { setPageReady(true); }
    }
    void restore();
  }, [user, loadProject]);

  useEffect(() => {
    if (!user || !pageReady || loadingProject) return;
    try { sessionStorage.setItem(`code-voyager.page.${user.id}`, JSON.stringify({
      projectId, path:selectedPath, profile:showProfile, chat:showChat, map:showMap,
    })); } catch { /* Navigation remains available without storage. */ }
  }, [user, pageReady, loadingProject, projectId, selectedPath, showProfile, showChat, showMap]);

  async function handleUpload(uploadedFile: File) {
    if (!await canLeave()) return;
    setDirty(false); setFile(null);
    if (!uploadedFile.name.toLowerCase().endsWith('.zip')) {
      showError(t("Загрузите проект в формате ZIP."));
      return;
    }

    setLoadingProject(true);
    setError('');

    try {
      const result = await api.uploadProject(uploadedFile);

      setProjectId(result.project_id);
      setProject(result.project);
      localStorage.setItem('projectId', result.project_id);
      setReport(await api.getDocumentation(result.project_id));

      // Обновляем список, чтобы новый проект сразу появился в БД-списке.
      try {
        const loadedProjects = await api.getProjects();
        setProjects(loadedProjects);
      } catch {
        // Сам проект уже загружен и открыт, поэтому ошибка обновления списка
        // не должна ломать текущий экран.
      }

      const firstFile = result.project.files[0];
      if (firstFile) {
        setSelectedPath(firstFile.path);
        await selectFile(result.project_id, firstFile.path);
      } else {
        setSelectedPath(null);
        setFile(null);
      }
    } catch (requestError) {
      showError(
        getErrorMessage(requestError, t("Не удалось загрузить проект.")),
      );
    } finally {
      setLoadingProject(false);
    }
  }

  async function handleDeleteProject(projectToDelete: ProjectListItem) {
    setDeletingProjectId(projectToDelete.id);
    setError('');

    try {
      await api.deleteProject(projectToDelete.id);

      if (projectId === projectToDelete.id) {
        clearProjectState();
      }

      setProjects((current) =>
        current.filter((item) => item.id !== projectToDelete.id),
      );
      setProjectToDelete(null);
    } catch (requestError) {
      showError(
        getErrorMessage(
          requestError,
          t("Не удалось удалить проект."),
        ),
      );
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function handleLogout() {
    if (!await canLeave()) return;
    try { sessionStorage.removeItem(`code-voyager.page.${user?.id}`); } catch { /* Storage may be unavailable. */ }
    setPageReady(false);
    setShowProfile(false);
    api.logout();
    clearProjectState();
    setProjects([]);
    setUser(null);
    setError('');
  }

  async function resetProject() {
    if (!await canLeave()) return;
    clearProjectState();
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

  if (checkingAuth || (user && !pageReady)) {
    return <LoadingScreen text={t("Проверяем сессию…")} />;
  }

  if (!user) {
    return <AuthScreen onLogin={setUser} />;
  }

  if (showProfile) {
    return <div className="app-shell">
      <Header projectName={project?.project_name || null} user={user} onLogout={handleLogout} onProfile={openProfile} />
      <Profile user={user} onBack={() => setShowProfile(false)} />
    </div>;
  }

  if (!project) {
    return (
      <div className="app-shell">
        <Header
          projectName={null}
          user={user}
          onLogout={handleLogout}
          onProfile={openProfile}
        />

        <ProjectList
          projects={projects}
            onRenamed={(updated) => setProjects(items => items.map(item => item.id === updated.id ? updated : item))}
          loading={loadingProjects}
          deletingProjectId={deletingProjectId}
          onSelect={(id) => void loadProject(id)}
          onDelete={(project) => setProjectToDelete(project)}
          onUpload={() => inputRef.current?.click()}
          username={user.username}
        />

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

        {projectToDelete && (
          <DeleteProjectModal
            project={projectToDelete}
            loading={deletingProjectId === projectToDelete.id}
            onCancel={() => {
              if (deletingProjectId) return;
              setProjectToDelete(null);
            }}
            onConfirm={() => void handleDeleteProject(projectToDelete)}
          />
        )}

        {error && <Toast message={error} onClose={() => setError('')} />}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header
        projectName={project.project_name}
        user={user}
        onMyProjects={resetProject}
        onLogout={handleLogout}
          onProfile={openProfile}
      />

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

      {showMap && projectId && <ProjectMap projectId={projectId} onClose={() => setShowMap(false)} onOpen={(path, line) => void selectFile(projectId, path, line)} />}
      <main className="workspace resizable-workspace" ref={workspaceLayout.ref} style={workspaceLayout.style}>
        <aside className="sidebar panel" id="workspace-files">
          <div className="panel-title">
            <span>{t("Файлы проекта")}</span>
            <b>{project.files.length}</b>
          </div>

          <button className="map-open-btn" onClick={async () => { if (!editorRef.current || await editorRef.current.prepareMap()) setShowMap(true); }} disabled={loadingProject || loadingFile}>{t('Карта проекта')}</button>
          <button className="map-open-btn" onClick={() => setShowChat(value => !value)} aria-pressed={showChat}>{t('Чат по коду')}</button>
          <div className="file-search">
            <span>⌕</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("Поиск файла...")}
              aria-label={t("Поиск файла")}
            />
          </div>

          <div className="file-list">
            {visibleFiles.length === 0 ? (
              <div className="no-files">{t("Ничего не найдено")}</div>
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

          <button
            className="upload-btn"
            onClick={() => inputRef.current?.click()}
            disabled={loadingProject}
          >{t("＋ Загрузить другой ZIP")}</button>
          <button className="upload-btn" disabled={exporting || loadingProject || loadingFile} onClick={() => void exportProject()}>{t(exporting ? 'Подготовка ZIP…' : 'Экспорт проекта ZIP')}</button>
        </aside>

        <WorkspaceDivider side="left" layout={workspaceLayout} />
        <section className="code-panel" id="workspace-code">
          <div className="code-header">
            <div className="code-title-wrap">
              <div className="breadcrumb">PROJECT / {selectedPath || '—'}</div>
              <h1>{selectedPath ? getFileName(selectedPath) : t("Файл не выбран")}</h1>
            </div>
            {selectedPath && (
              <span className="language-badge">
                {getExtension(selectedPath).toUpperCase() || 'FILE'}
              </span>
            )}
          </div>

          {loadingFile ? (
            <div className="code-loading">{t("Загрузка файла…")}</div>
          ) : (
            file && projectId ? <WorkspaceEditor key={`${projectId}:${file.path}`} ref={editorRef} projectId={projectId} file={file} revealLine={revealLine} onDirty={setDirty}
              onSaved={result => { setFile(result.file); setProject(result.project); setReport(result.report); setDirty(false); }} /> : <div className="empty-code">{t('Файл не выбран')}</div>
          )}
        </section>

        <WorkspaceDivider side="right" layout={workspaceLayout} />
        <aside id="workspace-inspector" className={`inspector panel${showChat ? ' inspector-chat' : ''}`}>
          {projectId && <CodeChat key={projectId} projectId={projectId} path={selectedPath} dirty={dirty}
            visible={showChat} onClose={() => setShowChat(false)} onOpen={(path, line) => void selectFile(projectId, path, line)} />}
          {!showChat && <>{dirty ? <div className="empty-inspector">{t('Сохраните файл, чтобы обновить анализ.')}</div> : file?.analysis_error ? <div className="empty-inspector">{t('Исправьте синтаксис и сохраните файл для анализа.')}</div> : <Inspector
            analysis={file?.analysis || null}
            report={report}
            path={selectedPath}
          >{file?.analysis && projectId && <CommentPanel key={`${projectId}:${file.path}`} projectId={projectId} file={file}
            beginApply={() => editorRef.current?.beginCommentApply() ?? false}
            endApply={() => editorRef.current?.endCommentApply()}
            onApplied={result => { setFile(result.file); setProject(result.project); setReport(result.report); setDirty(false); }} />}</Inspector>}</>}
        </aside>
      </main>

      {stats && !dirty && (
        <footer className="statusbar">
          <Stat label={t("Документировано")} value={stats.total === 0 && project.files.some(item => item.error) ? "—" : `${stats.percent}%`} tone="good" />
          <Stat label={t("Элементов")} value={stats.total} />
          <Stat label={t("Есть документация")} value={stats.documented} />
          <Stat label={t("Нужна документация")} value={stats.missing} tone="danger" />
          {project.files.some(item => item.error) && <span className="editor-unsaved">{t('Анализ неполный: есть файлы с ошибками')}</span>}
          <span className="status-spacer" />
          {loadingProject && <span className="loading-label">{t("Обновление…")}</span>}
        </footer>
      )}

      {projectToDelete && (
        <DeleteProjectModal
          project={projectToDelete}
          loading={deletingProjectId === projectToDelete.id}
          onCancel={() => {
            if (deletingProjectId) return;
            setProjectToDelete(null);
          }}
          onConfirm={() => void handleDeleteProject(projectToDelete)}
        />
      )}

      {error && <Toast message={error} onClose={() => setError('')} />}
    </div>
  );
}

function DeleteProjectModal({
  project,
  loading,
  onCancel,
  onConfirm,
}: {
  project: ProjectListItem;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, onCancel]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'var(--palette-167)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        style={{
          width: 'min(460px, 100%)',
          border: '1px solid var(--palette-168)',
          borderRadius: '24px',
          padding: '28px',
          background:
            'linear-gradient(145deg, var(--palette-169), var(--palette-170))',
          boxShadow: '0 30px 100px var(--palette-171)',
        }}
      >
        <div
          style={{
            width: '46px',
            height: '46px',
            display: 'grid',
            placeItems: 'center',
            marginBottom: '18px',
            borderRadius: '14px',
            border: '1px solid var(--palette-172)',
            background: 'var(--palette-173)',
            color: 'var(--palette-174)',
            fontSize: '22px',
            fontWeight: 700,
          }}
        >
          !
        </div>

        <div
          style={{
            fontSize: '11px',
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            opacity: 0.48,
            marginBottom: '7px',
          }}
        >{t("Удаление проекта")}</div>

        <h2
          id="delete-project-title"
          style={{
            margin: 0,
            fontSize: '26px',
            lineHeight: 1.2,
          }}
        >{t("Удалить проект?")}</h2>

        <p
          style={{
            margin: '14px 0 0',
            lineHeight: 1.6,
            opacity: 0.72,
          }}
        >{t("Проект")}{' '}
          <strong style={{ opacity: 1 }}>{project.name}</strong>{' '}
          {t("будет удалён вместе с сохранёнными файлами. Это действие нельзя отменить.")}
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '26px',
          }}
        >
          <button
            type="button"
            className="ghost-btn"
            onClick={onCancel}
            disabled={loading}
          >{t("Отмена")}</button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              minHeight: '42px',
              padding: '0 18px',
              border: '1px solid var(--palette-175)',
              borderRadius: '12px',
              background: loading
                ? 'var(--palette-173)'
                : 'var(--palette-176)',
              color: 'var(--palette-165)',
              font: 'inherit',
              fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? t("Удаляем…") : t("Удалить проект")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="auth-shell">
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />
      <div className="auth-loading">
        <div className="brand-mark auth-loading-mark">⌁</div>
        <div className="auth-kicker">CODE ANALYSIS PLATFORM</div>
        <div className="auth-loading-text">{text}</div>
        <div className="auth-spinner" />
      </div>
    </div>
  );
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function switchMode(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result =
        mode === 'login'
          ? await api.login({ username: username.trim(), password })
          : await api.register({
              username: username.trim(),
              email: email.trim(),
              password,
            });

      api.saveToken(result.access_token);
      onLogin(result.user);
    } catch (requestError) {
      setError(
        getErrorMessage(requestError, t("Не удалось выполнить запрос.")),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-grid" />
      <div className="auth-orbit auth-orbit-one" />
      <div className="auth-orbit auth-orbit-two" />

      <main className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark auth-brand-mark">⌁</div>
          <div>
            <strong>Code Voyager</strong>
            <span>{t("Автодокументация кода")}</span>
          </div>
        </div>

        <div className="auth-intro">
          <div className="auth-kicker">CODE ANALYSIS PLATFORM</div>
          <h1>{mode === 'login' ? t("С возвращением.") : t("Создайте аккаунт.")}</h1>
          <p>
            {mode === 'login'
              ? t("Войдите, чтобы продолжить работу со своими проектами.")
              : t("Сохраните проекты и результаты анализа в своём аккаунте.")}
          </p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label={t("Авторизация")}>
          <button
            type="button"
            className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchMode('login')}
            role="tab"
            aria-selected={mode === 'login'}
          >{t("Войти")}</button>
          <button
            type="button"
            className={mode === 'register' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchMode('register')}
            role="tab"
            aria-selected={mode === 'register'}
          >{t("Регистрация")}</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>{t("Имя пользователя")}</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              maxLength={50}
              autoComplete="username"
              placeholder={t("Введите имя пользователя")}
              required
              disabled={loading}
            />
          </label>

          {mode === 'register' && (
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </label>
          )}

          <label className="auth-field">
            <span>{t("Пароль")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={t("Не менее 6 символов")}
              required
              disabled={loading}
            />
          </label>

          {error && (
            <div className="auth-error" role="alert">
              <span className="auth-error-dot">!</span>
              <span>{error}</span>
            </div>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            <span>
              {loading
                ? mode === 'login'
                  ? t("Проверяем данные…")
                  : t("Создаём аккаунт…")
                : mode === 'login'
                  ? t("Войти в Code Voyager")
                  : t("Создать аккаунт")}
            </span>
            {!loading && <span className="auth-submit-arrow">→</span>}
          </button>
        </form>

        <div className="auth-footer">
          <span>{mode === 'login' ? t("Нет аккаунта?") : t("Уже есть аккаунт?")}</span>
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t("Зарегистрироваться") : t("Войти")}
          </button>
        </div>

        <div className="auth-features">
          <span>{t("AST-анализ")}</span>
          <span>{t("Проекты пользователя")}</span>
          <span>{t("Документация")}</span>
        </div>
      </main>
    </div>
  );
}

function Header({
  projectName,
  user,
  onMyProjects,
  onProfile,
  onLogout,
}: {
  projectName: string | null;
  user: User;
  onMyProjects?: () => void;
  onProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">⌁</div>
        <div>
          <strong>Code Voyager</strong>
          <span>{t("Автодокументация кода")}</span>
        </div>
      </div>

      {projectName && (
        <div className="top-project" title={projectName}>
          <span className="top-project-dot" />
          {projectName}
        </div>
      )}

      <div className="topbar-actions">
        <button className="ghost-btn" onClick={onProfile} type="button">{t("Профиль")}</button>
        <div className="user-chip" title={user.email}>
          <div className="user-avatar">{getInitials(user.username)}</div>
          <div className="user-meta">
            <strong>{user.username}</strong>
            <span>{t("Аккаунт")}</span>
          </div>
        </div>

        {onMyProjects && (
          <button
            className="ghost-btn"
            onClick={onMyProjects}
            type="button"
          >{t("Мои проекты")}</button>
        )}

        <button
          className="ghost-btn ghost-btn-danger"
          onClick={onLogout}
          type="button"
        >{t("Выйти")}</button>
      </div>
    </header>
  );
}

function getInitials(username: string): string {
  const normalized = username.trim();
  if (!normalized) return '?';
  const parts = normalized.split(/[\s_-]+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return normalized.slice(0, 2).toUpperCase();
}

function ProjectList({
  onRenamed,
  projects,
  loading,
  deletingProjectId,
  onSelect,
  onDelete,
  onUpload,
  username,
}: {
  onRenamed: (project: ProjectListItem) => void;
  projects: ProjectListItem[];
  loading: boolean;
  deletingProjectId: string | null;
  onSelect: (id: string) => void;
  onDelete: (project: ProjectListItem) => void;
  onUpload: () => void;
  username: string;
}) {
  const [renaming, setRenaming] = useState<ProjectListItem | null>(null);
  return (
    <main
      className="projects-page"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '48px 40px 56px',
      }}
    >
      <div
        className="projects-container"
        style={{
          width: 'min(1180px, 100%)',
          margin: '0 auto',
        }}
      >
        <div
          className="projects-heading"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '28px',
            marginBottom: '34px',
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: '10px' }}>
              WORKSPACE
            </p>
            <h1 style={{ margin: 0, fontSize: 'clamp(32px, 4vw, 52px)' }}>{t("Мои проекты")}</h1>
            <p
              style={{
                margin: '12px 0 0',
                maxWidth: '650px',
                opacity: 0.72,
                lineHeight: 1.6,
              }}
            >{t("Добро пожаловать,")}{' '}<strong>{username}</strong>{t(". Здесь находятся сохранённые проекты и результаты анализа.")}</p>
          </div>

          <button
            className="primary-btn"
            onClick={onUpload}
            type="button"
            disabled={loading}
            style={{ flexShrink: 0 }}
          >{t("＋ Новый проект")}</button>
        </div>

        {loading ? (
          <div
            style={{
              minHeight: '320px',
              display: 'grid',
              placeItems: 'center',
              border: '1px solid var(--palette-177)',
              borderRadius: '24px',
              background: 'var(--palette-178)',
              opacity: 0.8,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div className="auth-spinner" style={{ margin: '0 auto 18px' }} />
              <strong>{t("Загружаем ваши проекты…")}</strong>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div
            style={{
              minHeight: '360px',
              display: 'grid',
              placeItems: 'center',
              padding: '50px 24px',
              textAlign: 'center',
              border: '1px dashed var(--palette-179)',
              borderRadius: '28px',
              background:
                'radial-gradient(circle at 50% 0%, var(--palette-180), transparent 45%), var(--palette-181)',
            }}
          >
            <div>
              <div
                className="hero-icon"
                style={{ margin: '0 auto 18px' }}
              >
                ⌁
              </div>
              <h2 style={{ margin: '0 0 10px', fontSize: '28px' }}>{t("Пока здесь пусто")}</h2>
              <p
                style={{
                  margin: '0 auto 24px',
                  maxWidth: '520px',
                  lineHeight: 1.6,
                  opacity: 0.68,
                }}
              >{t("Загрузите ZIP-архив проекта. После анализа он сохранится в вашем аккаунте и появится здесь.")}</p>
              <button className="primary-btn" onClick={onUpload} type="button">{t("Загрузить ZIP-проект")}<span>→</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            className="projects-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '18px',
            }}
          >
            {projects.map((item) => {
              const isDeleting = deletingProjectId === item.id;

              return (
                <div
                  className="project-card"
                  key={item.id}
                  style={{
                    position: 'relative',
                    minHeight: '178px',
                    border: '1px solid var(--palette-182)',
                    borderRadius: '22px',
                    overflow: 'hidden',
                    background:
                      'linear-gradient(145deg, var(--palette-183), var(--palette-184))',
                    transition:
                      'transform .18s ease, border-color .18s ease, background .18s ease',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.transform = 'translateY(-3px)';
                    event.currentTarget.style.borderColor =
                      'var(--palette-185)';
                    event.currentTarget.style.background =
                      'linear-gradient(145deg, var(--palette-186), var(--palette-178))';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.transform = 'translateY(0)';
                    event.currentTarget.style.borderColor =
                      'var(--palette-182)';
                    event.currentTarget.style.background =
                      'linear-gradient(145deg, var(--palette-183), var(--palette-184))';
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    disabled={isDeleting}
                    aria-label={`${t('Открыть проект')} ${item.name}`}
                    style={{
                      appearance: 'none',
                      width: '100%',
                      minHeight: '178px',
                      padding: '22px 60px 22px 22px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '16px',
                      textAlign: 'left',
                      cursor: isDeleting ? 'wait' : 'pointer',
                      border: 0,
                      color: 'inherit',
                      background: 'transparent',
                      opacity: isDeleting ? 0.55 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        flex: '0 0 48px',
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '14px',
                        background: 'var(--palette-187)',
                        border: '1px solid var(--palette-188)',
                        fontSize: '22px',
                      }}
                    >
                      ⌁
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '17px',
                          lineHeight: 1.35,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.name}
                      >
                        {item.name}
                      </strong>

                      <span
                        style={{
                          display: 'block',
                          marginTop: '9px',
                          fontSize: '13px',
                          opacity: 0.58,
                        }}
                      >{t("Создан")}{' '}
                        {new Date(item.created_at).toLocaleDateString(locale())}
                      </span>

                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: '28px',
                          fontSize: '12px',
                          letterSpacing: '.08em',
                          textTransform: 'uppercase',
                          opacity: 0.48,
                        }}
                      >
                        {isDeleting ? t("Удаление…") : t("Открыть проект")}
                      </span>
                    </div>

                    <span
                      aria-hidden="true"
                      style={{
                        marginLeft: 'auto',
                        fontSize: '20px',
                        opacity: 0.55,
                      }}
                    >
                    </span>
                  </button>

                  <button type="button" className="project-rename-btn" disabled={isDeleting}
                    onClick={() => setRenaming(item)}
                    aria-label={`${t('Переименовать проект')} ${item.name}`} title={t('Переименовать проект')}>✎</button>
                  <button
                    type="button"
                    className="project-delete-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDelete(item);
                    }}
                    disabled={isDeleting}
                    aria-label={`${t('Удалить проект')} ${item.name}`}
                    title={t("Удалить проект")}
                    style={{
                      position: 'absolute',
                      top: '16px',
                      right: '16px',
                      width: '34px',
                      height: '34px',
                      display: 'grid',
                      placeItems: 'center',
                      padding: 0,
                      borderRadius: '10px',
                      border: '1px solid var(--palette-177)',
                      background: 'var(--palette-189)',
                      color: 'var(--palette-190)',
                      cursor: isDeleting ? 'wait' : 'pointer',
                      fontSize: '15px',
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)}
        onSaved={updated => { onRenamed(updated); setRenaming(null); }} />}
    </main>
  );
}

function FileRow({
  file,
  selected,
  onClick,
}: {
  file: ProjectFile;
  selected: boolean;
  onClick: () => void;
}) {
  const extension = getExtension(file.path);
  const count = file.analysis
    ? file.analysis.functions.length +
      file.analysis.classes.length +
      file.analysis.variables.length
    : 0;

  return (
    <button
      className={`file-row ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title={file.path}
      type="button"
    >
      <span className={`file-icon ext-${extension}`}>
        {FILE_ICONS[extension] || '·'}
      </span>
      <span className="file-name">{file.path}</span>
      <span className={`file-state ${count === 0 ? 'empty' : ''}`}>
        {count || '—'}
      </span>
    </button>
  );
}

function Inspector({
  analysis,
  report,
  path,
  children,
}: {
  analysis: ProjectFileResponse['analysis'];
  report: ProjectDocumentationReport | null;
  path: string | null;
  children?: ReactNode;
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
  const percent = Math.max(
    0,
    Math.min(100, fileReport?.documentation_percentage ?? 100),
  );
  const ringStyle = { '--progress': `${percent * 3.6}deg` } as CSSProperties;

  if (!analysis) {
    return (
      <div className="empty-inspector">
        <div className="empty-symbol">⌁</div>
        <p>{t("Выберите Python-файл")}</p>
        <small>{t("Здесь появится структура, импорты и состояние документации.")}</small>
      </div>
    );
  }

  return (
    <div className="inspector-inner">
      <div className="inspector-head">
        <div>
          <div className="panel-kicker">FILE ANALYSIS</div>
          <h2>{t("Структура")}</h2>
        </div>
        <div
          className="ring"
          style={ringStyle}
          aria-label={`${t('Документация')} ${Math.round(percent)}%`}
        >
          <b>{Math.round(percent)}%</b>
        </div>
      </div>

      {children || <div className="element-list">
        {items.length === 0 ? (
          <div className="no-elements">{t("AST не обнаружил классов, функций или переменных.")}</div>
        ) : (
          items.map((item, index) => (
            <ElementRow
              key={`${item.type}-${item.name}-${item.line}-${index}`}
              item={item}
            />
          ))
        )}
      </div>}

      {analysis.imports.length > 0 && (
        <div className="imports">
          <div className="section-label">{t("ИМПОРТЫ")}<span>{analysis.imports.length}</span>
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
  const label =
    item.type === 'class'
      ? t("КЛАСС")
      : item.type === 'function'
        ? t("ФУНКЦИЯ")
        : t("ПЕРЕМЕННАЯ");
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
        {item.type === 'class' &&
          item.bases.length > 0 && <small>extends {item.bases.join(', ')}</small>}
        {item.type === 'variable' && <small>{item.scope}</small>}
      </div>
      <span
        className={`doc-status ${item.has_documentation ? 'ok' : 'bad'}`}
        title={item.has_documentation ? t("Есть документация") : t("Нет документации")}
      >
        {item.has_documentation ? '✓' : '!'}
      </span>
      <span className="element-line">{item.line}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'danger';
}) {
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
      <span className="toast-mark">!</span>
      <span>{message}</span>
      <button onClick={onClose} aria-label={t("Закрыть сообщение")} type="button">
        ×
      </button>
    </div>
  );
}

export default App;
