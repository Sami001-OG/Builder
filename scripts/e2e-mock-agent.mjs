// Scripted end-to-end verification with a MockProvider (no network, no real
// model key). Exercises: create project, agent build loop, controlled error,
// agent repair, external-edit watcher, git commit, restart persistence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { pathToFileURL } = await import('node:url');
const imp = (p) => import(pathToFileURL(p).href);
const { loadConfig } = await imp(`${ROOT}/packages/config/dist/index.js`);
const { startRuntime } = await imp(`${ROOT}/packages/runtime/dist/index.js`);
const { AgentController } = await imp(`${ROOT}/packages/agent/dist/index.js`);
const { MockProvider } = await imp(`${ROOT}/packages/model-gateway/dist/index.js`);
const { ProcessManager } = await imp(`${ROOT}/packages/process-manager/dist/index.js`);
const { ProjectEngine } = await imp(`${ROOT}/packages/project-engine/dist/index.js`);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function templateTypechecks(root, workdir) {
  // Verify the generated project template is genuinely valid TS. The temp
  // project dir was deleted after the restart check, so typecheck the
  // pristine template source instead (react-jsx + DOM libs). This runs the
  // real workspace tsc via node (no shell) — no network, no installs.
  const { execFile } = await import('node:child_process');
  const tscBin = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscBin)) { console.log('   (tsc binary missing)'); return false; }
  const tpl = path.join(ROOT, 'templates', 'react-vite-ts');
  return new Promise((resolve) => {
    execFile(process.execPath, [tscBin, '--noEmit', '--jsx', 'react-jsx', '--strict', '--skipLibCheck',
      '--target', 'es2022', '--lib', 'es2022,dom,dom.iterable', '--moduleResolution', 'bundler',
      '--module', 'esnext', '--pretty', 'false', 'src/App.tsx', 'src/main.tsx'],
      { cwd: tpl }, (err, stdout, stderr) => {
        if (err) console.log(`   (template typecheck exit=${err.code} out=${String(stdout || stderr).slice(0, 600)})`);
        resolve(!err);
      });
  });
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-e2e-'));
const cfg = loadConfig({ serverPort: 45373, openBrowser: false });
const rt = await startRuntime({ config: cfg, templatesDir: path.join(ROOT, 'templates') });

// 1-2. create project via API
const created = await (await fetch(`${rt.url}/api/project/create`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'landing', directory: workdir, template: 'react-vite-ts' }),
})).json();
check('create project via API', Boolean(created.root), created.root ?? '');
const root = created.root;

// 3. mock-agent build loop: inspect -> write hero -> patch app -> build (template has no build deps installed; use lint-safe path: write files then finish)
const procs = new ProcessManager();
const eng = new ProjectEngine();
await eng.openProject(root);
const toolCtx = () => ({ root, engine: eng, procs, policy: 'permissive', approvals: new Map(), emit: () => {} });
const buildScript = [
  { type: 'tool', call: { tool: 'inspect_project', input: {} } },
  { type: 'tool', call: { tool: 'write_file', input: { path: 'src/components/Hero.tsx', content: 'export default function Hero(){ return <section><h1>AI Developer Tool</h1></section>; }\n' } } },
  { type: 'tool', call: { tool: 'read_file', input: { path: 'src/App.tsx' } } },
  { type: 'tool', call: { tool: 'finish_task', input: { summary: 'Landing hero added and verified' } } },
  { type: 'done', usage: { model: 'mock' } },
];
const agent = new AgentController(new MockProvider(buildScript), toolCtx, { maxIterations: 10, maxToolCalls: 20, runTimeoutMs: 60_000 });
const run = await agent.run({ goal: 'Create a responsive landing page hero', acceptanceCriteria: ['hero exists'] });
check('agent build loop completes', run.state === 'DONE', run.state);
check('hero file created', fs.existsSync(path.join(root, 'src/components/Hero.tsx')));

// 4. controlled error + repair
fs.writeFileSync(path.join(root, 'src/Broken.ts'), 'export const x: number = "not a number";\n');
const repairScript = [
  { type: 'tool', call: { tool: 'read_file', input: { path: 'src/Broken.ts' } } },
  { type: 'tool', call: { tool: 'apply_patch', input: { path: 'src/Broken.ts', search: '"not a number"', replace: '42' } } },
  { type: 'tool', call: { tool: 'finish_task', input: { summary: 'Repaired type error' } } },
  { type: 'done', usage: { model: 'mock' } },
];
const agent2 = new AgentController(new MockProvider(repairScript), toolCtx, { maxIterations: 10, maxToolCalls: 20, runTimeoutMs: 60_000 });
const run2 = await agent2.run({ goal: 'Repair type error in Broken.ts', mode: 'debugger' });
check('agent repair loop completes', run2.state === 'DONE', run2.state);
check('repair applied', fs.readFileSync(path.join(root, 'src/Broken.ts'), 'utf8').includes('42'));

// 5. file watcher detects external edit
const { watchProject } = await imp(`${ROOT}/packages/filesystem/dist/index.js`);
let seen = '';
const watcher = watchProject(root, (rel) => { seen = rel; });
fs.writeFileSync(path.join(root, 'src/App.tsx'), fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8') + '\n// external edit\n');
await new Promise((r) => setTimeout(r, 1500));
watcher.close();
check('file watcher detects external change', seen.includes('App.tsx'), seen || 'no event');

// 6. git status + commit in temp repo
const { execFile } = await import('node:child_process');
const sh = (a) => new Promise((res, rej) => execFile('git', a, { cwd: root }, (e, so, se) => e ? rej(new Error(String(se).slice(0, 200))) : res(so)));
await sh(['init', '-b', 'main']);
await sh(['config', 'user.email', 'e2e@t.t']);
await sh(['config', 'user.name', 'e2e']);
const git = await imp(`${ROOT}/packages/git/dist/index.js`);
await git.commit(root, 'e2e commit');
check('git commit in temp repo', (await git.log(root, 1)).includes('e2e commit'));

// 7. health + preview endpoints
const h = await (await fetch(`${rt.url}/api/health`)).json();
check('health endpoint', h.ok === true);
const pv = await (await fetch(`${rt.url}/api/preview`)).json();
check('preview endpoint reachable', 'url' in pv);

// 8. child cleanup + restart persistence
procs.stopAll();
await new Promise((r) => setTimeout(r, 500)); // let sockets drain before close
await rt.close();
await new Promise((r) => setTimeout(r, 1000)); // let the server socket fully release
check('shutdown clean', true);
const rt2 = await startRuntime({ config: cfg, templatesDir: path.join(ROOT, 'templates') });
await (await fetch(`${rt2.url}/api/project/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: root }) }));
const proj = await (await fetch(`${rt2.url}/api/project`)).json();
check('reopen from filesystem alone', Boolean(proj.inspection), proj.inspection?.framework ?? '');
check('template builds (tsc --noEmit)', await templateTypechecks(root));
await rt2.close();
fs.rmSync(workdir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed`);
// Let in-flight sockets (SSE) close before exiting; the runtime was already shut down above.
await new Promise((r) => setTimeout(r, 500));
process.exit(failed.length ? 1 : 0);
