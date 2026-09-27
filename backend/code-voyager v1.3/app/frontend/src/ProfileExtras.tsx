import { useEffect, useRef, useState } from 'react';
import { defaults, updateSettings, useSettings } from './settings';
import { t } from './i18n';
import './interfaceCustomization.css';

export function AssistantSettings() {
  const settings = useSettings();
  return <section className="settings-card">
    <h2>{t('Настройки помощника')}</h2>
    <label className="settings-field">{t('Имя помощника')}
      <input value={settings.assistantName} maxLength={40} placeholder={t('Помощник')}
        onChange={event => updateSettings({assistantName:event.target.value.replace(/[\u0000-\u001f\u007f]/g,'')})}
        onBlur={() => updateSettings({assistantName:settings.assistantName.trim()})} />
    </label>
    <p className="settings-hint">{t('Имя отображается в чате. Оставьте поле пустым, чтобы использовать стандартное имя.')}</p>
    <label className="settings-field">{t('Язык ответов')}
      <select value={settings.assistantLanguage} onChange={event => updateSettings({assistantLanguage:event.target.value as typeof settings.assistantLanguage})}>
        <option value="auto">{t('Как в интерфейсе')}</option><option value="ru">Русский</option><option value="en">English</option>
      </select>
    </label>
    <label className="settings-field">{t('Подробность ответов')}
      <select value={settings.assistantDetail} onChange={event => updateSettings({assistantDetail:event.target.value as typeof settings.assistantDetail})}>
        <option value="brief">{t('Кратко')}</option><option value="standard">{t('Обычно')}</option><option value="detailed">{t('Подробно')}</option>
      </select>
    </label>
    <p className="settings-hint">{t('Настройки применяются к новым ответам. Язык можно также указать в вопросе.')}</p>
    <button className="ghost-btn" onClick={() => updateSettings({assistantName:defaults.assistantName,assistantLanguage:defaults.assistantLanguage,assistantDetail:defaults.assistantDetail})}>{t('Сбросить настройки помощника')}</button>
  </section>;
}

function toHsv(hex: string): [number,number,number] {
  const [r,g,b] = [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)/255);
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  const h = d === 0 ? 0 : max === r ? ((g-b)/d+6)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return [h*60,max === 0 ? 0 : d/max*100,max*100];
}
function toHex(h: number,s: number,v: number) {
  const value = v/100, saturation = s/100;
  const channel = (n: number) => {
    const k = (n+h/60)%6;
    return Math.round(255*(value-value*saturation*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');
  };
  return '#'+channel(5)+channel(3)+channel(1);
}
export function AccentControls() {
  const settings = useSettings();
  const color = settings.accent === 'custom' ? settings.customAccent : ({red:'#c6283d',blue:'#2563eb',green:'#087b50'} as const)[settings.accent];
  const [open,setOpen] = useState(false);
  const [hsv,setHsv] = useState(() => toHsv(color));
  const container = useRef<HTMLFieldSetElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Preserve hue at zero brightness/saturation while dragging.
    if (toHex(...hsv) !== color.toLowerCase()) setHsv(toHsv(color));
  }, [color]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') {setOpen(false); trigger.current?.focus();} };
    document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape);
    return () => {document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape);};
  }, [open]);
  function change(index: number,value: number) {
    const next: [number,number,number] = [...hsv]; next[index] = value;
    setHsv(next); updateSettings({accent:'custom',customAccent:toHex(...next)});
  }
  return <fieldset className="custom-accent-controls accent-popover-host" ref={container}
    onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);}}>
    <legend>{t('Цветовой акцент')}</legend>
    <button type="button" className="accent-color-circle" style={{background:color}} ref={trigger}
      aria-label={t('Выбрать произвольный цвет')} aria-expanded={open} aria-controls="accent-palette" aria-haspopup="dialog"
      onClick={() => setOpen(value => !value)} />
    {open && <div id="accent-palette" className="accent-popover" role="dialog" aria-label={t('Цветовой акцент')}>
      <div className="accent-popover-heading"><strong>{t('Цветовой акцент')}</strong><button type="button" className="ghost-btn" aria-label={t('Закрыть')} onClick={() => {setOpen(false);trigger.current?.focus();}}>×</button></div>
      <div className="accent-preview" style={{background:color}} />
      {[t('Оттенок'),t('Насыщенность'),t('Яркость')].map((label,index) => <label className="accent-slider-label" key={index}>{label}
        <input ref={index === 0 ? first : undefined} type="range" min={0} max={index === 0 ? 360 : 100} step={1}
          value={hsv[index]} aria-label={label} onChange={event => change(index,Number(event.target.value))}
          style={{background:index === 0 ? 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : index === 1 ? `linear-gradient(to right,#fff,hsl(${hsv[0]} 100% 50%))` : `linear-gradient(to right,#000,${toHex(hsv[0],hsv[1],100)})`}} />
      </label>)}
      <p className="settings-hint">{t('Цвет применяется сразу.')}</p>
    </div>}
  </fieldset>;
}
