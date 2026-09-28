// Shared UI helpers (framework-agnostic formatting). The web app implements
// the actual React components; this package holds types both sides agree on.
export interface ChatMessage { id: string; role: 'user' | 'assistant' | 'system'; text: string; at: number; }
export interface ToolActivity { id: string; tool: string; status: 'requested' | 'started' | 'completed' | 'failed'; detail?: string; at: number; }
export interface PreviewState { url: string | null; status: 'idle' | 'starting' | 'ready' | 'crashed' | 'error'; message?: string; }
export interface GitUiState { branch: string; status: string; diff: string; message: string; }
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
