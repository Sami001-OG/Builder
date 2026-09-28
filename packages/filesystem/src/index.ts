import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BuilderError } from '@builder/shared';

export const DEFAULT_IGNORES = new Set(['node_modules', 'dist', 'build', 'coverage', '.cache', '.git', '.builder-tmp']);

export function resolveInRoot(root: string, rel: string): string {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, rel === '' || rel === '.' ? '.' : rel);
  const relToRoot = path.relative(rootAbs, target);
  if (relToRoot === '') return rootAbs;
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new BuilderError('PERMISSION_DENIED', `Path escapes project root: ${rel}`);
  }
  return target;
}

export async function safeRead(root: string, rel: string): Promise<string> {
  const abs = resolveInRoot(root, rel);
  try {
    const st = await fsp.stat(abs);
    if (st.size > 2_000_000) throw new BuilderError('VALIDATION_ERROR', `File too large: ${rel}`);
    return await fsp.readFile(abs, 'utf8');
  } catch (e: unknown) {
    if (e instanceof BuilderError) throw e;
    throw new BuilderError('FILESYSTEM_ERROR', `Cannot read ${rel}: ${(e as Error).message}`);
  }
}

export async function safeWrite(root: string, rel: string, content: string): Promise<void> {
  if (isSecretPath(rel)) throw new BuilderError('PERMISSION_DENIED', `Refusing to write secret-like path without explicit workflow: ${rel}`);
  const abs = resolveInRoot(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
}

export async function safeDelete(root: string, rel: string): Promise<void> {
  const abs = resolveInRoot(root, rel);
  if (abs === path.resolve(root)) throw new BuilderError('PERMISSION_DENIED', 'Refusing to delete project root');
  await fsp.rm(abs, { recursive: true, force: true });
}

export interface FileNode { name: string; path: string; type: 'file' | 'dir'; size?: number; mtime?: number; children?: FileNode[]; gitStatus?: string }

export async function getTree(root: string, rel = '.', depth = 6): Promise<FileNode[]> {
  const abs = resolveInRoot(root, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out: FileNode[] = [];
  for (const e of entries) {
    if (DEFAULT_IGNORES.has(e.name)) continue;
    const childRel = rel === '.' ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      const node: FileNode = { name: e.name, path: childRel, type: 'dir' };
      if (depth > 1) node.children = await getTree(root, childRel, depth - 1);
      out.push(node);
    } else {
      const st = await fsp.stat(path.join(abs, e.name)).catch(() => undefined);
      out.push({ name: e.name, path: childRel, type: 'file', size: st?.size, mtime: st?.mtimeMs });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return out;
}

export async function searchFiles(root: string, query: string, limit = 50): Promise<string[]> {
  const results: string[] = [];
  async function walk(rel: string): Promise<void> {
    if (results.length >= limit) return;
    const abs = resolveInRoot(root, rel);
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= limit) return;
      if (DEFAULT_IGNORES.has(e.name)) continue;
      const child = rel === '.' ? e.name : `${rel}/${e.name}`;
      if (e.name.toLowerCase().includes(query.toLowerCase())) { results.push(child); }
      if (e.isDirectory()) await walk(child);
      else if (results.length < limit && /\.(ts|tsx|js|jsx|json|css|html|md)$/.test(e.name)) {
        try {
          const content = await fsp.readFile(path.join(abs, e.name), 'utf8');
          if (content.toLowerCase().includes(query.toLowerCase()) && !results.includes(child)) results.push(child);
        } catch { /* skip */ }
      }
    }
  }
  await walk('.');
  return results.slice(0, limit);
}

export function isSecretPath(rel: string): boolean {
  const b = path.basename(rel);
  return /^\.env(\..*)?$/.test(b) || /\.pem$/.test(b) || /\.key$/.test(b) || /^(credentials|secrets)(\..*)?$/i.test(b);
}

export function watchProject(root: string, onChange: (rel: string, kind: 'change' | 'rename') => void): { close(): void } {
  const watcher = fs.watch(root, { recursive: true }, (_ev, filename) => {
    const f = String(filename ?? '');
    if (!f) return;
    const parts = f.split(path.sep);
    if (parts.some((p) => DEFAULT_IGNORES.has(p))) return;
    onChange(f.replace(/\\/g, '/'), 'change');
  });
  return { close: () => watcher.close() };
}
