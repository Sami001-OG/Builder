export type AgentEventType =
  | 'agent.started' | 'agent.message' | 'agent.thinking_started' | 'tool.requested'
  | 'tool.started' | 'tool.completed' | 'file.changed' | 'process.started' | 'process.output'
  | 'process.failed' | 'preview.ready' | 'build.started' | 'build.failed' | 'build.succeeded'
  | 'agent.repairing' | 'agent.finished' | 'agent.error' | 'agent.interrupted';

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  at: number;
  data?: Record<string, unknown>;
}

export function makeEvent(type: AgentEventType, runId: string, data: Record<string, unknown> = {}): AgentEvent {
  return { type, runId, at: Date.now(), data };
}

export interface WsWire { event: AgentEventType; runId: string; data?: Record<string, unknown> }

export function serializeEvent(e: AgentEvent): string {
  return JSON.stringify({ event: e.type, runId: e.runId, at: e.at, data: e.data ?? {} });
}

export function parseWire(raw: string): WsWire | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o['event'] !== 'string') return null;
    return o as unknown as WsWire;
  } catch { return null; }
}
