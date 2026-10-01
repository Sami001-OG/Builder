#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadConfig, saveConfig, configPath } from '@builder/config';
import { startRuntime } from '@builder/runtime';

const VERSION = '0.1.4';

function printHelp(): void {
  console.log(`builder ${VERSION} — local-first AI web-app builder
Usage:
  builder                Interactive menu (setup wizard on first run)
  builder menu           Same as above
  builder start          Start the local IDE directly (skip menu)
  builder start --wizard Run the setup wizard before starting
  builder start --no-tui Start directly even when interactive
  builder wizard         Run the setup wizard once and exit
  builder doctor         Check environment and configuration
  builder config         Show configuration
  builder config --set key=value  Update configuration
  builder auth           Configure provider credentials
  builder version        Print version
  builder update         Check for updates
`);
}

async function doctor(): Promise<number> {
  console.log('AI Builder — environment check\n');
  const checks: [string, () => Promise<string>][] = [
    ['OS', async () => `${os.platform()} ${os.arch()}`],
    ['Node', async () => process.version],
    ['package manager (npm)', async () => (await sh('npm', ['--version'])).trim()],
    ['Git', async () => (await sh('git', ['--version'])).trim()],
    ['config', async () => { loadConfig(); return configPath(); }],
    ['port 4173', async () => (await portFree(4173)) ? 'available (or nearby ports free)' : 'busy — will auto-pick nearby port'],
    ['browser open', async () => 'uses default OS opener (opt-out with --no-open)'],
  ];
  let failed = 0;
  for (const [name, fn] of checks) {
    try {
      const v = await fn();
      console.log(`  ✓ ${name}: ${v}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}: ${(e as Error).message}`);
    }
  }
  console.log(failed ? `\n${failed} check(s) failed.` : '\nEnvironment ready.');
  return failed ? 1 : 0;
}

function sh(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // On Windows, bare exe names need shell resolution (PATHEXT / PATH lookup).
    // Avoid DEP0190 (shell:true + args array) by joining into a single command line.
    const needsShell = process.platform === 'win32' && !/[/\\]/.test(cmd);
    const file = needsShell ? [cmd, ...args].join(' ') : cmd;
    const opts = needsShell
      ? { timeout: 10_000, shell: true as const, windowsHide: true }
      : { timeout: 10_000, shell: false as const, windowsHide: true };
    execFile(file, needsShell ? [] : args, opts, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || (err as Error).message).trim().slice(0, 200)));
      else resolve(String(stdout));
    });
  });
}

async function portFree(port: number): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function openBrowser(url: string): void {
  const plat = os.platform();
  const cmd = plat === 'win32' ? 'cmd' : plat === 'darwin' ? 'open' : 'xdg-open';
  const args = plat === 'win32' ? ['/c', 'start', '""', url] : [url];
  execFile(cmd, args, { windowsHide: true }, () => { /* best effort */ });
}

async function handleAuth(args: string[]): Promise<number> {
  const { fileCredentialStore } = await import('@builder/credentials');
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const provider = get('--provider') ?? 'openai';
  const key = get('--key');
  if (!key) {
    console.log('Usage: builder auth --provider <name> --key <api-key>');
    console.log('Supported: openai, anthropic, gemini, openrouter, ollama (no key needed), llamacpp');
    return 1;
  }
  await fileCredentialStore.set(provider, 'api_key', key);
  console.log(`Saved ${provider} credentials to OS-user store (0600 file, machine-bound encryption).`);
  return 0;
}

async function handleConfig(args: string[]): Promise<number> {
  const cfg = loadConfig();
  const setArg = args.find((a) => a.startsWith('--set'));
  const kv = args[args.indexOf('--set') + 1] ?? (setArg?.includes('=') ? setArg.split('=').slice(1).join('=') : undefined);
  if (args.includes('--set') && kv) {
    const [k, ...rest] = kv.split('=');
    const v: string = rest.join('=');
    const next = { ...cfg } as Record<string, unknown>;
    const agent = { ...(cfg.agent as unknown as Record<string, unknown>) };
    if (k.startsWith('agent.')) agent[k.slice(6)] = Number(v) || v;
    else next[k] = k === 'serverPort' ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
    saveConfig({ ...cfg, ...(next as object), agent: agent as never });
    console.log(`Updated ${k}.`);
    return 0;
  }
  console.log(JSON.stringify({ ...cfg }, null, 2));
  return 0;
}

async function start(noOpen: boolean): Promise<number> {
  const cfg = loadConfig();
  console.log('AI Builder\n');
  console.log('✓ Environment ready');
  // resolve web assets: dist/web-dist (packed) or apps/web/dist (dev) or fallback placeholder
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../web-dist'),
    path.resolve(here, '../../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  const webDistDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
  const templatesDir = [path.resolve(here, '../templates'), path.resolve(process.cwd(), 'templates'), path.resolve(here, '../../templates')].find((d) => fs.existsSync(d)) ?? path.resolve(process.cwd(), 'templates');
  const rt = await startRuntime({ config: cfg, webDistDir, templatesDir });
  console.log('✓ Local runtime ready');
  console.log('✓ Agent runtime ready');
  console.log('✓ Local server ready');
  console.log(`\nLocal URL:\n${rt.url}\n`);
  // Best-effort self-check: confirm the local server answers its own health endpoint.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${rt.url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) console.log('✓ Local server responding');
    else console.warn(`! Local server self-check returned ${res.status} (continuing anyway)`);
  } catch (e) {
    console.warn(`! Local server self-check failed (continuing anyway): ${(e as Error).message}`);
  }
  if (cfg.openBrowser && !noOpen) {
    console.log('Opening browser...');
    openBrowser(rt.url);
  } else {
    console.log('(browser auto-open disabled)');
  }
  console.log('\nPress Ctrl+C to stop.');
  const stop = async () => { console.log('\nShutting down...'); await rt.close(); process.exit(0); };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  await new Promise(() => { /* run until signal */ });
  return 0;
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case undefined:
    case 'menu': {
      const { isInteractive, isFirstRun, runSetupWizard, runMainMenu } = await import('./tui.js');
      if (!isInteractive()) return start(rest.includes('--no-open'));
      if (isFirstRun(loadConfig())) await runSetupWizard();
      return runMainMenu({
        start: (noOpen) => start(noOpen),
        doctor: () => doctor(),
        showConfig: (a) => handleConfig(a),
        auth: (a) => handleAuth(a),
      });
    }
    case 'wizard': {
      const { runSetupWizard } = await import('./tui.js');
      await runSetupWizard();
      return 0;
    }
    case 'start': {
      if (rest.includes('--wizard')) {
        const { runSetupWizard } = await import('./tui.js');
        await runSetupWizard();
      } else if (!rest.includes('--no-tui')) {
        const { isInteractive, isFirstRun, runSetupWizard } = await import('./tui.js');
        if (isInteractive() && isFirstRun(loadConfig())) await runSetupWizard();
      }
      return start(rest.includes('--no-open'));
    }
    case 'doctor': return doctor();
    case 'version':
    case '--version': console.log(VERSION); return 0;
    case 'config': return handleConfig(rest);
    case 'auth': return handleAuth(rest);
    case 'update': console.log('builder is installed locally; pull the latest source or reinstall the published package to update.'); return 0;
    case 'help':
    case '--help':
    case '-h': printHelp(); return 0;
    default: console.error(`Unknown command: ${cmd}\n`); printHelp(); return 1;
  }
}

main().then((c) => { if (c !== 0) process.exitCode = c; }).catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
