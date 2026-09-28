import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BuilderError } from '@builder/shared';
import { getTree, safeRead, safeWrite, safeDelete, resolveInRoot, type FileNode } from '@builder/filesystem';

export interface Project { root: string; name: string; }
export interface CreateProjectInput { name: string; directory: string; template: string; }
export interface ProjectInspection {
  root: string; name: string; framework: string; packageManager: string;
  scripts: Record<string, string>; isGit: boolean; hasDevScript: boolean; entryFiles: string[];
}

export function detectPackageManager(root: string): string {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export function detectFramework(pkg: Record<string, unknown>, root: string): string {
  const deps = { ...((pkg['dependencies'] as Record<string, string>) ?? {}), ...((pkg['devDependencies'] as Record<string, string>) ?? {}) };
  if (deps['next']) return 'nextjs';
  if (deps['@sveltejs/kit'] || deps['svelte']) return 'svelte';
  if (deps['vue'] || deps['nuxt']) return 'vue';
  if (deps['vite']) return 'vite-react';
  if (deps['react']) return 'react';
  if (fs.existsSync(path.join(root, 'index.html'))) return 'html';
  return 'unknown';
}

export class ProjectEngine {
  root: string | null = null;

  async openProject(p: string): Promise<Project> {
    const abs = path.resolve(p);
    const st = await fsp.stat(abs).catch(() => undefined);
    if (!st || !st.isDirectory()) throw new BuilderError('NOT_FOUND', `Project directory not found: ${p}`);
    this.root = abs;
    return { root: abs, name: path.basename(abs) };
  }

  requireRoot(): string {
    if (!this.root) throw new BuilderError('VALIDATION_ERROR', 'No project open');
    return this.root;
  }

  async createProject(input: CreateProjectInput, templateDir: string): Promise<Project> {
    const dest = path.resolve(input.directory, input.name);
    if (fs.existsSync(dest)) throw new BuilderError('CONFLICT', `Directory already exists: ${dest}`);
    await fsp.mkdir(dest, { recursive: true });
    await copyDir(templateDir, dest);
    // personalize package.json name
    const pkgPath = path.join(dest, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8')) as Record<string, unknown>;
        pkg['name'] = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
        await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      } catch { /* keep template as-is */ }
    }
    this.root = dest;
    return { root: dest, name: input.name };
  }

  async inspectProject(): Promise<ProjectInspection> {
    const root = this.requireRoot();
    let pkg: Record<string, unknown> = {};
    try { pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>; } catch { /* no package.json */ }
    const scripts = (pkg['scripts'] as Record<string, string>) ?? {};
    return {
      root,
      name: (pkg['name'] as string) ?? path.basename(root),
      framework: detectFramework(pkg, root),
      packageManager: detectPackageManager(root),
      scripts,
      isGit: fs.existsSync(path.join(root, '.git')),
      hasDevScript: Boolean(scripts['dev']),
      entryFiles: ['src/App.tsx', 'src/main.tsx', 'src/index.ts', 'index.html'].filter((f) => fs.existsSync(path.join(root, f))),
    };
  }

  getTree(depth = 6): Promise<FileNode[]> { return getTree(this.requireRoot(), '.', depth); }
  readFile(rel: string): Promise<string> { return safeRead(this.requireRoot(), rel); }
  writeFile(rel: string, content: string): Promise<void> { return safeWrite(this.requireRoot(), rel, content); }
  deleteFile(rel: string): Promise<void> { return safeDelete(this.requireRoot(), rel); }

  async patchFile(rel: string, patch: { search: string; replace: string; expectVersion?: string }): Promise<void> {
    const root = this.requireRoot();
    const abs = resolveInRoot(root, rel);
    const current = await fsp.readFile(abs, 'utf8');
    if (!current.includes(patch.search)) {
      throw new BuilderError('CONFLICT', `Patch target not found in ${rel}; file may have changed. Reread before patching.`);
    }
    const next = current.replace(patch.search, patch.replace);
    await fsp.writeFile(abs, next, 'utf8');
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}
