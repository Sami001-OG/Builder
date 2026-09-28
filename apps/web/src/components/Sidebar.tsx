import { useState } from 'react';
import {
  Bot, ChevronRight, File as FileIcon, Files, Folder as FolderIcon,
  FolderOpen, Sparkles, Square,
} from 'lucide-react';
import type { Builder } from '../hooks/useBuilder';
import type { FileNode } from '../api';

const SUGGESTIONS = [
  'Add a hero section with a signup form',
  'Create a pricing page with 3 tiers',
  'Add dark mode toggle to the app',
];

function fileIcon(name: string) {
  if (/\.(tsx?|jsx?)$/.test(name)) return <FileIcon size={14} className="fi-code" />;
  if (/\.css$/.test(name)) return <FileIcon size={14} className="fi-css" />;
  if (/\.(png|jpe?g|svg|ico|webp)$/.test(name)) return <FileIcon size={14} className="fi-img" />;
  if (/\.json$/.test(name)) return <FileIcon size={14} className="fi-json" />;
  if (/\.html$/.test(name)) return <FileIcon size={14} className="fi-html" />;
  return <FileIcon size={14} />;
}

function Tree({ nodes, onOpen, depth = 0 }: { nodes: FileNode[]; onOpen: (p: string) => void; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ '': true } as Record<string, boolean>);
  return (
    <div className="tree" style={{ paddingLeft: depth * 10 }}>
      {nodes.map((n, i) => (
        <div key={n.path} className="stagger" style={{ ['--i' as string]: i }}>
          {n.type === 'dir' ? (
            <>
              <div
                className="tree-row"
                role="button"
                tabIndex={0}
                onClick={() => setOpen((o) => ({ ...o, [n.path]: !o[n.path] }))}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => ({ ...o, [n.path]: !o[n.path] })); }}
              >
                <ChevronRight size={13} className={open[n.path] ? 'chev-open' : 'chev'} />
                {open[n.path] ? <FolderOpen size={14} className="fi-dir" /> : <FolderIcon size={14} className="fi-dir" />}
                <span className="tree-name">{n.name}/</span>
              </div>
              {open[n.path] && n.children && <Tree nodes={n.children} onOpen={onOpen} depth={depth + 1} />}
            </>
          ) : (
            <div className="tree-row" role="button" tabIndex={0} onClick={() => onOpen(n.path)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(n.path); }}>
              {fileIcon(n.name)}
              <span className="tree-name">{n.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Sidebar({
  b, tab, setTab, onOpen, prompt, setPrompt, onProjectAction,
}: {
  b: Builder;
  tab: 'chat' | 'files';
  setTab: (t: 'chat' | 'files') => void;
  onOpen: (p: string) => void;
  prompt: string;
  setPrompt: (s: string) => void;
  onProjectAction: () => void;
}) {
  const send = () => {
    if (!prompt.trim() || b.running) return;
    void b.sendPrompt(prompt);
    setPrompt('');
  };

  return (
    <aside className="panel sidebar">
      <div className="panel-head">
        <button className={`tab${tab === 'chat' ? ' tab-active' : ''}`} onClick={() => setTab('chat')}>
          <Bot size={13} />AI agent
        </button>
        <button className={`tab${tab === 'files' ? ' tab-active' : ''}`} onClick={() => setTab('files')}>
          <Files size={13} />Explorer
        </button>
      </div>
      {tab === 'chat' ? (
        <div className="chat">
          <div className="chat-msgs">
            {b.msgs.length === 0 && (
              <div className="chat-empty anim-rise">
                <Sparkles size={20} className="muted" />
                <p>Ask the agent to build or modify the app. It inspects, edits, builds, and repairs automatically.</p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip" onClick={() => { setPrompt(s); }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {b.msgs.map((m) => (
              <div key={m.id} className={`bubble anim-rise ${m.role}${m.streaming ? ' streaming' : ''}`}>
                <span className="bubble-role">{m.role === 'user' ? 'You' : 'Builder'}</span>
                <span className={m.streaming ? 'shimmer' : undefined}>{m.text}</span>
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input
              className="input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder="Describe what to build…"
              aria-label="Agent prompt"
            />
            <button className="btn btn-primary" onClick={send} disabled={b.running || !prompt.trim()}>
              {b.running ? 'Running…' : 'Send'}
            </button>
            {b.running && (
              <button className="btn" onClick={() => void b.stopAgent()} title="Stop agent">
                <Square size={13} />Stop
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="panel-body">
          {b.tree.length === 0 ? (
            <div className="empty anim-rise">
              <FolderIcon size={22} className="muted" />
              <p>No project open yet.</p>
              <button className="btn btn-primary" onClick={onProjectAction}>Create or open a project</button>
            </div>
          ) : (
            <Tree nodes={b.tree} onOpen={onOpen} />
          )}
        </div>
      )}
    </aside>
  );
}
