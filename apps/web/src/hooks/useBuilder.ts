import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FileNode, type Inspection } from '../api';

export interface ChatMsg { id: number; role: 'user' | 'assistant'; text: string; streaming?: boolean }
export interface Toast { id: number; text: string; kind: 'err' | 'info' }
export interface GitState { branch: string; status: string; message: string }

export function useBuilder() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [config, setConfig] = useState<{ provider: string; model: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const msgId = useRef(0);
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const refresh = useCallback(async () => {
    try { setTree(await api<FileNode[]>('/api/files')); } catch { /* no project yet */ }
    try {
      const p = await api<{ inspection: Inspection | null }>('/api/project');
      setInsp(p.inspection);
    } catch { /* ignore */ }
    try {
      const c = await api<{ provider: string; model: string }>('/api/config');
      setConfig({ provider: c.provider, model: c.model });
    } catch { /* ignore */ }
    try {
      const pv = await api<{ url: string | null }>('/api/preview');
      setPreview(pv.url);
    } catch { /* ignore */ }
  }, []);

  const [git, setGit] = useState<GitState>({ branch: '', status: '', message: '' });
  const refreshGit = useCallback(async () => {
    try {
      const g = await api<{ status: string }>('/api/git/status');
      setGit((p) => ({ ...p, status: String(g.status).slice(0, 4000) }));
    } catch { /* not a git repo */ }
    try {
      const b = await api<{ branch: string }>('/api/git/branch');
      setGit((p) => ({ ...p, branch: String(b.branch) }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); void refreshGit(); }, [refresh, refreshGit]);

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
        if (data.event === 'agent.finished' || data.event === 'agent.interrupted') { setRunning(false); void refresh(); void refreshGit(); }
      } catch { /* ignore */ }
    };
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, [refresh, refreshGit]);

  const sendPrompt = useCallback(async (text: string) => {
    if (!text.trim() || running) return;
    setRunning(true);
    setMsgs((m) => [...m, { id: ++msgId.current, role: 'user', text }]);
    const aid = ++msgId.current;
    setMsgs((m) => [...m, { id: aid, role: 'assistant', text: 'Working…', streaming: true }]);
    try {
      const r = await api<{ runId: string; state: string; summary: string }>('/api/agent/run', {
        method: 'POST',
        body: JSON.stringify({ goal: text, mode: 'builder' }),
      });
      setRunId(r.runId);
      setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: `${r.state}: ${r.summary}`, streaming: false } : x)));
      setRunning(false);
    } catch (e) {
      const msg = (e as Error).message;
      setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: `Error: ${msg}`, streaming: false } : x)));
      toast(msg, 'err');
      setRunning(false);
    }
  }, [running, toast]);

  const stopAgent = useCallback(async () => {
    if (runId) await api('/api/agent/interrupt', { method: 'POST', body: JSON.stringify({ runId }) }).catch(() => undefined);
    setRunning(false);
  }, [runId]);

  const startPreview = useCallback(async () => {
    try {
      await api('/api/dev/start', { method: 'POST' });
      setTimeout(() => void refresh(), 4000);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }, [refresh, toast]);

  return {
    tree, insp, config, preview, activity, msgs, running, git, toasts,
    refresh, refreshGit, sendPrompt, stopAgent, startPreview, setGit, toast,
  };
}

export type Builder = ReturnType<typeof useBuilder>;
