import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { t } from './i18n';
import './interfaceCustomization.css';

type Widths = {left: number; right: number};
type Side = keyof Widths;
const key = 'code-voyager.workspace-widths.v1';
const resetEvent = 'code-voyager:reset-workspace-widths';
const initial: Widths = {left:250,right:350};
const leftMin = 150, rightMin = 250, codeMin = 320, handles = 16;
function read(): Widths {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return {left:Number.isFinite(data.left) ? Math.max(leftMin,Math.min(1400,data.left)) : initial.left,
            right:Number.isFinite(data.right) ? Math.max(rightMin,Math.min(2000,data.right)) : initial.right};
  } catch {return {...initial};}
}
function fit(value: Widths, width: number): Widths {
  const space = Math.max(leftMin+rightMin,width-codeMin-handles);
  const left = Math.max(leftMin,Math.min(value.left,space-rightMin));
  return {left,right:Math.max(rightMin,Math.min(value.right,space-left))};
}
export function resetWorkspaceLayout() {
  try {localStorage.removeItem(key);} catch { /* In-memory reset still works. */ }
  window.dispatchEvent(new Event(resetEvent));
}

export function useWorkspaceLayout() {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [width,setWidth] = useState(0);
  const [sizes,setSizes] = useState<Widths>(read);
  const sizesRef = useRef(sizes);
  const drag = useRef<{side:Side; x:number; sizes:Widths; element:HTMLDivElement; pointer:number} | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {setContainer(node);},[]);
  const stop = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    delete document.documentElement.dataset.resizingPanels;
    if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
    if (active) {try {localStorage.setItem(key,JSON.stringify(sizesRef.current));} catch { /* Retain widths in memory. */ }}
  },[]);
  useEffect(() => {
    if (!container) return;
    const measure = () => {stop(); setWidth(container.clientWidth);};
    const observer = new ResizeObserver(measure);
    observer.observe(container); measure();
    return () => {observer.disconnect(); stop();};
  },[container,stop]);
  useEffect(() => {
    const reset = () => {stop(); sizesRef.current = {...initial}; setSizes({...initial});};
    const storage = (event:StorageEvent) => {if (event.key === key || event.key === null) {stop(); const next=read(); sizesRef.current=next; setSizes(next);}};
    window.addEventListener(resetEvent,reset);
    window.addEventListener('storage',storage);
    window.addEventListener('blur',stop);
    return () => {window.removeEventListener(resetEvent,reset); window.removeEventListener('storage',storage); window.removeEventListener('blur',stop); stop();};
  },[stop]);
  const actual = fit(sizes,width);
  const wide = width >= 900;
  function update(side: Side, desired: number, base=actual, persist=false) {
    const max = width-handles-codeMin-base[side === 'left' ? 'right' : 'left'];
    const next = {...base,[side]:Math.round(Math.max(side === 'left' ? leftMin : rightMin,Math.min(max,desired)))};
    sizesRef.current = next; setSizes(next);
    if (persist) {try {localStorage.setItem(key,JSON.stringify(next));} catch { /* Retain widths in memory. */ }}
  }
  function begin(side: Side, event: PointerEvent<HTMLDivElement>) {
    if (!wide || event.button !== 0) return;
    event.preventDefault(); stop();
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {side,x:event.clientX,sizes:actual,element:event.currentTarget,pointer:event.pointerId};
    document.documentElement.dataset.resizingPanels = 'true';
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const delta = (event.clientX-active.x)*(active.side === 'left' ? 1 : -1);
    update(active.side,active.sizes[active.side]+delta,active.sizes);
  }
  function reset(side:Side) {update(side,initial[side],actual,true);}
  const style: CSSProperties = wide ? {gridTemplateColumns:`${actual.left}px 8px minmax(${codeMin}px, 1fr) 8px ${actual.right}px`} : {};
  return {ref,style,wide,actual,width,begin,move,stop,reset,update};
}

export function WorkspaceDivider({side,layout}: {side:Side; layout:ReturnType<typeof useWorkspaceLayout>}) {
  if (!layout.wide) return null;
  const name = t(side === 'left' ? 'Ширина панели файлов' : 'Ширина панели помощника');
  const max = layout.width-handles-codeMin-layout.actual[side === 'left' ? 'right' : 'left'];
  return <div className="workspace-divider" role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={name} aria-controls={side === 'left' ? 'workspace-files' : 'workspace-inspector'}
    aria-valuemin={side === 'left' ? leftMin : rightMin} aria-valuemax={Math.floor(max)} aria-valuenow={Math.round(layout.actual[side])}
    title={`${name}. ${t('Перетащите границу. Двойной щелчок — сброс.')}`}
    onPointerDown={event => layout.begin(side,event)} onPointerMove={layout.move}
    onPointerUp={layout.stop} onPointerCancel={layout.stop} onLostPointerCapture={layout.stop}
    onDoubleClick={() => layout.reset(side)}
    onKeyDown={event => {
      if (event.key === 'Home') {event.preventDefault(); layout.reset(side);}
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta=(event.key === 'ArrowRight' ? 1 : -1)*(side === 'left' ? 1 : -1)*(event.shiftKey ? 50 : 10);
        layout.update(side,layout.actual[side]+delta,layout.actual,true);
      }
    }}><span aria-hidden="true" /></div>;
}
