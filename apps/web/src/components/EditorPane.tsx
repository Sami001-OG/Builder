import Editor from '@monaco-editor/react';
import { FilePlus2, X } from 'lucide-react';

export interface Tab { path: string; content: string; dirty: boolean }

export default function EditorPane({
  tabs, active, setActive, setTabs, onSave, onClose,
}: {
  tabs: Tab[];
  active: string | null;
  setActive: (p: string | null) => void;
  setTabs: (fn: (ts: Tab[]) => Tab[]) => void;
  onSave: () => void;
  onClose: (p: string) => void;
}) {
  return (
    <section className="panel editor">
      <div className="panel-head">
        <div className="tabbar">
          {tabs.map((t) => (
            <button
              key={t.path}
              className={`tab${active === t.path ? ' tab-active' : ''}`}
              onClick={() => setActive(t.path)}
              onAuxClick={(e) => { if (e.button === 1) onClose(t.path); }}
              title={t.path}
            >
              {t.path.split('/').pop()}{t.dirty && <span className="dot dot-dirty" title="Unsaved changes" />}
              <span
                className="tab-x"
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onClose(t.path); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClose(t.path); } }}
                aria-label={`Close ${t.path}`}
              >
                <X size={12} />
              </span>
            </button>
          ))}
          {tabs.length === 0 && <span className="muted tabbar-empty">No files open</span>}
        </div>
        <span className="grow" />
        <button className="btn btn-ghost" onClick={onSave} disabled={!active} title="Save (Ctrl+S)">Save</button>
      </div>
      <div className="editor-body">
        {active ? (
          <Editor
            height="100%"
            path={active}
            value={tabs.find((t) => t.path === active)?.content ?? ''}
            onChange={(v) => setTabs((ts) => ts.map((t) => (t.path === active ? { ...t, content: v ?? '', dirty: true } : t)))}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: 'var(--font-mono)', padding: { top: 12 }, scrollBeyondLastLine: false }}
            onMount={(ed) => { ed.addCommand(2097 /* Ctrl+S */, () => onSave()); }}
          />
        ) : (
          <div className="empty anim-fade">
            <FilePlus2 size={24} className="muted" />
            <p>Open a file from the explorer to start editing.</p>
          </div>
        )}
      </div>
    </section>
  );
}
