// Zero-dependency terminal TUI: setup wizard + main menu.
// Uses only node:readline — safe for cmd.exe/PowerShell (numbered choices,
// no ANSI fullscreen, no arrow-key handling) and keeps the builder-local
// esbuild bundle dependency-free.
import fs from 'node:fs';
import readline from 'node:readline';
import { loadConfig, saveConfig, configPath, type BuilderConfig } from '@builder/config';

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'llamacpp', 'lmstudio', 'custom'] as const;
const KEYLESS = new Set(['ollama', 'llamacpp', 'lmstudio']);
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.0-flash',
  openrouter: 'openai/gpt-4o-mini',
  ollama: 'llama3.1',
  llamacpp: 'default',
  lmstudio: 'default',
  custom: '',
};

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
}

/** First run = no config file yet, or untouched defaults with no key material. */
export function isFirstRun(cfg: BuilderConfig): boolean {
  try {
    if (!fs.existsSync(configPath())) return true;
  } catch { return true; }
  if (cfg.provider === 'ollama' && cfg.model === 'llama3.1') {
    if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) return false;
    return true;
  }
  return false;
}

export function parseChoice(input: string, max: number): number | null {
  const n = Number(input.trim());
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export function parsePort(input: string, fallback: number): number | null {
  const t = input.trim();
  if (t === '') return fallback;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return null;
  return n;
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function askChoice(rl: readline.Interface, q: string, max: number): Promise<number> {
  for (;;) {
    const n = parseChoice(await ask(rl, q), max);
    if (n !== null) return n;
    console.log(`  Enter a number 1-${max}.`);
  }
}

/** Prompt for an API key without echoing it (best-effort masking on TTYs). */
function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    let buf = '';
    const wasRaw = stdin.isTTY ? (stdin as unknown as { isRaw?: boolean }).isRaw : undefined;
    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) {
        try { (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode(false); } catch { /* ignore */ }
        void wasRaw;
      }
      stdout.write('\n');
    };
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      if (s === '\r' || s === '\n' || s === '') { cleanup(); stdin.pause(); resolve(buf); return; }
      if (s === '') { cleanup(); process.exit(130); }
      if (s === '' || s === '\b') { buf = buf.slice(0, -1); return; }
      buf += s.replace(/[\r\n]/g, '');
    };
    if (stdin.isTTY) {
      try { (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode(true); } catch { /* ignore */ }
      stdin.resume();
      stdin.on('data', onData);
    } else {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question('', (ans) => { rl.close(); resolve(ans.trim()); });
    }
  });
}

