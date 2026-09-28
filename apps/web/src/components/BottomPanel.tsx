import { useEffect, useRef } from 'react';
import { Activity, GitBranch, SquareTerminal } from 'lucide-react';
import type { Builder } from '../hooks/useBuilder';
import GitPanel from './GitPanel';

export default function BottomPanel({
  b, tab, setTab, termRef, onBuild, onTest,
}: {
  b: Builder;
  tab: 'activity' | 'terminal' | 'git';
  setTab: (t: 'activity' | 'terminal' | 'git') => void;
  termRef: React.RefObject<HTMLDivElement>;
  onBuild: () => void;
  onTest: () => void;
}) {
  const actRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = actRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [b.activity]);

  return (
    <div className="panel bottom">
      <div className="panel-head">
        <button className={`tab${tab === 'activity' ? ' tab-active' : ''}`} onClick={() => setTab('activity')}>
          <Activity size={13} />Agent activity
          {b.running && <span className="dot pulse" />}
        </button>
        <button className={`tab${tab === 'terminal' ? ' tab-active' : ''}`} onClick={() => setTab('terminal')}>
          <SquareTerminal size={13} />Terminal
        </button>
        <button className={`tab${tab === 'git' ? ' tab-active' : ''}`} onClick={() => setTab('git')}>
          <GitBranch size={13} />Git
        </button>
      </div>
      {tab === 'activity' && (
        <div ref={actRef} className="panel-body activity mono">
          {b.activity.length === 0 ? (
            <span className="muted">No agent activity yet — send a prompt to watch the build unfold.</span>
          ) : (
            b.activity.map((a, i) => <div key={i} className="activity-line anim-fade">{a}</div>)
          )}
        </div>
      )}
      {tab === 'terminal' && (
        <div className="terminal-wrap">
          <div className="terminal-actions">
            <button className="btn btn-ghost" onClick={onBuild}>npm run build</button>
            <button className="btn btn-ghost" onClick={onTest}>npm test</button>
          </div>
          <div ref={termRef} className="terminal" />
        </div>
      )}
      {tab === 'git' && <GitPanel b={b} />}
    </div>
  );
}
