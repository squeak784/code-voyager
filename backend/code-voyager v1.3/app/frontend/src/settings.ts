import { useSyncExternalStore } from 'react';

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  accent: 'red' | 'blue' | 'green' | 'custom';
  customAccent: string;
  assistantName: string;
  assistantLanguage: 'auto' | 'ru' | 'en';
  assistantDetail: 'brief' | 'standard' | 'detailed';
  language: 'ru' | 'en';
  fontSize: number;
  wrapLines: boolean;
  lineNumbers: boolean;
  commentLanguage: 'ru' | 'en';
  commentDetail: 'brief' | 'standard' | 'detailed';
  commentStyle: 'google' | 'numpy' | 'rest';
  commentVariables: boolean;
  commentModel: string;
}
const key = 'code-voyager.preferences.v1';
export const defaults: Settings = { theme: 'system', accent: 'blue', customAccent: '#8b5cf6', assistantName: '', assistantLanguage: 'auto', assistantDetail: 'standard', language: 'ru', fontSize: 13, wrapLines: false, lineNumbers: true,
  commentLanguage: 'ru', commentDetail: 'standard', commentStyle: 'google', commentVariables: true, commentModel: 'deepseek-v4.1-flash' };
function read(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}') ?? {};
    return {
      theme: ['dark', 'light', 'system'].includes(value.theme) ? value.theme : defaults.theme,
      accent: ['red', 'blue', 'green', 'custom'].includes(value.accent) ? value.accent : defaults.accent,
      customAccent: typeof value.customAccent === 'string' && /^#[0-9a-f]{6}$/i.test(value.customAccent) ? value.customAccent : defaults.customAccent,
      assistantName: typeof value.assistantName === 'string' ? value.assistantName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) : defaults.assistantName,
      assistantLanguage: ['ru','en'].includes(value.assistantLanguage) ? value.assistantLanguage : 'auto',
      assistantDetail: ['brief','standard','detailed'].includes(value.assistantDetail) ? value.assistantDetail : 'standard',
      language: value.language === 'en' ? 'en' : 'ru',
      fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 11 && value.fontSize <= 22 ? value.fontSize : defaults.fontSize,
      wrapLines: typeof value.wrapLines === 'boolean' ? value.wrapLines : defaults.wrapLines,
      lineNumbers: typeof value.lineNumbers === 'boolean' ? value.lineNumbers : defaults.lineNumbers,
      commentLanguage: value.commentLanguage === 'en' ? 'en' : 'ru',
      commentDetail: ['brief', 'standard', 'detailed'].includes(value.commentDetail) ? value.commentDetail : defaults.commentDetail,
      commentStyle: ['google', 'numpy', 'rest'].includes(value.commentStyle) ? value.commentStyle : defaults.commentStyle,
      commentVariables: typeof value.commentVariables === 'boolean' ? value.commentVariables : defaults.commentVariables,
      commentModel: typeof value.commentModel === 'string' ? value.commentModel.slice(0, 200) : defaults.commentModel,
    };
  } catch { return { ...defaults }; }
}
let settings = read();
const listeners = new Set<() => void>();
const media = window.matchMedia('(prefers-color-scheme: dark)');
function apply() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
  root.dataset.accent = settings.accent;
  const color = settings.accent === 'custom' ? settings.customAccent : ({red:'#c6283d', blue:'#2563eb', green:'#087b50'} as const)[settings.accent];
  const rgb = [1,3,5].map(index => parseInt(color.slice(index,index+2),16));
  const mix = (target: number, amount: number) => '#' + rgb.map(c => Math.round(c + (target-c)*amount).toString(16).padStart(2,'0')).join('');
  const luminance = rgb.map(c => c/255).map(c => c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4);
  const light = .2126*luminance[0] + .7152*luminance[1] + .0722*luminance[2] > .179;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', mix(light ? 255 : 0, .12));
  root.style.setProperty('--accent-soft', color + '24');
  root.style.setProperty('--accent-text', root.dataset.theme === 'dark' ? mix(255,.45) : mix(0,.35));
  root.style.setProperty('--accent-on', light ? '#111827' : '#ffffff');
  root.lang = settings.language;
  document.title = settings.language === 'en' ? 'Code Voyager — Code documentation' : 'Code Voyager — Автодокументация';
  root.style.colorScheme = root.dataset.theme;
}
apply();
media.addEventListener('change', apply);
export function getSettings() { return settings; }
export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Keep settings for this session. */ }
  apply();
  listeners.forEach(listener => listener());
}
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) {
    settings = read(); apply(); listeners.forEach(listener => listener());
  }
});
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSettings() { return useSyncExternalStore(subscribe, getSettings); }
