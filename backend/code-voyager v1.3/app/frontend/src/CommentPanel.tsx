import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import { useSettings } from './settings';
import type { CommentEntry, CommentTarget } from './commentTypes';
import type { ProjectFileResponse, SaveResult } from './types';

export function CommentPanel({ projectId, file, onApplied, beginApply, endApply }: {
  projectId: string; file: ProjectFileResponse; onApplied: (result: SaveResult) => void;
  beginApply: () => boolean; endApply: () => void;
}) {
  const settings = useSettings();
  const [targets, setTargets] = useState<CommentTarget[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState('');
  const [progress, setProgress] = useState({done: 0, total: 0});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<{content: string; entries: CommentEntry[]} | null>(null);
  const operation = useRef<AbortController | null>(null);
  const keepVersion = useRef('');
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  useEffect(() => {
    operation.current?.abort(); operation.current = null;
    setRunning(false); setCurrent(''); setReviewing(false); setPreview(null); setLoading(true); setError(''); setTargets([]);
    if (keepVersion.current !== file.version) { setDrafts({}); setMessage(''); setProgress({done: 0, total: 0}); }
    keepVersion.current = '';
    const controller = new AbortController();
    api.commentTargets(projectId, file.path, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.version !== file.version) throw new Error(t('Файл изменился. Откройте его заново и повторите генерацию.'));
      setTargets(result.targets);
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [projectId, file.path, file.version]);

  const eligible = targets.filter(item => !item.documented && item.supported);
  const ready = eligible.filter(item => drafts[item.id]?.trim()).map(item => ({id: item.id, text: drafts[item.id]}));
  const queue = eligible.filter(item => !drafts[item.id]?.trim() && (settings.commentVariables || item.type !== 'variable'));
  const disabled = loading || running || reviewing || applying;
  async function generate(selected?: CommentTarget[]) {
    if (disabled || (operation.current && !operation.current.signal.aborted)) return;
    const controller = new AbortController(); operation.current = controller;
    setRunning(true); setError(''); setMessage(''); setProgress({done: 0, total: selected?.length ?? 0});
    const options = {language: settings.commentLanguage, detail: settings.commentDetail, style: settings.commentStyle, model: settings.commentModel};
    try {
      let items = selected;
      if (!items) {
        // Refresh the queue at the moment of the click; do not silently disable
        // the action based on stale targets or whitespace-only drafts.
        const snapshot = await api.commentTargets(projectId, file.path, controller.signal);
        if (controller.signal.aborted) return;
        if (snapshot.version !== file.version) throw new Error(t('Файл изменился. Откройте его заново и повторите генерацию.'));
        setTargets(snapshot.targets);
        const missing = snapshot.targets.filter(item => !item.documented && item.supported);
        const included = missing.filter(item => settings.commentVariables || item.type !== 'variable');
        items = included.filter(item => !drafts[item.id]?.trim());
        if (!items.length) {
          setMessage(t(included.length ? 'Для этих объектов уже есть черновики. Примите их или перегенерируйте отдельно.'
            : missing.length ? 'Остались только переменные. Включите их комментирование в профиле.'
            : 'Нет объектов для автоматического комментирования: они уже документированы или требуют ручной вставки.'));
          return;
        }
        setProgress({done: 0, total: items.length});
      }
      for (let index = 0; index < items.length; index++) {
        if (controller.signal.aborted) return;
        const item = items[index]; setCurrent(item.id);
        const result = await api.generateComment(projectId, file.path, file.version, item.id, options, controller.signal);
        if (controller.signal.aborted) return;
        setDrafts(previous => ({...previous, [item.id]: result.text}));
        setProgress({done: index + 1, total: items.length});
      }
      setMessage(t('Готово. Проверьте и примите нужные комментарии.'));
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) { setRunning(false); setCurrent(''); } } }
  }
  function stop() {
    operation.current?.abort(); operation.current = null; setRunning(false); setCurrent('');
    setMessage(t('Очередь остановлена. Полученные черновики сохранены. Запрос у провайдера может ещё выполняться.'));
  }
  async function review(entries: CommentEntry[]) {
    if (disabled || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setReviewing(true); setError('');
    try {
      const result = await api.previewComments(projectId, file.path, file.version, entries, controller.signal);
      if (!controller.signal.aborted) setPreview({content: result.content, entries});
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setReviewing(false); } }
  }
  async function apply(entries: CommentEntry[]) {
    if (disabled || operation.current || !entries.length) return;
    if (!beginApply()) { setError(t('Дождитесь завершения операции редактора и сохраните правки кода.')); return; }
    const controller = new AbortController(); operation.current = controller;
    setApplying(true); setError('');
    try {
      const result = await api.applyComments(projectId, file.path, file.version, entries);
      keepVersion.current = result.file.version;
      setDrafts(previous => { const next = {...previous}; entries.forEach(entry => delete next[entry.id]); return next; });
      setPreview(null); setMessage(t('Комментарии сохранены. Предыдущая версия доступна в истории.'));
      onApplied(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (operation.current === controller) operation.current = null; endApply(); if (mounted.current) setApplying(false); }
  }
  function discard(id: string) { setDrafts(previous => { const next = {...previous}; delete next[id]; return next; }); }
  return <section className="ai-panel" aria-label={t('Комментирование с AI')}>
    <div className="ai-toolbar">
      <div className="panel-kicker">AI · {settings.commentModel || 'deepseek-v4.1-flash'}</div>
      <button className="primary-btn" disabled={disabled} onClick={() => void generate()}>{t('Комментировать файл')} <small>({queue.length})</small></button>
      <p className="settings-hint">{t('Генерация создаёт черновики. Запись — только после принятия. Черновики доступны до закрытия файла или изменения кода.')}</p>
      {loading && <p role="status">{t('Загрузка…')}</p>}
      {running && <div className="ai-progress" role="status" aria-live="polite"><progress max={progress.total || 1} value={progress.total ? progress.done : undefined} /><span>{progress.total ? `${progress.done} / ${progress.total}` : t('Подготовка очереди…')}</span><button className="ghost-btn" onClick={stop}>{t('Остановить')}</button></div>}
      {ready.length > 0 && <button className="ghost-btn" disabled={disabled} onClick={() => void review(ready.slice(0, 200))}>{t('Просмотреть и принять все')} ({Math.min(ready.length, 200)})</button>}
      {message && <p className="settings-hint" role="status">{message}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
    {targets.map(item => <article className="ai-object" key={item.id}>
      <div className="element-row"><span className={`element-symbol ${item.type}`}>{item.type === 'class' ? 'C' : item.type === 'function' ? 'ƒ' : 'x'}</span><div className="element-main"><strong>{item.name}</strong><small>{item.scope} · {t('Строка')} {item.line}</small></div><span className={`doc-status ${item.documented ? 'ok' : 'bad'}`} title={t(item.documented ? 'Есть документация' : 'Нет документации')}>{item.documented ? '✓' : '!'}</span></div>
      {!item.documented && <div className="ai-object-actions">
        {!item.supported ? <p className="settings-hint">{t('Для этой записи нужна ручная вставка комментария.')}</p> : <>
          {drafts[item.id] !== undefined && <label className="settings-field">{t('Черновик комментария')}<textarea aria-label={`${t('Комментарий')}: ${item.name}`} maxLength={8000} rows={7} value={drafts[item.id]} disabled={disabled} onChange={event => setDrafts(previous => ({...previous, [item.id]: event.target.value}))} /></label>}
          <div className="ai-actions"><button className="ghost-btn" disabled={disabled} onClick={() => void generate([item])}>{t(current === item.id ? 'Генерируем…' : drafts[item.id] !== undefined ? 'Перегенерировать' : 'Сгенерировать комментарий')}</button>
          {drafts[item.id] !== undefined && <><button className="primary-btn" disabled={disabled || !drafts[item.id].trim()} onClick={() => void apply([{id: item.id, text: drafts[item.id]}])}>{t('Принять')}</button><button className="ghost-btn" disabled={disabled} onClick={() => discard(item.id)}>{t('Отменить')}</button></>}</div>
        </>}
      </div>}
    </article>)}
    {!loading && !targets.length && !error && <p className="no-elements">{t('AST не обнаружил классов, функций или переменных.')}</p>}
    {preview && <div className="ai-review-backdrop"><section className="ai-review" role="dialog" aria-modal="true" aria-label={t('Предпросмотр комментариев')} onKeyDown={event => {
      if (event.key === 'Escape' && !applying) { event.preventDefault(); setPreview(null); }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="ai-review-head"><h2>{t('Предпросмотр комментариев')} · {preview.entries.length}</h2><button autoFocus className="ghost-btn" disabled={applying} onClick={() => setPreview(null)}>{t('Назад к черновикам')}</button></div>
      <p className="settings-hint">{t('Будут добавлены только комментарии. Проверьте результат перед сохранением.')}</p>
      <div className="ai-diff"><div><h3>{t('До')}</h3><pre>{file.content}</pre></div><div><h3>{t('После')}</h3><pre>{preview.content}</pre></div></div>
      {error && <p className="settings-error" role="alert">{error}</p>}
      <button className="primary-btn" disabled={applying} onClick={() => void apply(preview.entries)}>{t(applying ? 'Сохраняем…' : 'Сохранить комментарии')}</button>
    </section></div>}
  </section>;
}