async function probeLocalModels(baseUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

async function probeCustomEndpoint(baseUrl: string, apiKey?: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, { signal: ctrl.signal, headers });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

export async function runSetupWizard(): Promise<BuilderConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n== Builder setup ==\n');
    const cfg = loadConfig();

    console.log('Model provider:');
    PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}) ${p}${KEYLESS.has(p) ? ' (no key needed)' : ''}`));
    const pi = (await askChoice(rl, `Choose [1-${PROVIDERS.length}] (current: ${cfg.provider}): `, PROVIDERS.length)) - 1;
    const provider = PROVIDERS[pi];
    let model: string;
    if (provider === 'custom') {
      for (;;) {
        const ans = (await ask(rl, 'Model name (required, e.g. my-model): ')).trim();
        if (ans !== '') { model = ans; break; }
        console.log('  Model name is required for the custom provider.');
      }
    } else {
      const modelDefault = DEFAULT_MODELS[provider] ?? cfg.model;
      const modelAns = (await ask(rl, `Model [${modelDefault}]: `)).trim();
      model = modelAns === '' ? modelDefault : modelAns;
    }

    let baseUrl = cfg.baseUrl;
    if (provider === 'custom') {
      const dflt = 'http://127.0.0.1:8080';
      for (;;) {
        const ans = (await ask(rl, `Server URL (OpenAI-compatible endpoint) [${dflt}]: `)).trim();
        const candidate = ans === '' ? dflt : ans;
        if (candidate === '' || !(candidate.startsWith('http://') || candidate.startsWith('https://'))) {
          console.log('  Enter a valid URL starting with http:// or https://.');
          continue;
        }
        baseUrl = candidate;
        break;
      }
    } else if (provider === 'ollama' || provider === 'llamacpp' || provider === 'lmstudio') {
      const dflt = cfg.baseUrl ?? 'http://127.0.0.1:11434';
      const ans = (await ask(rl, `Server URL [${dflt}]: `)).trim();
      baseUrl = ans === '' ? dflt : ans;
    }

    let customKey = '';
    if (provider === 'custom') {
      console.log('\nAPI key for custom endpoint (input hidden, Enter to skip if none needed):');
      const key = await askSecret('Key (Enter to skip): ');
      customKey = key.trim();
      if (customKey !== '') {
        const { fileCredentialStore } = await import('@builder/credentials');
        await fileCredentialStore.set(provider, 'api_key', customKey);
        console.log('  Saved to OS-user store (0600 file, machine-bound encryption).');
      } else {
        console.log('  No key saved (endpoint used without auth).');
      }
      console.log('\nChecking custom endpoint...');
      const ok = await probeCustomEndpoint(baseUrl ?? 'http://127.0.0.1:8080', customKey || undefined);
      console.log(ok ? '  Custom endpoint reachable.' : '  Could not reach custom endpoint — check the URL and try again later (continuing anyway).');
    } else if (!KEYLESS.has(provider)) {
      console.log(`\nAPI key for ${provider} (input hidden):`);
      const key = await askSecret('Key (Enter to keep existing): ');
      if (key.trim() !== '') {
        const { fileCredentialStore } = await import('@builder/credentials');
        await fileCredentialStore.set(provider, 'api_key', key.trim());
        console.log('  Saved to OS-user store (0600 file, machine-bound encryption).');
      } else {
        console.log('  Kept existing credentials.');
      }
    } else {
      console.log('\nChecking local server...');
      const ok = await probeLocalModels(baseUrl ?? 'http://127.0.0.1:11434');
      console.log(ok ? '  Local model server reachable.' : '  Could not reach local server — you can start it later (e.g. `ollama serve`).');
    }

    for (;;) {
      const ans = await ask(rl, `\nLocal port [${cfg.serverPort}]: `);
      const port = parsePort(ans, cfg.serverPort);
      if (port !== null) { cfg.serverPort = port; break; }
      console.log('  Enter a port 1024-65535 (or Enter for default).');
    }

    console.log('\nApproval policy for agent tool runs:');
    console.log('  1) strict — confirm everything\n  2) moderate — confirm impactful actions\n  3) permissive — confirm only destructive actions');
    const polMap = ['strict', 'moderate', 'permissive'] as const;
    const polRaw = await ask(rl, `Choose [1-3] (Enter to keep: ${cfg.approvals}): `);
    let approvals = cfg.approvals;
    if (polRaw.trim() !== '') {
      const n = parseChoice(polRaw, 3);
      if (n === null) {
        console.log('  Keeping current policy.');
      } else {
        approvals = polMap[n - 1];
      }
    }

    const openAns = (await ask(rl, `Open browser automatically? [${cfg.openBrowser ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
    const openBrowser = openAns === '' ? cfg.openBrowser : openAns.startsWith('y');

    const next: BuilderConfig = {
      ...cfg,
      provider,
      model,
      baseUrl,
      approvals,
      openBrowser,
    };
    saveConfig(next);
    console.log(`\nSaved configuration to ${configPath()}.`);
    return next;
  } finally {
    rl.close();
  }
}

export interface MenuActions {
  start: (noOpen: boolean) => Promise<number>;
  doctor: () => Promise<number>;
  showConfig: (args: string[]) => Promise<number>;
  auth: (args: string[]) => Promise<number>;
}

export async function runMainMenu(actions: MenuActions): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const cfg = loadConfig();
      console.log('\n== Builder — local-first AI web-app builder ==');
      console.log(`  provider: ${cfg.provider} · model: ${cfg.model} · port: ${cfg.serverPort}`);
      console.log('  1) Start developing (launch server + open browser)');
      console.log('  2) Setup wizard (provider / model / key / port)');
      console.log('  3) Environment check (doctor)');
      console.log('  4) Show configuration');
      console.log('  5) Manage credentials (auth)');
      console.log('  6) Exit');
      const raw = await ask(rl, 'Choose [1-6]: ');
      const c = parseChoice(raw, 6);
      if (c === null) { console.log('  Enter a number 1-6.'); continue; }
      if (c === 1) {
        return await actions.start(false);
      } else if (c === 2) {
        await runSetupWizard();
      } else if (c === 3) {
        await actions.doctor();
      } else if (c === 4) {
        await actions.showConfig([]);
      } else if (c === 5) {
        const provider = (await ask(rl, 'Provider (Enter to cancel): ')).trim();
        if (provider !== '') {
          const key = await askSecret('Key: ');
          if (key.trim() !== '') await actions.auth(['--provider', provider, '--key', key.trim()]);
          else console.log('  Cancelled (empty key).');
        }
      } else {
        console.log('Bye.');
        return 0;
      }
    }
  } finally {
    rl.close();
  }
}
