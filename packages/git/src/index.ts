import { execFile } from 'node:child_process';
import { BuilderError } from '@builder/shared';

function run(gitArgs: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', gitArgs, { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new BuilderError('GIT_ERROR', `git ${gitArgs[0]} failed: ${String(stderr || err.message).slice(0, 500)}`));
      else resolve(stdout);
    });
  });
}

export async function isRepo(cwd: string): Promise<boolean> {
  try { await run(['rev-parse', '--git-dir'], cwd); return true; } catch { return false; }
}
export async function status(cwd: string): Promise<string> { return run(['status', '--short', '--branch'], cwd); }
export async function diff(cwd: string, staged = false): Promise<string> {
  return run(staged ? ['diff', '--staged'] : ['diff'], cwd);
}
export async function log(cwd: string, n = 20): Promise<string> { return run(['log', `--max-count=${n}`, '--oneline'], cwd); }
export async function branch(cwd: string): Promise<string> { return (await run(['branch', '--show-current'], cwd)).trim(); }

const SECRET_HINT = [/sk-[A-Za-z0-9]{10,}/, /ghp_[A-Za-z0-9]{10,}/, /xoxb-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

export function scanSecrets(text: string): string[] {
  return SECRET_HINT.filter((r) => r.test(text)).map((r) => String(r));
}

export async function commit(cwd: string, message: string): Promise<string> {
  if (!message.trim()) throw new BuilderError('VALIDATION_ERROR', 'Commit message required');
  const st = await status(cwd);
  if (scanSecrets(st).length > 0) throw new BuilderError('GIT_ERROR', 'Refusing commit: staged status looks secret-like');
  await run(['add', '-A'], cwd);
  return run(['commit', '-m', message], cwd);
}

export async function push(cwd: string, remote = 'origin', br?: string): Promise<string> {
  const args = br ? ['push', remote, br] : ['push'];
  return run(args, cwd);
}
export async function pull(cwd: string): Promise<string> { return run(['pull', '--ff-only'], cwd); }
