import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import { getSettings, useSettings } from './settings';
import { confirmAction } from './ConfirmHost';
import type { ChatTurn, IndexStatus, ChatSource } from './chatTypes';
import './codeChat.css';

function Answer({text, sources, onOpen}: {text: string; sources: ChatSource[]; onOpen: (path: string, line: number) => void}) {
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  return <div className="chat-answer">{text.split(/(```[\s\S]*?```)/g).map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
      return <div className="chat-code" key={i}><button className="ghost-btn" onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {setCopied(i); setCopyError(false);}).catch(() => setCopyError(true));
      }}>{t(copied === i ? 'Скопировано' : 'Копировать код')}</button><pre><code>{code}</code></pre></div>;
    }
    return <div className="chat-prose" key={i}>{part.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\d+\])/g).map((fragment, j) => {
      if (fragment.startsWith('**') && fragment.endsWith('**')) return <strong key={j}>{fragment.slice(2,-2)}</strong>;
      if (fragment.startsWith('`') && fragment.endsWith('`')) return <code key={j}>{fragment.slice(1,-1)}</code>;
      const match = /^\[(\d+)\]$/.exec(fragment);
      const source = match ? sources[Number(match[1])-1] : undefined;
      return source ? <button className="chat-citation" key={j} title={`${source.path}:${source.start}`}
        onClick={() => onOpen(source.path, source.start)}>{fragment}</button> : fragment;
    })}</div>;
  })}{copyError && <p role="alert">{t('Не удалось скопировать. Выделите код вручную.')}</p>}</div>;
}

