// Shared Playwright fixture: boots a real runtime (MockProvider) serving the
// freshly built web UI, mirroring scripts/e2e-mock-agent.mjs.
import { test as base } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function loadBuilt(mod: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(path.join(ROOT, mod)).href)) as Record<string, unknown>;
}

export const test = base.extend<{ baseURL: string; closeRuntime: () => Promise<void> }>({
  baseURL: async ({}, use) => {
    const runtimeMod = await loadBuilt('packages/runtime/dist/index.js');
    const startRuntime = runtimeMod.startRuntime as (o: Record<string, unknown>) => Promise<{
      port: number; url: string; close: () => Promise<void>;
    }>;
    const pmMod = await loadBuilt('packages/process-manager/dist/index.js');
    const findFreePort = pmMod.findFreePort as (start: number, host: string) => Promise<number>;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-ui-'));
    // NOTE: startRuntime echoes config.serverPort in rt.url (no ephemeral-port
    // substitution), so resolve a real free port first instead of passing 0.
    const port = await findFreePort(4181, '127.0.0.1');
    const rt = await startRuntime({
      config: {
        provider: 'mock', model: 'mock', serverPort: port, host: '127.0.0.1',
        approvals: 'permissive', openBrowser: false,
        agent: { maxIterations: 5, maxToolCalls: 10, commandTimeoutMs: 5000, runTimeoutMs: 30000, retryLimit: 1 },
      },
      webDistDir: path.join(ROOT, 'apps', 'web', 'dist'),
      templatesDir: path.join(ROOT, 'templates'),
    });
    // Open a scratch project so files/explorer render
    await fetch(`${rt.url}/api/project/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ui-test', directory: path.join(tmp, 'proj'), template: 'react-vite-ts' }),
    });
    await use(rt.url);
    await rt.close();
    // Windows-safe cleanup: processes may hold handles briefly; retry then give up silently.
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  },
  closeRuntime: async ({}, use) => { await use(async () => undefined); },
});
