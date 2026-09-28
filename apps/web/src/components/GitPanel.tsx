import { ArrowDownToLine, ArrowUpFromLine, Check, GitBranch } from 'lucide-react';
import { api } from '../api';
import type { Builder } from '../hooks/useBuilder';

export default function GitPanel({ b }: { b: Builder }) {
  const commit = async () => {
    if (!b.git.message.trim()) return;
    try {
      await api('/api/git/commit', { method: 'POST', body: JSON.stringify({ message: b.git.message }) });
      b.setGit({ ...b.git, message: '' });
      void b.refreshGit();
      b.toast('Committed', 'info');
    } catch (e) {
      b.toast((e as Error).message, 'err');
    }
  };

  return (
    <div className="panel-body git">
      <div className="git-col">
        <div className="row"><GitBranch size={13} className="muted" /><strong>{b.git.branch || '—'}</strong></div>
        <pre className="git-status mono">{b.git.status || 'No git status.'}</pre>
      </div>
      <div className="git-col">
        <input
          className="input"
          placeholder="Commit message"
          value={b.git.message}
          onChange={(e) => b.setGit({ ...b.git, message: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit(); }}
          aria-label="Commit message"
        />
        <div className="row git-actions">
          <button className="btn btn-primary" onClick={() => void commit()} disabled={!b.git.message.trim()}>
            <Check size={13} />Commit
          </button>
          <button className="btn" onClick={() => void api('/api/git/push', { method: 'POST' }).then(() => b.refreshGit()).catch((e: Error) => b.toast(e.message, 'err'))}>
            <ArrowUpFromLine size={13} />Push
          </button>
          <button className="btn" onClick={() => void api('/api/git/pull', { method: 'POST' }).then(() => { void b.refresh(); void b.refreshGit(); }).catch((e: Error) => b.toast(e.message, 'err'))}>
            <ArrowDownToLine size={13} />Pull
          </button>
        </div>
      </div>
    </div>
  );
}