export function CodeChat({projectId, path, dirty, visible, onClose, onOpen}: {
  projectId: string; path: string | null; dirty: boolean; visible: boolean;
  onClose: () => void; onOpen: (path: string, line: number) => void;
}) {
  const preferences = useSettings();
  const assistantName = preferences.assistantName.trim() || t('Помощник');
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  const historyRevision = useRef(0);
  const refreshHistory = useRef(true);
  const running = busy || turns.some(turn => turn.status === 'running');

  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false; request.current?.abort();};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    refreshHistory.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      const revision = historyRevision.current;
      try {
        const [state, history] = await Promise.all([api.indexStatus(projectId, controller.signal),
          refreshHistory.current && !pending.current ? api.chatHistory(projectId, controller.signal) : Promise.resolve(null)]);
        if (stopped) return;
        setIndex(state); setStatusError('');
        if (history && !operation.current && !pending.current && revision === historyRevision.current) {
          setTurns(history); refreshHistory.current = history.some(turn => turn.status === 'running');
        }
      } catch (reason) {
        if (!stopped) setStatusError(reason instanceof Error ? reason.message : t('Не удалось загрузить состояние чата.'));
      } finally {
        if (!stopped) {setLoading(false); timer = setTimeout(() => void poll(), visible ? 2500 : 10000);}
      }
    }
    void poll();
    return () => {stopped = true; controller.abort(); clearTimeout(timer);};
  }, [projectId, visible]);
  useEffect(() => { if (visible) end.current?.scrollIntoView({block:'nearest', behavior:'smooth'}); }, [turns.length, busy, visible]);
  useEffect(() => { if (visible) input.current?.focus(); }, [visible]);

  async function send(value: string) {
    const text = value.trim();
    if (!text || text.length > 4000 || pending.current || running || !index?.ready || dirty || statusError) return;
    pending.current = true; setBusy(true); setError('');
    historyRevision.current++;
    const id = crypto.randomUUID();
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    setQuestion('');
    const optimistic: ChatTurn = {id, question:text, answer:'', status:'running', error:'', sources:[], generation:index.generation, created_at:new Date().toISOString()};
    setTurns(items => [...items, optimistic].slice(-50));
    try {
      const result = await api.askCode(projectId, text, path, getSettings().language, id, controller.signal);
      if (alive.current) setTurns(items => items.map(item => item.id === id ? result : item));
    } catch (reason) {
      if (alive.current) {
        refreshHistory.current = true;
        const message = controller.signal.aborted ? t('Время ожидания истекло. Состояние запроса обновится автоматически.') : reason instanceof Error ? reason.message : t('Не удалось получить ответ.');
        setError(message); setQuestion(text);
        setTurns(items => items.map(item => item.id === id ? {...item, status:'error', error:message} : item));
      }
    } finally {clearTimeout(timeout); historyRevision.current++; pending.current = false; if (alive.current) setBusy(false);}
  }

  async function reindex() {
    if (operation.current) return;
    operation.current = true; setUpdating(true); setError('');
    try { const state = await api.reindex(projectId); if (alive.current) setIndex(state); }
    catch (reason) {if (alive.current) setError(reason instanceof Error ? reason.message : t('Не удалось обновить индекс.'));}
    finally {operation.current = false; if (alive.current) setUpdating(false);}
  }
  async function clear() {
    if (running || operation.current || !await confirmAction(t('Очистить историю чата этого проекта?'))) return;
    historyRevision.current++;
    operation.current = true; setUpdating(true); setError('');
    try {await api.clearChat(projectId); if (alive.current) setTurns([]);}
    catch (reason) {if (alive.current) setError(reason instanceof Error ? reason.message : t('Не удалось очистить историю.'));}
    finally {historyRevision.current++; operation.current = false; if (alive.current) setUpdating(false);}
  }
  if (!visible) return null;
  const indexing = index?.status === 'queued' || index?.status === 'running';
  return <section className="code-chat" aria-label={t('Чат по коду')}>
    <header className="chat-heading"><div><h2>{assistantName}</h2><span>{t('Только текущий проект')}</span></div>
      <button className="ghost-btn" onClick={onClose} aria-label={t('Закрыть чат')}>×</button></header>
    <div className="chat-index">
      <div className="chat-index-title"><strong>{t(index?.phase || 'Проверка индекса…')}</strong>
        <button className="ghost-btn" disabled={indexing || updating || running} onClick={() => void reindex()}>{t('Обновить индекс')}</button></div>
      {indexing && <><progress max={index?.total || 1} value={index?.total ? index.completed : undefined} aria-label={t('Индексация проекта')} />
        <small>{index?.total ? `${index.completed} / ${index.total}` : t('Первый запуск модели может занять несколько минут.')}</small></>}
      {index?.ready && <small>{t('Файлов')}: {index.files} · {t('Фрагментов')}: {index.chunks}</small>}
      {!!index?.skipped.length && <details><summary>{t('Пропущено файлов')}: {index.skipped.length}</summary><p>{t('Зависимости, двоичные файлы, секреты и файлы больше 512 КБ не индексируются.')}</p><ul>{index.skipped.slice(0,100).map(p => <li key={p}>{p}</li>)}</ul></details>}
      {index?.error && <p role="alert">{t(index.error)}</p>}
      {statusError && <p role="alert">{statusError}</p>}
    </div>
    <div className="chat-thread" aria-label={t('История чата')}>
      {loading ? <p>{t('Загрузка…')}</p> : turns.length === 0 && <div className="chat-empty"><h3>{t('Разберёмся в коде')}</h3>
        <p>{t('Задайте вопрос о проекте. Ответ будет опираться на найденные фрагменты кода.')}</p>
        {['Где находится точка входа в проект?', 'Объясни, как работает текущий файл.', 'Как добавить метод в существующий класс?'].map(prompt =>
          <button className="ghost-btn" key={prompt} onClick={() => {setQuestion(t(prompt)); input.current?.focus();}}>{t(prompt)}</button>)}
      </div>}
      {turns.map(turn => <article className="chat-turn" key={turn.id}>
        <div className="chat-question"><strong>{t('Вы')}</strong><p>{turn.question}</p></div>
        <div className="chat-response"><strong>{assistantName}</strong>
          {turn.status === 'running' ? <p role="status">{t('Ищу фрагменты и готовлю ответ…')}</p> : turn.status === 'error' ?
            <div><p role="alert">{t(turn.error)}</p><button className="ghost-btn" disabled={running || !index?.ready || dirty} onClick={() => void send(turn.question)}>{t('Повторить вопрос')}</button></div> :
            <><Answer text={turn.answer} sources={turn.sources} onOpen={onOpen} />
              {index && turn.generation !== index.generation && <p className="chat-note">{t('Ответ относится к предыдущей версии индекса. Фрагменты ниже сохранены на момент ответа.')}</p>}
              {!!turn.sources.length && <details className="chat-sources"><summary>{t('Источники')}: {turn.sources.length}</summary>
                {turn.sources.map((source, i) => <div key={i}><button className="chat-source-link" onClick={() => onOpen(source.path, source.start)}>
                  [{i+1}] {source.path}:{source.start}–{source.end}</button><small>{source.symbol}</small><pre>{source.text}</pre></div>)}</details>}
            </>}
        </div>
      </article>)}
      <div ref={end} />
    </div>
    <form className="chat-compose" onSubmit={event => {event.preventDefault(); void send(question);}}>
      {dirty && <p className="chat-note">{t('Сохраните изменения в редакторе перед вопросом: чат использует сохранённый код.')}</p>}
      {error && <p role="alert">{error}</p>}
      <label htmlFor="code-chat-question">{t('Вопрос по проекту')}</label>
      <textarea id="code-chat-question" ref={input} value={question} maxLength={4000} rows={3}
        placeholder={t('Спросите о коде…')} onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault(); void send(question);}}} />
      <div className="chat-compose-actions"><button type="button" className="ghost-btn" disabled={running || updating || !turns.length} onClick={() => void clear()}>{t('Очистить чат')}</button>
        <button type="submit" className="primary-btn" disabled={running || updating || !question.trim() || !index?.ready || dirty || !!statusError}>{t('Отправить')}</button></div>
      <small>{t('Enter — отправить · Shift+Enter — новая строка. Показаны последние 50 вопросов.')}</small>
    </form>
  </section>;
}
