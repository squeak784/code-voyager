import { useEffect, useRef, useSyncExternalStore } from 'react';
import { t } from './i18n';

type Request = { message: string; resolve: (value: boolean) => void };
let request: Request | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function confirmAction(message: string): Promise<boolean> {
  if (request) return Promise.resolve(false);
  return new Promise(resolve => { request = { message, resolve }; listeners.forEach(listener => listener()); });
}
function finish(value: boolean) {
  const previous = request; request = null;
  listeners.forEach(listener => listener()); previous?.resolve(value);
}
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribe, () => request);
  const cancel = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') {
        const buttons = panel.current?.querySelectorAll('button');
        if (!buttons?.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, [pending]);
  if (!pending) return null;
  return <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) finish(false); }}>
    <div className="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-heading" ref={panel}>
      <h2 id="confirm-heading">{t('Подтверждение')}</h2><p>{pending.message}</p>
      <div><button ref={cancel} className="ghost-btn" onClick={() => finish(false)}>{t('Отмена')}</button><button className="primary-btn" onClick={() => finish(true)}>{t('Продолжить')}</button></div>
    </div>
  </div>;
}
