import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BuilderError, createLogger, redact } from '@builder/shared';
import type { BuilderConfig } from '@builder/config';
import { ProjectEngine } from '@builder/project-engine';
import { ProcessManager, findFreePort } from '@builder/process-manager';
import { AgentController } from '@builder/agent';
import { createProvider } from '@builder/model-gateway';
import { fileCredentialStore } from '@builder/credentials';
import { serializeEvent, type AgentEvent } from '@builder/protocol';
import { TOOL_DEFS, executeTool } from '@builder/agent-tools';

interface RuntimeOptions {
  config: BuilderConfig;
  webDistDir?: string;
  templatesDir: string;
}

const JSON_LIMIT = 2 * 1024 * 1024;

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Security-Policy': "default-src 'self'; frame-src http://127.0.0.1:* http://localhost:*; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(payload);
}

function sendErr(res: http.ServerResponse, e: unknown): void {
  if (e instanceof BuilderError) {
    sendJson(res, e.code === 'NOT_FOUND' ? 404 : e.code === 'PERMISSION_DENIED' ? 403 : e.code === 'AUTH_ERROR' ? 401 : e.code === 'VALIDATION_ERROR' ? 400 : 500,
      { error: e.code, message: e.message });
  } else {
    sendJson(res, 500, { error: 'INTERNAL', message: 'Internal error' });
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > JSON_LIMIT) { reject(new BuilderError('VALIDATION_ERROR', 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new BuilderError('VALIDATION_ERROR', 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function checkOrigin(req: http.IncomingMessage, _host: string, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin navigations / curl
  try {
    const u = new URL(origin);
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && allowed.has(`${u.hostname}:${u.port}`);
  } catch { return false; }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

export interface StartedRuntime {
  port: number;
  url: string;
  close: () => Promise<void>;
  engine: ProjectEngine;
  procs: ProcessManager;
  agent: AgentController;
}

export async function startRuntime(opts: RuntimeOptions): Promise<StartedRuntime> {
  const log = createLogger('runtime');
  const engine = new ProjectEngine();
  const procs = new ProcessManager();
  const subscribers = new Set<http.ServerResponse>();
  const emit = (e: AgentEvent) => {
    const line = `data: ${serializeEvent(e)}\n\n`;
    for (const res of subscribers) {
      try { res.write(line); } catch { /* drop */ }
    }
  };

  const provider = createProvider({
    provider: opts.config.provider,
    model: opts.config.model,
    baseUrl: (opts.config as unknown as Record<string, unknown>)['baseUrl'] as string | undefined,
    apiKey: await fileCredentialStore.get(opts.config.provider, 'api_key'),
  });
  const agent = new AgentController(provider, () => ({
    root: engine.requireRoot(),
    engine,
    procs,
    policy: opts.config.approvals,
    approvals: new Map(),
    emit: (m) => log.info('agent', { m }),
    githubToken: undefined,
  }), {
    maxIterations: opts.config.agent.maxIterations,
    maxToolCalls: opts.config.agent.maxToolCalls,
    runTimeoutMs: opts.config.agent.runTimeoutMs,
  });

  let port = await findFreePort(opts.config.serverPort, opts.config.host);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${opts.config.host}:${port}`);
      if (!checkOrigin(req, opts.config.host, port)) {
        sendJson(res, 403, { error: 'FORBIDDEN', message: 'Bad origin' });
        return;
      }
      const method = req.method ?? 'GET';
      const p = url.pathname;

      // --- health ---
      if (p === '/api/health' && method === 'GET') {
        sendJson(res, 200, { ok: true, version: '0.1.0', project: engine.root, processes: procs.list().length, provider: opts.config.provider, model: opts.config.model });
        return;
      }
      if (p === '/api/models' && method === 'GET') {
        sendJson(res, 200, { provider: opts.config.provider, model: opts.config.model, supported: ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'llamacpp', 'lmstudio', 'custom'] });
        return;
      }
      // --- SSE events ---
      if (p === '/api/events' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        subscribers.add(res);
        req.on('close', () => subscribers.delete(res));
        return;
      }
      // --- agent ---
      if (p === '/api/agent/run' && method === 'POST') {
        const body = (await readBody(req)) as { goal?: string; mode?: 'builder' | 'debugger' | 'architect' | 'reviewer' | 'exporter'; acceptanceCriteria?: string[] };
        if (!body.goal?.trim()) throw new BuilderError('VALIDATION_ERROR', 'goal is required');
        try { engine.requireRoot(); } catch { throw new BuilderError('VALIDATION_ERROR', 'Open or create a project first'); }
        const result = await agent.run({ goal: body.goal, mode: body.mode, acceptanceCriteria: body.acceptanceCriteria, onEvent: emit });
        sendJson(res, 200, result);
        return;
      }
      if (p === '/api/agent/interrupt' && method === 'POST') {
        const body = (await readBody(req)) as { runId?: string };
        if (body.runId) agent.interrupt(body.runId);
        sendJson(res, 200, { ok: true });
        return;
      }
      // --- project ---
      if (p === '/api/project' && method === 'GET') {
        try {
          sendJson(res, 200, { project: engine.root ? { root: engine.root } : null, inspection: engine.root ? await engine.inspectProject() : null });
        } catch (e) { sendErr(res, e); }
        return;
      }
      if (p === '/api/project/open' && method === 'POST') {
        const body = (await readBody(req)) as { path?: string };
        if (!body.path) throw new BuilderError('VALIDATION_ERROR', 'path is required');
        sendJson(res, 200, await engine.openProject(body.path));
        return;
      }
      if (p === '/api/project/create' && method === 'POST') {
        const body = (await readBody(req)) as { name?: string; directory?: string; template?: string };
        if (!body.name || !body.directory) throw new BuilderError('VALIDATION_ERROR', 'name and directory are required');
        const tpl = path.join(opts.templatesDir, body.template ?? 'react-vite-ts');
        sendJson(res, 200, await engine.createProject({ name: body.name, directory: body.directory, template: body.template ?? 'react-vite-ts' }, tpl));
        return;
      }
      // --- files ---
      if (p === '/api/files' && method === 'GET') {
        sendJson(res, 200, await engine.getTree());
        return;
      }
      if (p === '/api/file' && method === 'GET') {
        const rel = url.searchParams.get('path') ?? '';
        sendJson(res, 200, { path: rel, content: await engine.readFile(rel) });
        return;
      }
      if (p === '/api/file' && method === 'PUT') {
        const body = (await readBody(req)) as { path?: string; content?: string };
        if (!body.path) throw new BuilderError('VALIDATION_ERROR', 'path is required');
        await engine.writeFile(body.path, body.content ?? '');
        emit({ type: 'file.changed', runId: 'ui', at: Date.now(), data: { path: body.path } });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (p === '/api/file/patch' && method === 'POST') {
        const body = (await readBody(req)) as { path?: string; search?: string; replace?: string };
        if (!body.path || body.search === undefined || body.replace === undefined) throw new BuilderError('VALIDATION_ERROR', 'path/search/replace required');
        await engine.patchFile(body.path, { search: body.search, replace: body.replace });
        emit({ type: 'file.changed', runId: 'ui', at: Date.now(), data: { path: body.path } });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (p === '/api/file' && method === 'DELETE') {
        const rel = url.searchParams.get('path') ?? '';
        await engine.deleteFile(rel);
        sendJson(res, 200, { ok: true });
        return;
      }
      // --- tools passthrough (validated) ---
      if (p === '/api/tools' && method === 'GET') {
        sendJson(res, 200, TOOL_DEFS.map((t) => ({ name: t.name, description: t.description })));
        return;
      }
      // --- processes ---
      if (p === '/api/processes' && method === 'GET') { sendJson(res, 200, procs.list()); return; }
      if (p === '/api/process/start' && method === 'POST') {
        const body = (await readBody(req)) as { command?: string; args?: string[] };
        if (!body.command) throw new BuilderError('VALIDATION_ERROR', 'command is required');
        const { validateCommand } = await import('@builder/permissions');
        const v = validateCommand(body.command, body.args ?? [], engine.requireRoot(), engine.requireRoot());
        if (!v.ok) throw new BuilderError('PERMISSION_DENIED', v.reason ?? 'blocked');
        sendJson(res, 200, procs.start(body.command, body.args ?? [], engine.requireRoot(), { detectUrl: true }));
        return;
      }
      if ((p === '/api/process/stop' || p === '/api/process/restart') && method === 'POST') {
        const body = (await readBody(req)) as { id?: string };
        if (!body.id) throw new BuilderError('VALIDATION_ERROR', 'id is required');
        sendJson(res, 200, p.endsWith('stop') ? procs.stop(body.id) : procs.restart(body.id));
        return;
      }
      if (p === '/api/process/output' && method === 'GET') {
        sendJson(res, 200, { output: procs.output(url.searchParams.get('id') ?? '') });
        return;
      }
      // --- dev server shortcuts ---
      if (p === '/api/dev/start' && method === 'POST') {
        const out = await executeTool('start_dev_server', {}, toolCtx());
        sendJson(res, 200, out.result);
        return;
      }
      if (p === '/api/preview' && method === 'GET') {
        const out = await executeTool('get_preview_url', {}, toolCtx());
        sendJson(res, 200, { url: out.result });
        return;
      }
      // --- git ---
      if (p === '/api/git/status' && method === 'GET') { const o = await executeTool('git_status', {}, toolCtx()); sendJson(res, 200, { status: o.result }); return; }
      if (p === '/api/git/diff' && method === 'GET') { const o = await executeTool('git_diff', {}, toolCtx()); sendJson(res, 200, { diff: o.result }); return; }
      if (p === '/api/git/branch' && method === 'GET') { const o = await executeTool('git_branch', {}, toolCtx()); sendJson(res, 200, { branch: o.result }); return; }
      if (p === '/api/git/commit' && method === 'POST') {
        const body = (await readBody(req)) as { message?: string };
        const o = await executeTool('git_commit', { message: body.message ?? '' }, toolCtx());
        sendJson(res, 200, { result: o.result });
        return;
      }
      if (p === '/api/git/push' && method === 'POST') { const o = await executeTool('git_push', {}, toolCtx()); sendJson(res, 200, { result: o.result }); return; }
      if (p === '/api/git/pull' && method === 'POST') { const o = await executeTool('git_pull', {}, toolCtx()); sendJson(res, 200, { result: o.result }); return; }
      // --- github ---
      if (p === '/api/github/repositories' && method === 'GET') { const o = await executeTool('github_list_repositories', {}, toolCtx()); sendJson(res, 200, { repositories: o.result }); return; }
      if ((p === '/api/github/repository/create' || p === '/api/github/export') && method === 'POST') {
        const body = (await readBody(req)) as { name?: string; remoteUrl?: string };
        const o = p.endsWith('create')
          ? await executeTool('github_create_repository', { name: body.name ?? '' }, toolCtx())
          : await executeTool('github_export', { remoteUrl: body.remoteUrl ?? '' }, toolCtx());
        sendJson(res, 200, { result: o.result });
        return;
      }
      // --- config ---
      if (p === '/api/config' && method === 'GET') {
        sendJson(res, 200, redact(opts.config));
        return;
      }

      // --- static web UI ---
      if (opts.webDistDir && (method === 'GET')) {
        const rel = p === '/' ? '/index.html' : p;
        const file = path.normalize(path.join(opts.webDistDir, rel));
        if (!file.startsWith(path.normalize(opts.webDistDir))) { sendJson(res, 403, { error: 'FORBIDDEN' }); return; }
        let target = file;
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          target = path.join(opts.webDistDir, 'index.html'); // SPA fallback
        }
        if (fs.existsSync(target)) {
          const ext = path.extname(target).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
          fs.createReadStream(target).pipe(res);
          return;
        }
      }

      sendJson(res, 404, { error: 'NOT_FOUND', message: `No route ${method} ${p}` });
    } catch (e) {
      sendErr(res, e);
    }
  });

  function toolCtx() {
    return {
      root: engine.requireRoot(), engine, procs,
      policy: opts.config.approvals, approvals: new Map<string, boolean>(),
      emit: (m: string) => log.info('tool', { m }),
    };
  }

  await new Promise<void>((resolve) => server.listen(port, opts.config.host, resolve));
  // Source of truth: the actually-bound port (covers ephemeral port 0 and races).
  const addr = server.address() as import('node:net').AddressInfo | string | null;
  const boundPort = (addr && typeof addr === 'object' && typeof addr.port === 'number') ? addr.port : port;
  port = boundPort;
  const url = `http://${opts.config.host}:${boundPort}`;
  log.info('runtime listening', { url });

  // Best-effort self-check: confirm the server answers its own health endpoint.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    log.info('health self-check', { ok: res.ok, url: `${url}/api/health` });
  } catch (e) {
    log.info('health self-check failed (non-fatal)', { error: (e as Error).message });
  }

  const shutdown = async () => {
    procs.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  return {
    port: boundPort,
    url,
    close: shutdown,
    engine, procs, agent,
  };
}
