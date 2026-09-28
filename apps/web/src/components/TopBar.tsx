import { ExternalLink, GitBranch, Hammer, Play, RefreshCw } from 'lucide-react';
import type { Builder } from '../hooks/useBuilder';

export default function TopBar({ b, onOpenProject }: { b: Builder; onOpenProject: () => void }) {
  return (
    <header className="topbar anim-fade">
      <div className="topbar-brand">
        <span className="brand-mark"><Hammer size={15} /></span>
        <strong>Builder</strong>
      </div>
      <span className="muted topbar-sub">
        {b.insp ? `${b.insp.name} · ${b.insp.framework} · ${b.insp.packageManager}` : 'no project open'}
      </span>
      {b.git.branch && (
        <span className="pill"><GitBranch size={11} />{b.git.branch}</span>
      )}
      {b.running && <span className="pill pill-run"><span className="dot pulse" />agent running</span>}
      <span className="grow" />
      <button className="btn btn-ghost" onClick={() => { void b.refresh(); void b.refreshGit(); }} title="Refresh">
        <RefreshCw size={14} />Refresh
      </button>
      {!b.insp && (
        <button className="btn btn-primary" onClick={onOpenProject}>Open project</button>
      )}
      <button className="btn" onClick={() => void b.startPreview()} title="Start dev server preview">
        <Play size={14} />Start preview
      </button>
      <button className="btn btn-ghost" disabled={!b.preview} onClick={() => b.preview && window.open(b.preview, '_blank')} title="Open preview in new tab">
        <ExternalLink size={14} />
      </button>
    </header>
  );
}
