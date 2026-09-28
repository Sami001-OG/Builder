import { Monitor, Play, RotateCw, Smartphone, Tablet } from 'lucide-react';
import type { Builder } from '../hooks/useBuilder';

type Viewport = 'desktop' | 'tablet' | 'mobile';

export default function PreviewPane({
  b, viewport, setViewport,
}: {
  b: Builder;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}) {
  const width = viewport === 'mobile' ? 390 : viewport === 'tablet' ? 820 : '100%';
  return (
    <aside className="panel preview">
      <div className="panel-head">
        <span className="panel-title">Preview</span>
        <span className="grow" />
        {(['desktop', 'tablet', 'mobile'] as const).map((v) => (
          <button
            key={v}
            className={`tab${viewport === v ? ' tab-active' : ''}`}
            onClick={() => setViewport(v)}
            title={`${v} viewport`}
            aria-label={`${v} viewport`}
          >
            {v === 'desktop' ? <Monitor size={13} /> : v === 'tablet' ? <Tablet size={13} /> : <Smartphone size={13} />}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={() => void b.refresh()} title="Reload preview state">
          <RotateCw size={13} />
        </button>
      </div>
      <div className="preview-url mono muted">{b.preview ?? 'Preview not running'}</div>
      <div className="preview-stage">
        {b.preview ? (
          <iframe key={b.preview} title="preview" src={b.preview} className="preview-frame" style={{ width }} />
        ) : (
          <div className="empty anim-fade">
            <Monitor size={24} className="muted" />
            <p>No preview URL yet.</p>
            <button className="btn btn-primary" onClick={() => void b.startPreview()}>
              <Play size={13} />Start preview
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
