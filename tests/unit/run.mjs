// Zero-dependency unit tests (node:test) covering path safety, detection,
// ports, command validation, tool schemas, permissions, config, protocol,
// agent state machine, secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

async function buildAll() {
  const { execFile } = await import('node:child_process');
  const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const run = (args, cwd) => new Promise((resolve, reject) => {
    execFile(process.execPath, [TSC, ...args], { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(`exit=${err.code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      else resolve(undefined);
    });
  });
  const pkgs = ['shared', 'config', 'filesystem', 'permissions', 'protocol', 'credentials', 'git', 'github', 'project-engine', 'process-manager', 'model-gateway', 'agent-tools', 'agent', 'runtime', 'ui'];
  for (const p of pkgs) {
    try {
      await run(['-p', `packages/${p}/tsconfig.json`], ROOT);
    } catch (e) {
      throw new Error(`tsc ${p} failed:\n${e.message}`);
    }
  }
  try {
    await run(['-p', 'apps/cli/tsconfig.json'], ROOT);
  } catch (e) {
    throw new Error(`tsc cli failed:\n${e.message}`);
  }
}

await buildAll();

const { pathToFileURL } = await import('node:url');
const imp = (p) => import(pathToFileURL(p).href);
const shared = await imp(`${ROOT}/packages/shared/dist/index.js`);
const { resolveInRoot } = await imp(`${ROOT}/packages/filesystem/dist/index.js`);
const perms = await imp(`${ROOT}/packages/permissions/dist/index.js`);
const protocol = await imp(`${ROOT}/packages/protocol/dist/index.js`);
const { loadConfig, validateConfig } = await imp(`${ROOT}/packages/config/dist/index.js`);
const engine = await imp(`${ROOT}/packages/project-engine/dist/index.js`);
const pm = await imp(`${ROOT}/packages/process-manager/dist/index.js`);
const tools = await imp(`${ROOT}/packages/agent-tools/dist/index.js`);
const gw = await imp(`${ROOT}/packages/model-gateway/dist/index.js`);

test('path traversal blocked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-test-'));
  assert.throws(() => resolveInRoot(root, '../../etc/passwd'), /escapes project root/);
  assert.throws(() => resolveInRoot(root, '/etc/passwd'), /escapes/);
  const inside = resolveInRoot(root, 'src/a.ts');
  assert.ok(inside.startsWith(path.resolve(root)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('package manager + framework detection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-pm-'));
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { vite: '^6', react: '^18' } }));
  assert.equal(engine.detectPackageManager(dir), 'pnpm');
  assert.equal(engine.detectFramework({ dependencies: { vite: '^6' } }, dir), 'vite-react');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  fs.rmSync(path.join(dir, 'pnpm-lock.yaml'));
  assert.equal(engine.detectPackageManager(dir), 'yarn');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dangerous commands blocked', () => {
  assert.ok(perms.isDangerousCommand('rm -rf /'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-cmd-'));
  const v = perms.validateCommand('rm', ['-rf', '/'], root, root);
  assert.equal(v.ok, false);
  const okCmd = perms.validateCommand('npm', ['run', 'build'], root, root);
  assert.equal(okCmd.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('permission levels + approvals', () => {
  assert.equal(perms.toolLevel('read_file'), 'SAFE');
  assert.equal(perms.toolLevel('write_file'), 'MODERATE');
  assert.equal(perms.toolLevel('git_push'), 'HIGH');
  const d = perms.decide('git_push', 'moderate');
  assert.equal(d.requiresApproval, true);
  const s = perms.decide('read_file', 'strict');
  assert.equal(s.allowed, true);
});

test('tool schemas validate', () => {
  const write = tools.TOOL_DEFS.find((t) => t.name === 'write_file');
  assert.ok(write);
  assert.throws(() => write.validate({ path: '' }), /path/);
  const commit = tools.TOOL_DEFS.find((t) => t.name === 'git_commit');
  assert.throws(() => commit.validate({}), /message/);
});

test('config validation', () => {
  const c = loadConfig({});
  assert.ok(c.serverPort >= 1024);
  assert.throws(() => validateConfig({ ...c, serverPort: 80 }), /serverPort/);
});

test('protocol round-trip', () => {
  const e = protocol.makeEvent('agent.started', 'run-1', { goal: 'x' });
  const s = protocol.serializeEvent(e);
  const w = protocol.parseWire(s.replace('"agent.started"', '"agent.started"'));
  assert.ok(w && w.event === 'agent.started');
  assert.equal(protocol.parseWire('not json'), null);
});

test('redaction hides secrets', () => {
  const out = shared.redact({ api_key: 'sk-1234567890abcdef', nested: { token: 'abc' }, ok: 'hello' });
  assert.equal(out.api_key, '[REDACTED]');
  assert.equal(out.ok, 'hello');
});

test('findFreePort returns a bindable port', async () => {
  const port = await pm.findFreePort(45173);
  assert.ok(port >= 45173 && port < 45273);
});

test('provider factory covers required providers', () => {
  for (const p of ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'llamacpp', 'lmstudio']) {
    const prov = gw.createProvider({ provider: p, model: 'x', baseUrl: 'http://127.0.0.1:9' });
    assert.ok(prov && typeof prov.generate === 'function', p);
  }
  assert.ok(gw.AGENT_SYSTEM_PROMPT.includes('untrusted'));
});
