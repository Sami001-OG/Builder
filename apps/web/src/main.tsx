import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { api, type FileNode, type Inspection } from './api';

const styles: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0f1115', color: '#e6e8ec' },
  topbar: { display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #23262e', background: '#151821' },
  main: { display: 'flex', flex: 1, minHeight: 0 },
  left: { width: 300, borderRight: '1px solid #23262e', display: 'flex', flexDirection: 'column', minHeight: 0 },
  center: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  right: { width: 420, borderLeft: '1px solid #23262e', display: 'flex', flexDirection: 'column' },
  bottom: { height: 220, borderTop: '1px solid #23262e', display: 'flex', flexDirection: 'column' },
  btn: { background: '#2a2f3d', color: '#fff', border: '1px solid #3a4152', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' },
  input: { background: '#0c0e12', color: '#e6e8ec', border: '1px solid #2c313d', borderRadius: 6, padding: 6 },
  panel: { padding: 8, overflow: 'auto' },
  tabs: { display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #23262e', flexWrap: 'wrap' },
  tab: { padding: '4px 8px', borderRadius: 6, background: '#1c2029', cursor: 'pointer', border: '1px solid #2b303c' },
  activeTab: { background: '#2f6feb', borderColor: '#2f6feb' },
  tree: { fontSize: 13, lineHeight: 1.7 },
  chat: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  msgs: { flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  bubble: { background: '#1a1e27', border: '1px solid #2a2f3b', borderRadius: 8, padding: '6px 8px', fontSize: 13, whiteSpace: 'pre-wrap' },
};

interface ChatMsg { id: number; role: string; text: string }

function Tree({ nodes, onOpen, depth = 0 }: { nodes: FileNode[]; onOpen: (p: string) => void; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div style={{ paddingLeft: depth * 10 }}>
      {nodes.map((n) => (
        <div key={n.path}>
          {n.type === 'dir' ? (
            <>
              <div style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => ({ ...o, [n.path]: !o[n.path] }))}>
                {open[n.path] ? '▾' : '▸'} {n.name}/
              </div>
              {open[n.path] && n.children && <Tree nodes={n.children} onOpen={onOpen} depth={depth + 1} />}
            </>
          ) : (
            <div style={{ cursor: 'pointer' }} onClick={() => onOpen(n.path)}>📄 {n.name}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [tabs, setTabs] = useState<{ path: string; content: string; dirty: boolean }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [termText, setTermText] = useState('');
  const [git, setGit] = useState({ branch: '', status: '', diff: '', message: '' });
  const [leftTab, setLeftTab] = useState<'chat' | 'files'>('chat');
  const [bottomTab, setBottomTab] = useState<'terminal' | 'problems' | 'activity'>('activity');
  const [activity, setActivity] = useState<string[]>([]);
  const termRef = useRef<HTMLDivElement>(null);
  const xterm = useRef<Terminal | null>(null);
  const msgId = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const t = await api<FileNode[]>('/api/files');
      setTree(t);
    } catch { /* no project yet */ }
    try {
      const p = await api<{ inspection: Inspection | null }>('/api/project');
      setInsp(p.inspection);
    } catch { /* ignore */ }
    try {
      const g = await api<{ status: string }>('/api/git/status');
      setGit((prev) => ({ ...prev, status: String(g.status).slice(0, 4000) }));
    } catch { /* not a git repo */ }
    try {
      const b = await api<{ branch: string }>('/api/git/branch');
      setGit((prev) => ({ ...prev, branch: String(b.branch) }));
    } catch { /* ignore */ }
    try {
      const pv = await api<{ url: string | null }>('/api/preview');
      setPreview(pv.url);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // SSE agent events
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { event: string; data?: Record<string, unknown> };
        const label = `${data.event}${data.data?.['tool'] ? ` ${String(data.data['tool'])}` : ''}${data.data?.['text'] ? ` — ${String(data.data['text']).slice(0, 120)}` : ''}`;
        setActivity((a) => [...a.slice(-200), label]);
        if (data.event === 'file.changed') void refresh();
        if (data.event === 'preview.ready' && typeof data.data?.['url'] === 'string') setPreview(data.data['url'] as string);
        if (data.event === 'agent.finished' || data.event === 'agent.interrupted') { setRunning(false); void refresh(); }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [refresh]);

  // xterm terminal mirrors process output
  useEffect(() => {
    if (!termRef.current || xterm.current) return;
    const t = new Terminal({ convertEol: true, fontSize: 12 });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(termRef.current);
    fit.fit();
    xterm.current = t;
  }, []);

  const openFile = async (p: string) => {
    const f = await api<{ content: string }>('/api/file?path=' + encodeURIComponent(p));
    setTabs((ts) => (ts.some((t) => t.path === p) ? ts : [...ts, { path: p, content: f.content, dirty: false }]));
    setActive(p);
  };

  const saveFile = async () => {
    const t = tabs.find((x) => x.path === active);
    if (!t) return;
    await api('/api/file', { method: 'PUT', body: JSON.stringify({ path: t.path, content: t.content }) });
    setTabs((ts) => ts.map((x) => (x.path === t.path ? { ...x, dirty: false } : x)));
    void refresh();
  };

  const sendPrompt = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    const text = prompt;
    setPrompt('');
    setMsgs((m) => [...m, { id: ++msgId.current, role: 'user', text }]);
    try {
      const r = await api<{ runId: string; state: string; summary: string }>('/api/agent/run', {
        method: 'POST',
        body: JSON.stringify({ goal: text, mode: 'builder' }),
      });
      setRunId(r.runId);
      setMsgs((m) => [...m, { id: ++msgId.current, role: 'assistant', text: `${r.state}: ${r.summary}` }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: ++msgId.current, role: 'assistant', text: `Error: ${(e as Error).message}` }]);
      setRunning(false);
    }
  };

  const stopAgent = async () => {
    if (runId) await api('/api/agent/interrupt', { method: 'POST', body: JSON.stringify({ runId }) }).catch(() => undefined);
    setRunning(false);
  };

  const runTerminal = async (command: string, args: string[] = []) => {
    const p = await api<{ id: string }>('/api/process/start', { method: 'POST', body: JSON.stringify({ command, args }) });
    const poll = async () => {
      const o = await api<{ output: string }>(`/api/process/output?id=${p.id}`);
      setTermText(o.output.slice(-8000));
      xterm.current?.clear();
      xterm.current?.write(o.output.slice(-8000));
    };
    await poll();
    const iv = setInterval(() => { void poll(); }, 1500);
    setTimeout(() => clearInterval(iv), 60000);
  };

  const startPreview = async () => {
    await api('/api/dev/start', { method: 'POST' });
    setTimeout(() => void refresh(), 4000);
  };

  const commit = async () => {
    if (!git.message.trim()) return;
    await api('/api/git/commit', { method: 'POST', body: JSON.stringify({ message: git.message }) });
    setGit((g) => ({ ...g, message: '' }));
    void refresh();
  };

  const viewportWidth = viewport === 'mobile' ? 390 : viewport === 'tablet' ? 820 : '100%';

  return (
    <div style={styles.app}>
      <div style={styles.topbar}>
        <strong>Builder</strong>
        <span style={{ opacity: 0.7 }}>{insp ? `${insp.name} · ${insp.framework} · ${insp.packageManager}` : 'no project open'}</span>
        <span style={{ opacity: 0.7 }}>branch: {git.branch || '—'}</span>
        <span style={{ flex: 1 }} />
        <button style={styles.btn} onClick={() => void refresh()}>Refresh</button>
        <button style={styles.btn} onClick={() => void startPreview()}>Start preview</button>
        <button style={styles.btn} onClick={() => preview && window.open(preview, '_blank')}>Open externally</button>
      </div>
      <div style={styles.main}>
        <div style={styles.left}>
          <div style={styles.tabs}>
            <button style={{ ...styles.tab, ...(leftTab === 'chat' ? styles.activeTab : {}) }} onClick={() => setLeftTab('chat')}>AI agent</button>
            <button style={{ ...styles.tab, ...(leftTab === 'files' ? styles.activeTab : {}) }} onClick={() => setLeftTab('files')}>Explorer</button>
          </div>
          {leftTab === 'chat' ? (
            <div style={styles.chat}>
              <div style={styles.msgs}>
                {msgs.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>Ask the agent to build or modify the app. It inspects, edits, builds, and repairs automatically.</div>}
                {msgs.map((m) => (<div key={m.id} style={styles.bubble}><b>{m.role}:</b> {m.text}</div>))}
              </div>
              <div style={{ display: 'flex', gap: 6, padding: 8 }}>
                <input style={{ ...styles.input, flex: 1 }} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendPrompt(); }} placeholder="Describe what to build..." aria-label="Agent prompt" />
                <button style={styles.btn} onClick={() => void sendPrompt()} disabled={running}>{running ? 'Running…' : 'Send'}</button>
                {running && <button style={styles.btn} onClick={() => void stopAgent()}>Stop</button>}
              </div>
            </div>
          ) : (
            <div style={{ ...styles.panel, ...styles.tree }}>
              <Tree nodes={tree} onOpen={(p) => void openFile(p)} />
            </div>
          )}
        </div>
        <div style={styles.center}>
          <div style={styles.tabs}>
            {tabs.map((t) => (
              <button key={t.path} style={{ ...styles.tab, ...(active === t.path ? styles.activeTab : {}) }} onClick={() => setActive(t.path)}>
                {t.path.split('/').pop()}{t.dirty ? ' •' : ''}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button style={styles.btn} onClick={() => void saveFile()}>Save (Ctrl+S)</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {active ? (
              <Editor
                height="100%"
                path={active}
                value={tabs.find((t) => t.path === active)?.content ?? ''}
                onChange={(v) => setTabs((ts) => ts.map((t) => (t.path === active ? { ...t, content: v ?? '', dirty: true } : t)))}
                options={{ minimap: { enabled: false }, fontSize: 13, find: { addExtraSpaceOnTop: false } }}
                onMount={(ed) => { ed.addCommand(2097 /* Ctrl+S */, () => void saveFile()); }}
              />
            ) : (
              <div style={{ padding: 24, opacity: 0.7 }}>Open a file from the explorer, or create a project via the API.</div>
            )}
          </div>
          <div style={styles.bottom}>
            <div style={styles.tabs}>
              <button style={{ ...styles.tab, ...(bottomTab === 'activity' ? styles.activeTab : {}) }} onClick={() => setBottomTab('activity')}>Agent activity</button>
              <button style={{ ...styles.tab, ...(bottomTab === 'terminal' ? styles.activeTab : {}) }} onClick={() => setBottomTab('terminal')}>Terminal</button>
              <button style={{ ...styles.tab, ...(bottomTab === 'problems' ? styles.activeTab : {}) }} onClick={() => setBottomTab('problems')}>Git</button>
            </div>
            {bottomTab === 'activity' && (
              <div style={{ ...styles.panel, fontSize: 12 }}>
                {activity.length === 0 ? <span style={{ opacity: 0.6 }}>No agent activity yet.</span> : activity.map((a, i) => <div key={i}>{a}</div>)}
              </div>
            )}
            {bottomTab === 'terminal' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', gap: 6, padding: 6 }}>
                  <button style={styles.btn} onClick={() => void runTerminal('npm', ['run', 'build'])}>npm run build</button>
                  <button style={styles.btn} onClick={() => void runTerminal('npm', ['test'])}>npm test</button>
                </div>
                <div ref={termRef} style={{ flex: 1, minHeight: 0, background: '#000' }} />
                <pre style={{ display: 'none' }}>{termText}</pre>
              </div>
            )}
            {bottomTab === 'problems' && (
              <div style={{ ...styles.panel, fontSize: 12, display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div><b>Branch:</b> {git.branch || '—'}</div>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{git.status || 'No git status.'}</pre>
                </div>
                <div style={{ flex: 1 }}>
                  <input style={{ ...styles.input, width: '100%', marginBottom: 6 }} placeholder="Commit message" value={git.message} onChange={(e) => setGit((g) => ({ ...g, message: e.target.value }))} aria-label="Commit message" />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.btn} onClick={() => void commit()}>Commit</button>
                    <button style={styles.btn} onClick={() => void api('/api/git/push', { method: 'POST' })}>Push</button>
                    <button style={styles.btn} onClick={() => void api('/api/git/pull', { method: 'POST' }).then(() => refresh())}>Pull</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={styles.right}>
          <div style={styles.tabs}>
            <span>Preview</span>
            <span style={{ flex: 1 }} />
            {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
              <button key={v} style={{ ...styles.tab, ...(viewport === v ? styles.activeTab : {}) }} onClick={() => setViewport(v)}>{v}</button>
            ))}
            <button style={styles.btn} onClick={() => void refresh()}>↻</button>
          </div>
          <div style={{ padding: 6, fontSize: 12, opacity: 0.8 }}>{preview ?? 'Preview not running — click Start preview.'}</div>
          <div style={{ flex: 1, background: '#fff', display: 'flex', justifyContent: 'center' }}>
            {preview ? (
              <iframe title="preview" src={preview} style={{ width: viewportWidth, height: '100%', border: 0, background: '#fff' }} />
            ) : (
              <div style={{ color: '#333', padding: 24 }}>No preview URL yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
