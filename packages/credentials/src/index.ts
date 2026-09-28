import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function storePath(): string {
  return path.join(os.homedir(), '.builder', 'credentials.json');
}

// File-backed credential store with 0600 perms. On macOS/Windows the OS keychain
// would be preferable; we keep the interface pluggable so a native backend can
// replace this without touching callers (see CredentialStore interface).
export interface CredentialStore {
  set(provider: string, key: string, value: string): Promise<void>;
  get(provider: string, key: string): Promise<string | undefined>;
  delete(provider: string, key: string): Promise<void>;
  has(provider: string): Promise<boolean>;
}

function readAll(): Record<string, Record<string, string>> {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Record<string, Record<string, string>>;
  } catch { return {}; }
}

function writeAll(all: Record<string, Record<string, string>>): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(all, null, 2), { mode: 0o600 });
  try { fs.chmodSync(storePath(), 0o600); } catch { /* windows */ }
}

function machineKey(): Buffer {
  // Tie encryption to machine+user so the file is not trivially portable.
  return crypto.createHash('sha256').update(os.hostname() + '|' + os.userInfo().username + '|builder-cred-v1').digest();
}

function enc(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', machineKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

function dec(stored: string): string {
  const [v, ivB, tagB, dataB] = stored.split('.');
  if (v !== 'v1') return stored; // legacy plaintext
  const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

export const fileCredentialStore: CredentialStore = {
  async set(provider, key, value) {
    const all = readAll();
    all[provider] = all[provider] ?? {};
    all[provider][key] = enc(value);
    writeAll(all);
  },
  async get(provider, key) {
    const all = readAll();
    const v = all[provider]?.[key];
    if (!v) {
      const envKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      return process.env[envKey];
    }
    try { return dec(v); } catch { return undefined; }
  },
  async delete(provider, key) {
    const all = readAll();
    if (all[provider]) { delete all[provider][key]; writeAll(all); }
  },
  async has(provider) {
    const all = readAll();
    return Boolean(all[provider] && Object.keys(all[provider]).length > 0);
  },
};
