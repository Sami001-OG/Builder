import { CircleCheck, Loader2, MonitorPlay, XCircle } from 'lucide-react';
import type { Builder } from '../hooks/useBuilder';

export default function StatusBar({ b }: { b: Builder }) {
  return (
    <footer className="statusbar">
      <span className="status-item mono">
        {b.config ? `${b.config.provider} · ${b.config.model}` : '…'}
      </span>
      <span className="status-item">
        {b.running ? (
          <><Loader2 size={11} className="spin" />agent running</>
        ) : b.activity.length > 0 ? (
          <><CircleCheck size={11} className="ok-ic" />agent idle</>
        ) : (
          <><XCircle size={11} className="muted" />agent idle</>
        )}
      </span>
      <span className="grow" />
      <span className="status-item mono">
        {b.preview ? <><MonitorPlay size={11} className="ok-ic" />{b.preview}</> : 'preview off'}
      </span>
    </footer>
  );
}
