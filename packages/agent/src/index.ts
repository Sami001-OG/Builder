import { createLogger, uid } from '@builder/shared';
import { AGENT_SYSTEM_PROMPT, type ModelProvider } from '@builder/model-gateway';
import { TOOL_DEFS, executeTool, type ToolContext } from '@builder/agent-tools';
import { makeEvent, type AgentEvent } from '@builder/protocol';

export type AgentState =
  | 'IDLE' | 'ANALYZE' | 'PLAN' | 'INSPECT' | 'BUILD' | 'RUN' | 'TEST'
  | 'REVIEW' | 'DEBUG' | 'DONE' | 'USER_ABORTED' | 'TIMEOUT' | 'BUDGET_EXCEEDED' | 'UNRECOVERABLE_ERROR';

export interface AgentRunOptions {
  goal: string;
  mode?: 'architect' | 'builder' | 'debugger' | 'reviewer' | 'exporter';
  acceptanceCriteria?: string[];
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}

export interface AgentRunResult {
  runId: string;
  state: AgentState;
  summary: string;
  toolCalls: number;
  iterations: number;
  model?: string;
  durationMs: number;
}

export interface AgentLimits { maxIterations: number; maxToolCalls: number; runTimeoutMs: number; }

export class AgentController {
  private log = createLogger('agent');
  private active = new Map<string, AbortController>();
  private txCounter = 0;

  constructor(
    private provider: ModelProvider,
    private toolCtx: () => ToolContext,
    private limits: AgentLimits = { maxIterations: 40, maxToolCalls: 120, runTimeoutMs: 900_000 },
  ) {}

  interrupt(runId: string): void {
    this.active.get(runId)?.abort();
  }

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const runId = uid('run');
    const started = Date.now();
    const aborter = new AbortController();
    this.active.set(runId, aborter);
    const onAbort = () => aborter.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const emit = (e: AgentEvent) => opts.onEvent?.(e);
    const txId = `TX-${++this.txCounter + 1000}`;
    let state: AgentState = 'ANALYZE';
    let iterations = 0;
    let toolCalls = 0;
    const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
      { role: 'user', content: `Goal: ${opts.goal}\nMode: ${opts.mode ?? 'builder'}\nAcceptance criteria:\n${(opts.acceptanceCriteria ?? ['app runs', 'no startup errors', 'build succeeds']).map((c) => `- ${c}`).join('\n')}\nTransaction: ${txId}` },
    ];
    const recentToolResults: string[] = [];

    const timer = setTimeout(() => aborter.abort(), this.limits.runTimeoutMs);
    emit(makeEvent('agent.started', runId, { goal: opts.goal, tx: txId }));
    try {
      while (true) {
        if (aborter.signal.aborted) { state = 'USER_ABORTED'; break; }
        if (iterations >= this.limits.maxIterations || toolCalls >= this.limits.maxToolCalls) { state = 'BUDGET_EXCEEDED'; break; }
        iterations++;
        state = nextState(state);
        emit(makeEvent('agent.thinking_started', runId, { state, iteration: iterations }));

        const stream = this.provider.generate({
          system: AGENT_SYSTEM_PROMPT,
          messages: history,
          tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
        }, { signal: aborter.signal });

        let acted = false;
        for await (const ev of stream) {
          if (aborter.signal.aborted) break;
          if (ev.type === 'text') {
            history.push({ role: 'assistant', content: ev.text });
            emit(makeEvent('agent.message', runId, { text: ev.text.slice(0, 2000) }));
          } else if (ev.type === 'tool') {
            toolCalls++;
            acted = true;
            const ctx = this.toolCtx();
            emit(makeEvent('tool.requested', runId, { tool: ev.call.tool }));
            emit(makeEvent('tool.started', runId, { tool: ev.call.tool }));
            try {
              const out = await executeTool(ev.call.tool, ev.call.input, ctx);
              recentToolResults.push(`${ev.call.tool}: ${JSON.stringify(out.result).slice(0, 1500)}`);
              emit(makeEvent('tool.completed', runId, { tool: ev.call.tool, ok: out.ok }));
              history.push({ role: 'user', content: `Tool ${ev.call.tool} result (ok=${out.ok}): ${JSON.stringify(out.result).slice(0, 4000)}` });
              if (ev.call.tool === 'finish_task') {
                state = 'DONE';
                break;
              }
              // auto-debug loop: build/test failure -> DEBUG state, feed error back
              if (!out.ok && (ev.call.tool === 'run_build' || ev.call.tool === 'run_tests' || ev.call.tool === 'run_command')) {
                state = 'DEBUG';
                emit(makeEvent('agent.repairing', runId, { from: ev.call.tool }));
                history.push({ role: 'user', content: 'The last step failed. Diagnose the exact error, locate file/line, patch minimally, then rebuild. Do not claim success until verification passes.' });
              }
            } catch (e) {
              const err = e as Error;
              emit(makeEvent('agent.error', runId, { tool: ev.call.tool, message: err.message.slice(0, 500) }));
              history.push({ role: 'user', content: `Tool ${ev.call.tool} error: ${err.message.slice(0, 2000)}. Adjust and retry (bounded).` });
              if ((e as { code?: string }).code === 'PERMISSION_DENIED') {
                history.push({ role: 'user', content: 'That action needs user approval. Explain what you want to do and continue with other safe steps.' });
              }
            }
            if (toolCalls >= this.limits.maxToolCalls) { state = 'BUDGET_EXCEEDED'; break; }
          }
        }
        if (state === 'DONE' || state === 'BUDGET_EXCEEDED' || state === 'USER_ABORTED') break;
        if (!acted) {
          // Model produced no tool call: nudge toward verification then finish.
          history.push({ role: 'user', content: 'If work remains, use tools to continue. Otherwise call finish_task with a summary only after verifying build/tests where applicable.' });
          if (iterations > 6 && recentToolResults.length === 0) { state = 'UNRECOVERABLE_ERROR'; break; }
        }
        if (state !== 'DEBUG') state = 'REVIEW';
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || aborter.signal.aborted) state = 'USER_ABORTED';
      else { state = 'UNRECOVERABLE_ERROR'; emit(makeEvent('agent.error', runId, { message: (e as Error).message.slice(0, 500) })); }
    } finally {
      clearTimeout(timer);
      this.active.delete(runId);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    const summary = `Run ${runId} ended in ${state} after ${iterations} iterations / ${toolCalls} tool calls.`;
    emit(makeEvent(state === 'DONE' ? 'agent.finished' : 'agent.interrupted', runId, { state, toolCalls, iterations }));
    this.log.info('agent run finished', { runId, state, iterations, toolCalls });
    return { runId, state, summary, toolCalls, iterations, durationMs: Date.now() - started };
  }
}

function nextState(s: AgentState): AgentState {
  switch (s) {
    case 'ANALYZE': return 'PLAN';
    case 'PLAN': return 'INSPECT';
    case 'INSPECT': return 'BUILD';
    case 'BUILD': return 'RUN';
    case 'RUN': return 'TEST';
    case 'TEST': return 'REVIEW';
    case 'DEBUG': return 'BUILD';
    default: return 'BUILD';
  }
}
