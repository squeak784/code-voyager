import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { useSettings } from './settings';

(self as typeof self & { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
function language(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ({ py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', md: 'markdown', css: 'css', html: 'html', json: 'json' } as Record<string, string>)[ext] || 'plaintext';
}
export function CodeEditor({ value, path, readOnly = false, onChange, onSave, revealLine }: {
  value: string; path: string; readOnly?: boolean; onChange?: (value: string) => void; onSave?: () => void; revealLine?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const callbacks = useRef({ onChange, onSave }); callbacks.current = { onChange, onSave };
  const settings = useSettings();
  const programmaticChange = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const editor = monaco.editor.create(host.current, {
      value, language: language(path), automaticLayout: true,
      minimap: { enabled: false }, scrollBeyondLastLine: false,
      fontFamily: "'DM Mono', monospace", padding: { top: 16 },
      ariaLabel: 'Code editor', readOnly, tabSize: 4,
    });
    instance.current = editor;
    const subscription = editor.onDidChangeModelContent(() => { if (!programmaticChange.current) callbacks.current.onChange?.(editor.getValue()); });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacks.current.onSave?.());
    const theme = () => monaco.editor.setTheme(document.documentElement.dataset.theme === 'light' ? 'vs' : 'vs-dark');
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); subscription.dispose(); const model = editor.getModel(); editor.dispose(); model?.dispose(); instance.current = null; };
  }, [path]);
  useEffect(() => {
    if (instance.current && instance.current.getValue() !== value) { programmaticChange.current = true; try { instance.current.setValue(value); } finally { programmaticChange.current = false; } }
  }, [value]);
  useEffect(() => {
    const editor = instance.current;
    if (!editor || !revealLine) return;
    const line = Math.min(Math.max(1, revealLine), editor.getModel()?.getLineCount() || 1);
    editor.setPosition({lineNumber: line, column: 1}); editor.revealLineInCenter(line); editor.focus();
  }, [path, revealLine]);
  useEffect(() => {
    instance.current?.updateOptions({ readOnly, fontSize: settings.fontSize, wordWrap: settings.wrapLines ? 'on' : 'off', lineNumbers: settings.lineNumbers ? 'on' : 'off' });
  }, [readOnly, settings]);
  return <div className="monaco-host" ref={host} />;
}
