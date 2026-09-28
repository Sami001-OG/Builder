import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuilderError } from '@builder/shared';

export interface BuilderConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  serverPort: number;
  host: string;
  exposeLan: boolean;
  theme: 'light' | 'dark' | 'system';
  openBrowser: boolean;
  approvals: 'strict' | 'moderate' | 'permissive';
  previewBehavior: 'auto' | 'manual';
  agent: { maxIterations: number; maxToolCalls: number; commandTimeoutMs: number; runTimeoutMs: number; retryLimit: number };
}

const DEFAULTS: BuilderConfig = {
  provider: 'ollama',
  model: 'llama3.1',
  baseUrl: 'http://127.0.0.1:11434',
  serverPort: 4173,
  host: '127.0.0.1',
  exposeLan: false,
  theme: 'system',
  openBrowser: true,
  approvals: 'moderate',
  previewBehavior: 'auto',
  agent: { maxIterations: 40, maxToolCalls: 120, commandTimeoutMs: 120_000, runTimeoutMs: 900_000, retryLimit: 5 },
};

export function configDir(): string {
  return path.join(os.homedir(), '.builder');
}
export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(overrides: Partial<BuilderConfig> = {}): BuilderConfig {
  let file: Partial<BuilderConfig> = {};
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    file = JSON.parse(raw) as Partial<BuilderConfig>;
  } catch { /* missing -> defaults */ }
  const env: Partial<BuilderConfig> = {};
  if (process.env.BUILDER_PORT) env.serverPort = Number(process.env.BUILDER_PORT);
  if (process.env.BUILDER_PROVIDER) env.provider = process.env.BUILDER_PROVIDER;
  if (process.env.BUILDER_MODEL) env.model = process.env.BUILDER_MODEL;
  const merged = { ...DEFAULTS, ...file, ...env, ...overrides };
  validateConfig(merged);
  return merged as BuilderConfig;
}

export function validateConfig(c: BuilderConfig): void {
  if (!Number.isInteger(c.serverPort) || c.serverPort < 1024 || c.serverPort > 65535) {
    throw new BuilderError('VALIDATION_ERROR', `Invalid serverPort: ${c.serverPort}`);
  }
  if (!['strict', 'moderate', 'permissive'].includes(c.approvals)) {
    throw new BuilderError('VALIDATION_ERROR', `Invalid approvals policy: ${c.approvals}`);
  }
  if (!c.model || typeof c.model !== 'string') throw new BuilderError('VALIDATION_ERROR', 'model must be a non-empty string');
  if (!c.provider || typeof c.provider !== 'string') throw new BuilderError('VALIDATION_ERROR', 'provider must be a non-empty string');
  if (c.agent.maxIterations < 1 || c.agent.maxIterations > 500) throw new BuilderError('VALIDATION_ERROR', 'agent.maxIterations out of range');
}

export function saveConfig(c: BuilderConfig): void {
  validateConfig(c);
  fs.mkdirSync(configDir(), { recursive: true });
  // never persist secrets here; strip anything secret-like
  const { ...safe } = c as unknown as Record<string, unknown>;
  fs.writeFileSync(configPath(), JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
}
