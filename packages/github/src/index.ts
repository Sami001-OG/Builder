import { execFile } from 'node:child_process';
import { BuilderError } from '@builder/shared';

function sh(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new BuilderError('GITHUB_ERROR', `${cmd} ${args[0]} failed: ${String(stderr || err.message).slice(0, 500)}`));
      else resolve(stdout);
    });
  });
}

export interface GithubDeps { token?: string; fetchFn?: typeof fetch }

export async function listRepositories(deps: GithubDeps = {}, cwd = process.cwd()): Promise<unknown> {
  // Prefer gh CLI when available (uses user's existing auth).
  try {
    const out = await sh('gh', ['repo', 'list', '--json', 'name,url', '--limit', '50'], cwd);
    return JSON.parse(out);
  } catch { /* fall through to API */ }
  if (!deps.token) throw new BuilderError('AUTH_ERROR', 'No GitHub auth: install gh CLI and run `gh auth login`, or configure a token');
  const res = await (deps.fetchFn ?? fetch)('https://api.github.com/user/repos?per_page=50', {
    headers: { Authorization: `Bearer ${deps.token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new BuilderError('GITHUB_ERROR', `GitHub API ${res.status}`);
  return res.json();
}

export async function createRepository(name: string, opts: { private?: boolean; cwd?: string; token?: string } = {}): Promise<string> {
  try {
    const args = ['repo', 'create', name, opts.private === false ? '--public' : '--private', '--confirm'];
    return await sh('gh', args, opts.cwd ?? process.cwd());
  } catch { /* fall through */ }
  if (!opts.token) throw new BuilderError('AUTH_ERROR', 'gh CLI unavailable and no token configured');
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, private: opts.private !== false }),
  });
  if (!res.ok) throw new BuilderError('GITHUB_ERROR', `Create repo failed: ${res.status}`);
  const j = (await res.json()) as { html_url?: string };
  return j.html_url ?? '';
}

export async function exportPush(cwd: string, remoteUrl: string, branch = 'main'): Promise<string> {
  await sh('git', ['remote', 'add', 'builder-export', remoteUrl], cwd).catch(() => sh('git', ['remote', 'set-url', 'builder-export', remoteUrl], cwd));
  return sh('git', ['push', '-u', 'builder-export', branch], cwd);
}
