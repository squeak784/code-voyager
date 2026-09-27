import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { ProjectListItem } from './types';
import './renameProject.css';

export function RenameProjectDialog({ project, onClose, onSaved }: {
  project: ProjectListItem;
  onClose: () => void;
  onSaved: (project: ProjectListItem) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && Array.from(trimmed).length <= 255 &&
    !Array.from(trimmed).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '/\\'.includes(char));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    input.current?.select();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !valid || trimmed === project.name) return;
    pending.current = true; setBusy(true); setError('');
    try { onSaved(await api.renameProject(project.id, trimmed)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('Не удалось переименовать проект')); }
    finally { pending.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="rename-project-dialog" aria-labelledby="rename-project-heading"
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <form onSubmit={event => void save(event)} aria-busy={busy}>
      <h2 id="rename-project-heading">{t('Переименовать проект')}</h2>
      <label className="settings-field" htmlFor="rename-project-name">{t('Название проекта')}
        <input ref={input} id="rename-project-name" value={name} disabled={busy} required
          aria-describedby="rename-project-hint" aria-invalid={!valid}
          onChange={event => { setName(event.target.value); setError(''); }} />
      </label>
      <p id="rename-project-hint">{t('Название: от 1 до 255 символов, без слешей и управляющих символов.')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="rename-project-actions">
        <button type="button" className="ghost-btn" disabled={busy} onClick={onClose}>{t('Отмена')}</button>
        <button type="submit" className="primary-btn" disabled={busy || !valid || trimmed === project.name}>
          {busy ? t('Сохраняем название…') : t('Сохранить')}
        </button>
      </div>
    </form>
  </dialog>;
}
