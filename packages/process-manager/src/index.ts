import { spawn, type ChildProcess } from 'node:child_process';
import { BuilderError, createLogger, uid } from '@builder/shared';

export type ProcStatus = 'starting' | 'running' | 'stopped' | 'failed';
export interface ManagedProcess {
  id: string; pid?: number; command: string; args: string[]; cwd: string;
  status: ProcStatus; startedAt?: number; exitCode?: number;
  output: string; previewUrl?: string;
}

const MAX_OUTPUT = 200_000;

export class ProcessManager {
  private procs = new Map<string, { proc: ManagedProcess; child?: ChildProcess }>();
  private log = createLogger('process-manager');

  list(): ManagedProcess[] { return [...this.procs.values()].map((p) => ({ ...p.proc })); }
  get(id: string): ManagedProcess {
    const p = this.procs.get(id);
    if (!p) throw new BuilderError('NOT_FOUND', `Process not found: ${id}`);
    return { ...p.proc };
  }
  output(id: string, tail = 4000): string {
    const p = this.get(id);
    return p.output.slice(-tail);
  }

  start(command: string, args: string[], cwd: string, opts: { timeoutMs?: number; onOutput?: (chunk: string) => void; detectUrl?: boolean } = {}): ManagedProcess {
    const id = uid('proc');
    const rec: ManagedProcess = { id, command, args, cwd, status: 'starting', startedAt: Date.now(), output: '' };
    // Never use shell:true with an args array (splits on spaces in exe paths,
    // DEP0190). Quote the command for Windows instead.
    const needsShell = process.platform === 'win32' && /[^a-zA-Z0-9_\\/:.-]/.test(command);
    const child = needsShell
      ? spawn(`"${command}"`, args, { cwd, shell: true, windowsHide: true })
      : spawn(command, args, { cwd, shell: false, windowsHide: true });
    rec.pid = child.pid;
    rec.status = 'running';
    this.procs.set(id, { proc: rec, child });
    this.log.info('process started', { id, command, args, cwd, pid: child.pid });

    const append = (chunk: string) => {
      rec.output = (rec.output + chunk).slice(-MAX_OUTPUT);
      opts.onOutput?.(chunk);
      if (opts.detectUrl && !rec.previewUrl) {
        const m = rec.output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)[\w\-./?#]*/);
        if (m) rec.previewUrl = m[0];
      }
    };
    child.stdout?.on('data', (d) => append(String(d)));
    child.stderr?.on('data', (d) => append(String(d)));
    child.on('exit', (code) => {
      rec.exitCode = code ?? undefined;
      rec.status = code === 0 ? 'stopped' : 'failed';
      this.log.info('process exited', { id, code });
    });
    child.on('error', (e) => {
      rec.status = 'failed';
      append(`\n[process error] ${e.message}\n`);
    });
    if (opts.timeoutMs) {
      setTimeout(() => {
        if (rec.status === 'running') { this.stop(id); rec.status = 'failed'; }
      }, opts.timeoutMs).unref?.();
    }
    return { ...rec };
  }

  stop(id: string): ManagedProcess {
    const entry = this.procs.get(id);
    if (!entry) throw new BuilderError('NOT_FOUND', `Process not found: ${id}`);
    try {
      if (entry.child && entry.child.exitCode === null) {
        if (process.platform === 'win32') entry.child.kill();
        else {
          // kill process group to avoid orphaned dev servers
          try { process.kill(-(entry.child.pid as number), 'SIGTERM'); }
          catch { entry.child.kill('SIGTERM'); }
          setTimeout(() => { try { entry.child?.kill('SIGKILL'); } catch { /* already dead */ } }, 3000).unref?.();
        }
      }
    } catch { /* already exited */ }
    entry.proc.status = 'stopped';
    return { ...entry.proc };
  }

  restart(id: string): ManagedProcess {
    const cur = this.get(id);
    try { this.stop(id); } catch { /* ignore */ }
    this.procs.delete(id);
    return this.start(cur.command, cur.args, cur.cwd, { detectUrl: true });
  }

  stopAll(): void {
    for (const id of [...this.procs.keys()]) {
      try { this.stop(id); } catch { /* ignore */ }
    }
  }
}

export async function findFreePort(start: number, host = '127.0.0.1'): Promise<number> {
  const net = await import('node:net');
  for (let port = start; port < start + 100; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(port, host, () => s.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new BuilderError('INTERNAL', `No free port found from ${start}`);
}
