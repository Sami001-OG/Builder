import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/motion.css';
import './app.css';
import { api } from './api';
import { useBuilder } from './hooks/useBuilder';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import EditorPane, { type Tab } from './components/EditorPane';
import BottomPanel from './components/BottomPanel';
import PreviewPane from './components/PreviewPane';
import CommandPalette, { type PaletteItem } from './components/CommandPalette';
import StatusBar from './components/StatusBar';
import ProjectDialog from './components/ProjectDialog';
import { AlertTriangle } from 'lucide-react';

function App() {
  const b = useBuilder();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [sideTab, setSideTab] = useState<'chat' | 'files'>('chat');
  const [bottomTab, setBottomTab] = useState<'activity' | 'terminal' | 'git'>('activity');
  const [paletteSeed, setPaletteSeed] = useState(0);
  const [showProject, setShowProject] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const xterm = useRef<Terminal | null>(null);
  void paletteSeed;

  // xterm terminal
  useEffect(() => {
    if (!termRef.current || xterm.current) return;
    const t = new Terminal({ convertEol: true, fontSize: 12, theme: { background: '#000000' } });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(termRef.current);
    fit.fit();
    xterm.current = t;
  });

  const openFile = async (p: string) => {
    try {
      const f = await api<{ content: string }>('/api/file?path=' + encodeURIComponent(p));
      setTabs((ts) => (ts.some((t) => t.path === p) ? ts : [...ts, { path: p, content: f.content, dirty: false }]));
      setActive(p);
    } catch (e) {
      b.toast((e as Error).message, 'err');
    }
  };

  const saveFile = async () => {
    const t = tabs.find((x) => x.path === active);
    if (!t) return;
    try {
      await api('/api/file', { method: 'PUT', body: JSON.stringify({ path: t.path, content: t.content }) });
      setTabs((ts) => ts.map((x) => (x.path === t.path ? { ...x, dirty: false } : x)));
      void b.refresh();
    } catch (e) {
      b.toast((e as Error).message, 'err');
    }
  };

  const closeTab = (p: string) => {
    setTabs((ts) => ts.filter((t) => t.path !== p));
    if (active === p) {
      setTabs((ts) => {
        const rest = ts.filter((t) => t.path !== p);
        setActive(rest.length ? rest[rest.length - 1].path : null);
        return ts.filter((t) => t.path !== p);
      });
    }
  };

  const runTerminal = async (command: string, args: string[] = []) => {
    setBottomTab('terminal');
    try {
      const p = await api<{ id: string }>('/api/process/start', { method: 'POST', body: JSON.stringify({ command, args }) });
      const poll = async () => {
        try {
          const o = await api<{ output: string }>(`/api/process/output?id=${p.id}`);
          xterm.current?.clear();
          xterm.current?.write(o.output.slice(-8000));
        } catch (e) {
          b.toast((e as Error).message, 'err');
        }
      };
      await poll();
      const iv = setInterval(() => { void poll(); }, 1500);
      setTimeout(() => clearInterval(iv), 60000);
    } catch (e) {
      b.toast((e as Error).message, 'err');
    }
  };

  const paletteItems: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [
      { id: 'preview', label: 'Start preview', hint: 'dev server', run: () => void b.startPreview() },
      { id: 'build', label: 'Run npm build', hint: 'terminal', run: () => void runTerminal('npm', ['run', 'build']) },
      { id: 'test', label: 'Run npm test', hint: 'terminal', run: () => void runTerminal('npm', ['test']) },
      { id: 'refresh', label: 'Refresh project', run: () => { void b.refresh(); void b.refreshGit(); } },
      { id: 'project', label: 'Create or open project…', run: () => setShowProject(true) },
      { id: 'stop', label: 'Stop agent', run: () => void b.stopAgent() },
    ];
    const walk = (ns: { path: string; type: string; children?: { path: string; type: string }[] }[]): { path: string; type: string }[] =>
      ns.flatMap((x) => [x, ...(x.children ? walk(x.children as { path: string; type: string }[]) : [])]);
    for (const n of walk(b.tree as { path: string; type: string; children?: { path: string; type: string }[] }[])) {
      if (n.type === 'file') {
        items.push({ id: `open:${n.path}`, label: `Open ${n.path}`, hint: 'file', run: () => { setSideTab('files'); void openFile(n.path); } });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.tree, b.running, paletteSeed]);

  // Cmd+S saves, sidebar toggle shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveFile(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, active]);

  return (
    <div className="app">
      <TopBar b={b} onOpenProject={() => setShowProject(true)} />
      <div className="main">
        <Sidebar b={b} tab={sideTab} setTab={setSideTab} onOpen={(p) => void openFile(p)}
          prompt={prompt} setPrompt={setPrompt} onProjectAction={() => setShowProject(true)} />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <EditorPane tabs={tabs} active={active} setActive={setActive}
              setTabs={setTabs} onSave={() => void saveFile()} onClose={closeTab} />
            <PreviewPane b={b} viewport={viewport} setViewport={setViewport} />
          </div>
          <BottomPanel b={b} tab={bottomTab} setTab={setBottomTab} termRef={termRef}
            onBuild={() => void runTerminal('npm', ['run', 'build'])}
            onTest={() => void runTerminal('npm', ['test'])} />
        </div>
      </div>
      <StatusBar b={b} />
      <CommandPalette items={paletteItems} />
      {showProject && <ProjectDialog b={b} onClose={() => setShowProject(false)} />}
      <div className="toast-stack" aria-live="polite">
        {b.toasts.map((t) => (
          <div key={t.id} className={`toast anim-toast${t.kind === 'err' ? ' toast-err' : ''}`}>
            {t.kind === 'err' && <AlertTriangle size={14} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
