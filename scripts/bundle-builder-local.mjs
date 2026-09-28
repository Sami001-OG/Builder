#!/usr/bin/env node
// Bundle the CLI (+ all @builder/* workspace deps) into a single ESM file
// for the publishable `builder-local` package. Zero runtime dependencies.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'packages', 'builder-local');
const DIST_DIR = path.join(OUT_DIR, 'dist');
const BUNDLE = path.join(DIST_DIR, 'bundle.js');
const ESBUILD = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
const ENTRY = path.join(ROOT, 'apps', 'cli', 'dist', 'index.js');

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${stdout}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// 1. Rebuild all packages so the bundle picks up fresh dist output.
console.log('rebuilding packages...');
await run(process.execPath, [path.join(ROOT, 'scripts', 'build-packages.mjs')], ROOT);

// 2. Bundle the CLI entry (workspace @builder/* deps resolve via symlinks and get inlined).
console.log('bundling CLI with esbuild...');
fs.mkdirSync(DIST_DIR, { recursive: true });
await run(process.execPath, [ESBUILD, ENTRY, '--bundle', '--platform=node', '--format=esm',
  `--outfile=${BUNDLE}`], ROOT);
// Prepend shebang (esbuild banner quoting is shell-fragile, so do it here).
let code = fs.readFileSync(BUNDLE, 'utf8');
if (!code.startsWith('#!/usr/bin/env node')) code = '#!/usr/bin/env node\n' + code;
else code = code.replace(/^#!.*\n/, '#!/usr/bin/env node\n');
fs.writeFileSync(BUNDLE, code);
if (process.platform !== 'win32') fs.chmodSync(BUNDLE, 0o755);

// 3. Stage web UI + templates next to dist/ (matches CLI's here/../web-dist + here/../templates lookup).
const webSrc = path.join(ROOT, 'apps', 'web', 'dist');
if (!fs.existsSync(path.join(webSrc, 'index.html'))) throw new Error(`web UI not built: ${webSrc}/index.html missing (run web build first)`);
copyDir(webSrc, path.join(OUT_DIR, 'web-dist'));
copyDir(path.join(ROOT, 'templates'), path.join(OUT_DIR, 'templates'));

// 4. Write publishable package.json (+ README, LICENSE) if missing.
const pkgPath = path.join(OUT_DIR, 'package.json');
if (!fs.existsSync(pkgPath)) {
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: 'builder-local',
    version: '0.1.0',
    description: 'Local-first AI-powered web application builder — CLI + local runtime + browser IDE',
    type: 'module',
    license: 'MIT',
    bin: { builder: './dist/bundle.js', 'builder-local': './dist/bundle.js' },
    exports: { '.': './dist/bundle.js', './package.json': './package.json' },
    files: ['dist', 'web-dist', 'templates'],
    engines: { node: '>=20.0.0' },
    keywords: ['ai', 'web-builder', 'local-first', 'cli', 'code-generator'],
    repository: { type: 'git', url: 'https://github.com/Sami001-OG/Builder.git', directory: 'packages/builder-local' },
    homepage: 'https://github.com/Sami001-OG/Builder#readme',
  }, null, 2) + '\n');
}
if (!fs.existsSync(path.join(OUT_DIR, 'README.md'))) {
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'),
    '# builder-local\n\nLocal-first AI-powered web application builder.\n\n```sh\nnpm install -g builder-local\nbuilder doctor\nbuilder start\n```\n\nOpens a local IDE at `http://127.0.0.1:4173` — your filesystem is the source of truth, no cloud required.\n\nConfigure a model provider:\n\n```sh\nbuilder auth --provider openai --key <api-key>\n```\n\nSupported providers: `openai`, `anthropic`, `gemini`, `openrouter`, `ollama` (no key), `llamacpp`, `lmstudio`.\n');
}
if (!fs.existsSync(path.join(OUT_DIR, 'LICENSE'))) {
  fs.writeFileSync(path.join(OUT_DIR, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Builder contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n');
}

const sizeKb = Math.round(fs.statSync(BUNDLE).size / 1024);
console.log(`bundle OK: ${BUNDLE} (${sizeKb} KB) + web-dist + templates`);
