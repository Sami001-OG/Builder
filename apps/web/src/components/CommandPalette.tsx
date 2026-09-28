import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'lucide-react';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function fuzzy(q: string, s: string): boolean {
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (const ch of s) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setSel(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open ]);

  const filtered = useMemo(() => items.filter((i) => fuzzy(q, i.label)), [items, q]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;
  const go = (i: PaletteItem) => { setOpen(false); i.run(); };

  return (
    <div className="palette-overlay anim-fade" onClick={() => setOpen(false)}>
      <div className="palette anim-rise" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input-row">
          <Command size={15} className="muted" />
          <input
            ref={inputRef}
            className="palette-input"
            role="textbox"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && filtered[sel]) go(filtered[sel]);
            }}
            placeholder="Type a command or search files…"
            aria-label="Command palette"
          />
        </div>
        <div className="palette-list">
          {filtered.length === 0 && <div className="muted palette-empty">No matches</div>}
          {filtered.slice(0, 12).map((i, idx) => (
            <button key={i.id} className={`palette-item${idx === sel ? ' palette-sel' : ''}`}
              onMouseEnter={() => setSel(idx)} onClick={() => go(i)}>
              <span>{i.label}</span>
              {i.hint && <span className="muted mono palette-hint">{i.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
