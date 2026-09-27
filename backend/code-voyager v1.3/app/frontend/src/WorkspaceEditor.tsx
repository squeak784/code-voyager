import { confirmAction } from './ConfirmHost';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from './api';
import { CodeEditor } from './CodeEditor';
import { t, locale } from './i18n';
import type { ProjectFileResponse, SaveResult, FileRevision } from './types';

export interface EditorHandle { prepareMap: () => Promise<boolean>; canLeave: () => Promise<boolean>; prepareExport: () => Promise<boolean>; beginCommentApply: () => boolean; endCommentApply: () => void; }
export const WorkspaceEditor = forwardRef<EditorHandle, {
  projectId: string; file: ProjectFileResponse; onSaved: (result: SaveResult) => void; onDirty: (dirty: boolean) => void; revealLine?: number;
}>(function WorkspaceEditor({ projectId, file, onSaved, onDirty, revealLine }, ref) {
  const [draft, setDraft] = useState(file.content);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<FileRevision[] | null>(null);
  const [selected, setSelected] = useState<FileRevision | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const loadedFile = useRef(file);
  const dirty = loadedFile.current === file && draft !== file.content;
  useEffect(() => { loadedFile.current = file; setDraft(file.content); setHistory(null); setSelected(null); setPreview(null); historyRequest.current++; }, [file]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty || busyRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  async function save(): Promise<boolean> {
    if (busyRef.current) return false;
    if (!dirty) return true;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.saveFile(projectId, file.path, draft, file.version);
      onSaved(result); setDraft(result.file.content); setSaved(true); setHistory(null);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('Не удалось сохранить файл')); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  useImperativeHandle(ref, () => ({
    prepareMap: async () => {
      if (busyRef.current) return false;
      return !dirty || (await confirmAction(t('Сохранить изменения перед открытием карты?')) && await save());
    },
    beginCommentApply: () => { if (dirty || busyRef.current) return false; busyRef.current = true; setBusy(true); return true; },
    endCommentApply: () => { busyRef.current = false; setBusy(false); },
    canLeave: async () => !busyRef.current && (!dirty || await confirmAction(t('Есть несохранённые изменения. Покинуть файл без сохранения?'))),
    prepareExport: async () => {
      if (busyRef.current) return false;
      return !dirty || (await confirmAction(t('Сохранить изменения перед экспортом?')) && await save());
    },
  }));
  async function openHistory() {
    if (busyRef.current) return;
    if (history !== null) { historyRequest.current++; setHistory(null); setSelected(null); setPreview(null); return; }
    setError(''); busyRef.current = true; setBusy(true);
    try { setHistory(await api.getHistory(projectId, file.path)); }
    catch (reason) { setError(String(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function selectRevision(revision: FileRevision) {
    const request = ++historyRequest.current;
    setSelected(revision); setPreview(null); setError('');
    try {
      const result = await api.getRevision(projectId, file.path, revision.id);
      if (request === historyRequest.current) setPreview(result.content);
    } catch (reason) { if (request === historyRequest.current) setError(String(reason)); }
  }
  async function restore() {
    if (!selected || busyRef.current) return;
    if (!await confirmAction(t('Восстановить выбранную версию? Текущая сохранённая версия останется в истории. Несохранённый текст будет заменён.'))) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.restoreFile(projectId, file.path, selected.id, file.version);
      onSaved(result); setDraft(result.file.content); setHistory(null); setSelected(null); setPreview(null); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <>
    <div className="editor-toolbar">
      <button className="primary-btn" disabled={!file.editable || !dirty || busy} onClick={() => void save()}>{t(busy ? 'Сохраняем…' : 'Сохранить')} <small>Ctrl+S</small></button>
      <button className="ghost-btn" disabled={busy || !file.editable} onClick={async () => { if (!dirty || await confirmAction(t('Отменить несохранённые изменения?'))) { setDraft(file.content); setSaved(false); } }}>{t('Отменить правки')}</button>
      <button className="ghost-btn" disabled={busy || !file.editable} onClick={() => void openHistory()}>{t(history === null ? 'История версий' : 'Закрыть историю')}</button>
      <span className={dirty ? 'editor-unsaved' : 'editor-saved'} role="status">{t(dirty ? 'Не сохранено' : saved ? 'Сохранено' : 'Сохранённая версия')}</span>
    </div>
    {error && <div className="editor-alert" role="alert">{error}</div>}
    {file.analysis_error && <div className="editor-alert" role="status">{t('Ошибка анализа сохранённого файла')}: {file.analysis_error}</div>}
    {!file.editable ? <div className="empty-code"><strong>{t(file.read_only_reason || 'Файл недоступен для редактирования')}</strong><p>{t('Файл будет включён в ZIP без изменений.')}</p></div> : <>
      {history !== null && <section className="revision-panel" aria-label={t('История версий')}>
        <div className="revision-list"><p>{t('Предыдущие версии — последние 100')}</p>{history.length === 0 && <p>{t('История появится после первого изменения файла.')}</p>}
          {history.map(item => <button key={item.id} className={`ghost-btn ${selected?.id === item.id ? 'revision-selected' : ''}`} onClick={() => void selectRevision(item)}>{new Date(item.created_at).toLocaleString(locale())} · {item.size} B</button>)}
        </div>
        {selected && <div className="revision-preview"><div className="revision-caption">{t('Предпросмотр предыдущей версии')}<button className="ghost-btn" disabled={busy || preview === null} onClick={() => void restore()}>{t('Восстановить')}</button></div>
          {preview !== null ? <CodeEditor value={preview} path={'revision/' + file.path} readOnly /> : <p>{t('Загрузка файла…')}</p>}
        </div>}
      </section>}
      <CodeEditor value={draft} path={file.path} revealLine={revealLine} readOnly={busy} onChange={value => { if (!busyRef.current) { setDraft(value); setSaved(false); } }} onSave={() => void save()} />
    </>}
  </>;
});
