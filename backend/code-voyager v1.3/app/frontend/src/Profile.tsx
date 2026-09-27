import { useState, type FormEvent } from 'react';
import { AccentControls, AssistantSettings } from './ProfileExtras';
import { CommentSettings } from './CommentSettings';
import { api, type User } from './api';
import { t, locale } from './i18n';
import { defaults, updateSettings, useSettings, type Settings } from './settings';

export function Profile({ user, onBack }: { user: User; onBack: () => void }) {
  const settings = useSettings();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(false);
    if (password !== confirm) { setError('Пароли не совпадают'); return; }
    if (password === current) { setError('Новый пароль должен отличаться от текущего'); return; }
    setBusy(true);
    try {
      await api.changePassword(current, password);
      setCurrent(''); setPassword(''); setConfirm(''); setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось изменить пароль');
    } finally { setBusy(false); }
  }
  return <main className="profile-page">
    <div className="profile-heading">
      <div><p className="panel-kicker">{t('Настройки аккаунта')}</p><h1>{t('Профиль')}</h1></div>
      <button className="ghost-btn" onClick={onBack}>← {t('Назад')}</button>
    </div>
    <div className="profile-grid profile-columns">
      <div className="profile-column">
        <CommentSettings />
      <section className="settings-card">
        <h2>{t('Смена пароля')}</h2>
        <form onSubmit={changePassword}>
          <label className="settings-field">{t('Текущий пароль')}<input type="password" autoComplete="current-password" required maxLength={128} value={current} disabled={busy} onChange={e => { setCurrent(e.target.value); setSuccess(false); }} /></label>
          <label className="settings-field">{t('Новый пароль')}<input type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={password} disabled={busy} onChange={e => { setPassword(e.target.value); setSuccess(false); }} /></label>
          <p className="settings-hint">{t('От 6 до 128 символов.')}</p>
          <label className="settings-field">{t('Повторите новый пароль')}<input type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={confirm} disabled={busy} onChange={e => { setConfirm(e.target.value); setSuccess(false); }} /></label>
          {error && <p className="settings-error" role="alert">{t(error)}</p>}
          {success && <p className="settings-success" role="status">{t('Пароль изменён')}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>{t(busy ? 'Сохраняем…' : 'Изменить пароль')}</button>
        </form>
      </section>
      </div>
      <div className="profile-column">
      <section className="settings-card">
        <h2>{t('Личные данные')}</h2>
        <div className="profile-identity"><span className="profile-avatar">{user.username.slice(0, 2).toUpperCase()}</span><div><strong>{user.username}</strong><p>{user.email}</p></div></div>
        <dl><dt>{t('Имя пользователя')}</dt><dd>{user.username}</dd><dt>Email</dt><dd>{user.email}</dd>
          {user.created_at && <><dt>{t('Дата регистрации')}</dt><dd>{new Date(user.created_at).toLocaleDateString(locale())}</dd></>}
        </dl>
      </section>
      <section className="settings-card">
        <h2>{t('Внешний вид и язык')}</h2>
        <label className="settings-field">{t('Режим темы')}<select value={settings.theme} onChange={e => updateSettings({ theme: e.target.value as Settings['theme'] })}>
          <option value="system">{t('Системная')}</option><option value="dark">{t('Тёмная')}</option><option value="light">{t('Светлая')}</option>
        </select></label>
        <AccentControls />
        <label className="settings-field">{t('Язык интерфейса')}<select value={settings.language} onChange={e => updateSettings({ language: e.target.value as Settings['language'] })}>
          <option value="ru">Русский</option><option value="en">English</option>
        </select></label>
        <p className="settings-hint">{t('Настройки сохраняются в этом браузере и применяются сразу.')}</p>
      </section>
        <AssistantSettings />
      <section className="settings-card">
        <h2>{t('Просмотр кода')}</h2>
        <label className="settings-field">{t('Размер шрифта')}: {settings.fontSize}px<input type="range" min={11} max={22} value={settings.fontSize} onChange={e => updateSettings({ fontSize: Number(e.target.value) })} /></label>
        <label className="settings-check"><input type="checkbox" checked={settings.wrapLines} onChange={e => updateSettings({ wrapLines: e.target.checked })} />{t('Перенос длинных строк')}</label>
        <label className="settings-check"><input type="checkbox" checked={settings.lineNumbers} onChange={e => updateSettings({ lineNumbers: e.target.checked })} />{t('Номера строк')}</label>
        <div className={`code-preview ${settings.wrapLines ? 'wrap-code' : ''}`} style={{ fontSize: settings.fontSize }}>
          <div>{settings.lineNumbers && <span>1 </span>}<code>def welcome(name: str):</code></div>
          <div>{settings.lineNumbers && <span>2 </span>}<code>{'    return f"Welcome to Code Voyager, {name}!"'}</code></div>
        </div>
        <button className="ghost-btn" onClick={() => updateSettings({ fontSize: defaults.fontSize, wrapLines: defaults.wrapLines, lineNumbers: defaults.lineNumbers })}>{t('Сбросить настройки кода')}</button>
      </section>
      </div>
    </div>
  </main>;
}
