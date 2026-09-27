import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { t } from './i18n';
export interface GraphNode { id: string; name: string; qualified: string; kind: 'class' | 'function'; path: string; line: number; end_line: number; parent: string | null; }
export interface GraphData { nodes: GraphNode[]; edges: {source: string; target: string; kind: 'contains' | 'inherits' | 'calls'}[]; warnings: {path: string; reason: string}[]; }
const labels = {contains: 'Вложенность', inherits: 'Наследование', calls: 'Вызовы'};
export function ProjectMap({projectId, onClose, onOpen}: {projectId: string; onClose: () => void; onOpen: (path: string, line: number) => void}) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [file, setFile] = useState('');
  const [kind, setKind] = useState('');
  const [zoom, setZoom] = useState(1);
  const [revision, setRevision] = useState(0);
  const [relations, setRelations] = useState({contains:true, inherits:true, calls:true});
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    api.getGraph(projectId, controller.signal).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [projectId, revision]);
  const matches = useMemo(() => data?.nodes.filter(node => (!file || node.path === file) && (!kind || node.kind === kind) && `${node.qualified} ${node.path}`.toLowerCase().includes(query.toLowerCase().trim())) || [], [data, file, kind, query]);
  const visible = matches.slice(0, 200);
  const layout = useMemo(() => {
    const groups = new Map<string, GraphNode[]>();
    for (const node of visible) groups.set(node.path, [...(groups.get(node.path) || []), node]);
    const heights = [20,20,20]; const positions = new Map<string, {x:number; y:number}>();
    const headers: {path:string; x:number; y:number}[] = [];
    for (const [path, nodes] of groups) {
      const column = heights.indexOf(Math.min(...heights)); const x = column * 360 + 25; let y = heights[column];
      headers.push({path, x, y}); y += 35;
      for (const node of nodes) { positions.set(node.id, {x, y}); y += 88; }
      heights[column] = y + 35;
    }
    return {positions, headers, height:Math.max(380,...heights)};
  }, [matches]);
  const edges = data?.edges.filter(edge => relations[edge.kind] && layout.positions.has(edge.source) && layout.positions.has(edge.target)) || [];
  const files = [...new Set(data?.nodes.map(node => node.path) || [])].sort();
  return <dialog className="map-dialog" aria-labelledby="map-heading" ref={dialog} onCancel={event => {event.preventDefault(); onClose();}}>
    <header className="map-heading"><div><p className="panel-kicker">CODE MAP</p><h2 id="map-heading">{t('Карта проекта')}</h2></div><button className="ghost-btn" onClick={onClose}>{t('Закрыть')}</button></header>
    <p className="settings-hint">{t('Карта сохранённого Python-кода. Нажмите объект, чтобы открыть его определение. Динамические связи не показаны.')}</p>
    <div className="map-controls">
      <input aria-label={t('Поиск объекта')} placeholder={t('Поиск объекта')} value={query} onChange={event=>setQuery(event.target.value)} />
      <select aria-label={t('Файл')} value={file} onChange={event=>setFile(event.target.value)}><option value="">{t('Все файлы')}</option>{files.map(path=><option key={path}>{path}</option>)}</select>
      <select aria-label={t('Тип объекта')} value={kind} onChange={event=>setKind(event.target.value)}><option value="">{t('Все объекты')}</option><option value="class">{t('Классы')}</option><option value="function">{t('Функции')}</option></select>
      <button className="ghost-btn" onClick={()=>setRevision(value=>value+1)}>{t('Обновить')}</button>
      <button className="ghost-btn" aria-label={t('Уменьшить масштаб')} onClick={()=>setZoom(value=>Math.max(.4, value-.2))}>−</button><span>{Math.round(zoom*100)}%</span><button className="ghost-btn" aria-label={t('Увеличить масштаб')} onClick={()=>setZoom(value=>Math.min(2, value+.2))}>+</button>
      <button className="ghost-btn" onClick={()=>setZoom(1)}>100%</button>
    </div>
    <div className="map-legend">{(Object.keys(labels) as (keyof typeof labels)[]).map(key=><label key={key}><input type="checkbox" checked={relations[key]} onChange={event=>setRelations(old=>({...old,[key]:event.target.checked}))}/><i className={`map-key ${key}`}/>{t(labels[key])}</label>)}<span>{t('Объектов')}: {matches.length} · {t('Связей')}: {edges.length}</span></div>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {!data && !error && <p role="status">{t('Строим карту…')}</p>}
    {data && <>
      {data.warnings.length > 0 && <details className="map-warnings"><summary>{t('Карта неполная')}: {data.warnings.length}</summary>{data.warnings.map((warning,index)=><p key={index}>{warning.path || t('Проект')} — {t(warning.reason==='limit'?'Достигнут лимит карты':warning.reason==='size'?'Файл слишком большой':'Не удалось разобрать файл')}</p>)}</details>}
      {matches.length > 200 && <p role="status">{t('Показаны первые 200 объектов. Уточните поиск или выберите файл.')}</p>}
      {!matches.length ? <p>{t('Объекты не найдены')}</p> : <div className="map-canvas" tabIndex={0} aria-label={t('Схема связей')}>
        <svg width={1100*zoom} height={layout.height*zoom} viewBox={`0 0 1100 ${layout.height}`} aria-label={t('Карта проекта')}>
          <defs>{(['contains','inherits','calls'] as const).map(key=><marker key={key} id={`arrow-${key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className={`map-arrow ${key}`} d="M 0 0 L 10 5 L 0 10 z" /></marker>)}</defs>
          {edges.map((edge,index)=>{const start=layout.positions.get(edge.source)!, end=layout.positions.get(edge.target)!; const right=start.x===end.x; const sx=start.x+300, sy=start.y+31, tx=right?end.x+300:end.x, ty=end.y+31;
            return <path key={index} className={`map-edge ${edge.kind}`} markerEnd={`url(#arrow-${edge.kind})`} d={right?`M${sx},${sy} C${sx+35},${sy-25} ${tx+35},${ty+25} ${tx},${ty}`:`M${sx},${sy} C${sx+45},${sy} ${tx-45},${ty} ${tx},${ty}`}><title>{t(labels[edge.kind])}: {data.nodes.find(n=>n.id===edge.source)?.qualified} → {data.nodes.find(n=>n.id===edge.target)?.qualified}</title></path>;})}
          {layout.headers.map(header=><text key={header.path} x={header.x} y={header.y+12} className="map-file"><title>{header.path}</title>{header.path.length>41?'…'+header.path.slice(-40):header.path}</text>)}
          {visible.map(node=>{const position=layout.positions.get(node.id)!; return <g key={node.id} className={`map-node ${node.kind}`} role="button" tabIndex={0} aria-label={`${node.qualified} — ${node.path}:${node.line}`} onClick={()=>onOpen(node.path,node.line)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onOpen(node.path,node.line);}}} transform={`translate(${position.x} ${position.y})`}>
            <title>{node.qualified} — {node.path}:{node.line}</title><rect width="300" height="62" rx="10"/><text x="13" y="25" className="map-node-name">{node.kind==='class'?'C':'ƒ'} · {node.qualified.length>32?node.qualified.slice(0,31)+'…':node.qualified}</text><text x="13" y="46" className="map-node-detail">{t(node.kind==='class'?'Класс':'Функция')} · {t('Строка')} {node.line}</text>
          </g>;})}
        </svg>
      </div>}
    </>}
  </dialog>;
}
