import { useState } from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { api } from '../api';
import type { Builder } from '../hooks/useBuilder';

const TEMPLATES = [
  { id: 'react-vite-ts', label: 'React + Vite + TS', desc: 'Minimal TypeScript starter' },
  { id: 'react-vite-tailwind', label: 'React + Vite + Tailwind', desc: 'Styled starter with Tailwind' },
];

export default function ProjectDialog({ b, onClose }: { b: Builder; onClose: () => void }) {
  const [mode, setMode] = useState<'choose' | 'create' | 'open'>('choose');
  const [name, setName] = useState('my-app');
  const [directory, setDirectory] = useState('');
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || !directory.trim() || busy) return;
    setBusy(true);
    try {
      await api('/api/project/create', { method: 'POST', body: JSON.stringify({ name, directory, template }) });
      await b.refresh();
      b.toast(`Project ${name} created`, 'info');
      onClose();
    } catch (e) {
      b.toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!directory.trim() || busy) return;
    setBusy(true);
    try {
      await api('/api/project/open', { method: 'POST', body: JSON.stringify({ path: directory }) });
      await b.refresh();
      onClose();
    } catch (e) {
      b.toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-overlay anim-fade" onClick={onClose}>
      <div className="dialog anim-rise" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Project setup">
        <h2 className="dialog-title">Set up your project</h2>
        {mode === 'choose' && (
          <div className="dialog-choices">
            <button className="choice" onClick={() => setMode('create')}>
              <Plus size={18} />
              <span><strong>Create new</strong><br /><span className="muted">Scaffold from a template</span></span>
            </button>
            <button className="choice" onClick={() => setMode('open')}>
              <FolderOpen size={18} />
              <span><strong>Open existing</strong><br /><span className="muted">Point at a folder on disk</span></span>
            </button>
          </div>
        )}
        {mode === 'create' && (
          <div className="dialog-form">
            <label>Template
              <div className="dialog-choices">
                {TEMPLATES.map((t) => (
                  <button key={t.id} className={`choice${template === t.id ? ' choice-sel' : ''}`} onClick={() => setTemplate(t.id)}>
                    <span><strong>{t.label}</strong><br /><span className="muted">{t.desc}</span></span>
                  </button>
                ))}
              </div>
            </label>
            <label>Project name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Parent directory<input className="input mono" value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="C:\code or /home/you/code" /></label>
            <div className="row dialog-actions">
              <button className="btn btn-ghost" onClick={() => setMode('choose')}>Back</button>
              <span className="grow" />
              <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !name.trim() || !directory.trim()}>
                {busy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>
        )}
        {mode === 'open' && (
          <div className="dialog-form">
            <label>Project folder<input className="input mono" value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="Absolute path on this machine" /></label>
            <div className="row dialog-actions">
              <button className="btn btn-ghost" onClick={() => setMode('choose')}>Back</button>
              <span className="grow" />
              <button className="btn btn-primary" onClick={() => void open()} disabled={busy || !directory.trim()}>
                {busy ? 'Opening…' : 'Open project'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
