// Build all TypeScript packages + CLI in dependency order.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = [
  'packages/shared', 'packages/config', 'packages/filesystem', 'packages/permissions',
  'packages/protocol', 'packages/credentials', 'packages/ui', 'packages/git',
  'packages/github', 'packages/project-engine', 'packages/process-manager',
  'packages/model-gateway', 'packages/agent-tools', 'packages/agent',
  'packages/runtime', 'apps/cli',
];

const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function tsc(cwd) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(`tsc failed in ${cwd}:\n${stdout}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

for (const rel of ORDER) {
  console.log(`building ${rel}...`);
  await tsc(path.join(ROOT, rel));
}
console.log('all packages built');
