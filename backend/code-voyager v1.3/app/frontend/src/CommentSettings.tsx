import { useEffect, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import { useSettings, updateSettings, type Settings } from './settings';

export function CommentSettings() {
  const settings = useSettings();
  const [status, setStatus] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true;
    api.commentProvider().then(result => { if (active) setStatus(result.configured); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  return <section className="settings-card comment-settings-card">
    <h2>{t('Комментирование с AI')}</h2>
    <p className="settings-hint">{t(status === null ? 'Проверяем настройки…' : status ? 'Ключ настроен на сервере' : 'Добавьте ключ в .env.ai на сервере')}</p>
    <label className="settings-field">{t('Модель')}<input maxLength={200} value={settings.commentModel} onChange={e => updateSettings({commentModel: e.target.value})} placeholder="deepseek-v4.1-flash" /></label>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <label className="settings-field">{t('Язык комментариев')}<select value={settings.commentLanguage} onChange={e => updateSettings({commentLanguage: e.target.value as Settings['commentLanguage']})}><option value="ru">Русский</option><option value="en">English</option></select></label>
    <label className="settings-field">{t('Подробность')}<select value={settings.commentDetail} onChange={e => updateSettings({commentDetail: e.target.value as Settings['commentDetail']})}><option value="brief">{t('Кратко')}</option><option value="standard">{t('Обычно')}</option><option value="detailed">{t('Подробно')}</option></select></label>
    <label className="settings-field">{t('Формат docstring')}<select value={settings.commentStyle} onChange={e => updateSettings({commentStyle: e.target.value as Settings['commentStyle']})}><option value="google">Google</option><option value="numpy">NumPy</option><option value="rest">reStructuredText</option></select></label>
    <label className="settings-check"><input type="checkbox" checked={settings.commentVariables} onChange={e => updateSettings({commentVariables: e.target.checked})} />{t('Включать переменные при обработке файла')}</label>
    <p className="settings-hint">{t('Модель получает код выбранного объекта. Проверьте описание перед принятием. Существующие комментарии сохраняются.')}</p>
    <p className="settings-hint">{t('Настройки сохраняются в этом браузере и применяются сразу.')}</p>
  </section>;
}
