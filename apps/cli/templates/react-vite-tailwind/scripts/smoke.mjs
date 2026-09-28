import fs from 'node:fs';
const required = ['package.json', 'index.html', 'src/App.tsx', 'src/main.tsx', 'src/index.css', 'vite.config.ts', 'tailwind.config.js'];
let ok = true;
for (const f of required) {
  if (!fs.existsSync(new URL(`../${f}`, import.meta.url))) { console.error(`missing ${f}`); ok = false; }
}
console.log(ok ? 'tailwind template smoke test passed' : 'tailwind template smoke test FAILED');
process.exit(ok ? 0 : 1);
