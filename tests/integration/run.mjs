// Integration tests: real local server, filesystem, process manager,
// project engine, git ops, model adapters with mock fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { pathToFileURL } = await import('node:url');
const imp = (p) => import(pathToFileURL(p).href);
const { loadConfig } = await imp(`${ROOT}/packages/config/dist/index.js`);
const { startRuntime } = await imp(`${ROOT}/packages/runtime/dist/index.js`);
const { ProcessManager } = await imp(`${ROOT}/packages/process-manager/dist/index.js`);
const { ProjectEngine, detectPackageManager } = await imp(`${ROOT}/packages/project-engine/dist/index.js`);
const gw = await imp(`${ROOT}/packages/model-gateway/dist/index.js`);

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'builder-int-')); }

test('filesystem + project engine round-trip', async () => {
  const dir = tmp();
  const eng = new ProjectEngine();
  const tpl = path.join(ROOT, 'templates/react-vite-ts');
  const proj = await eng.createProject({ name: 'demo', directory: dir, template: 'react-vite-ts' }, tpl);
  assert.ok(fs.existsSync(path.join(proj.root, 'src/App.tsx')));
  const insp = await eng.inspectProject();
  assert.equal(insp.framework, 'vite-react');
  assert.equal(detectPackageManager(proj.root), 'npm');
  await eng.writeFile('src/New.ts', 'export const x = 1;\n');
  assert.match(await eng.readFile('src/New.ts'), /export const x/);
  await eng.patchFile('src/New.ts', { search: 'export const x = 1;', replace: 'export const x = 2;' });
  assert.match(await eng.readFile('src/New.ts'), /x = 2/);
  // boundary: traversal blocked
  await assert.rejects(() => eng.readFile('../../etc/passwd'), /escapes|FILESYSTEM/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('process manager start/stop/output', async () => {
  const procs = new ProcessManager();
  const p = procs.start(process.execPath, ['-e', 'console.log("hello"); setTimeout(()=>{}, 200);'], process.cwd());
  await new Promise((r) => setTimeout(r, 800));
  assert.match(procs.output(p.id), /hello/);
  procs.stop(p.id);
  const after = procs.get(p.id);
  assert.ok(['stopped', 'failed'].includes(after.status));
  procs.stopAll();
});

test('local server + websocket(SSE)/health/project/files', async () => {
  const cfg = loadConfig({ serverPort: 45273, openBrowser: false });
  const rt = await startRuntime({ config: cfg, webDistDir: undefined, templatesDir: path.join(ROOT, 'templates') });
  try {
    const h = await (await fetch(`${rt.url}/api/health`)).json();
    assert.equal(h.ok, true);
    // SSE connects
    const ctrl = new AbortController();
    const sse = await fetch(`${rt.url}/api/events`, { signal: ctrl.signal });
    assert.equal(sse.status, 200);
    ctrl.abort();
    // create project via API
    const dir = tmp();
    const created = await (await fetch(`${rt.url}/api/project/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'web1', directory: dir, template: 'react-vite-ts' }),
    })).json();
    assert.ok(created.root);
    const tree = await (await fetch(`${rt.url}/api/files`)).json();
    assert.ok(Array.isArray(tree));
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    await rt.close();
  }
});

test('git operations in temp repo', async () => {
  const dir = tmp();
  const { execFile } = await import('node:child_process');
  const sh = (a) => new Promise((res, rej) => execFile('git', a, { cwd: dir }, (e, so, se) => e ? rej(new Error(se)) : res(so)));
  await sh(['init', '-b', 'main']);
  await sh(['config', 'user.email', 't@t.t']);
  await sh(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hi\n');
  const git = await imp(`${ROOT}/packages/git/dist/index.js`);
  await git.commit(dir, 'init');
  assert.match(await git.status(dir), /nothing to commit| /);
  assert.match(await git.log(dir), /init/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('model adapters with mocked fetch', async () => {
  const okFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { status: 200 });
  const p = new gw.OpenAICompatibleProvider({ provider: 'ollama', model: 'm', baseUrl: 'http://x' });
  const seen = [];
  for await (const e of p.generate({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }, { fetchFn: okFetch })) seen.push(e);
  assert.ok(seen.some((e) => e.type === 'text'));
  const toolFetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"a"}' } }] } }] }), { status: 200 });
  const seen2 = [];
  for await (const e of p.generate({ system: 's', messages: [], tools: [{ name: 'read_file', description: 'r', parameters: {} }] }, { fetchFn: toolFetch })) seen2.push(e);
  assert.ok(seen2.some((e) => e.type === 'tool'));
  const authFetch = async () => new Response('no', { status: 401 });
  await assert.rejects(async () => { for await (const _ of p.generate({ system: '', messages: [], tools: [] }, { fetchFn: authFetch })) { /* noop */ } }, /auth/i);
});
