'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let checked = 0;
for (const directory of ['apps', 'packages', 'services', 'tests', 'tools']) {
  const base = path.join(root, directory);
  for (const file of fs.readdirSync(base, { recursive: true })) {
    if (!/\.(?:cjs|js)$/.test(file)) continue;
    const target = path.join(base, file);
    if (!fs.statSync(target).isFile()) continue;
    const result = spawnSync(process.execPath, ['--check', target], { stdio: 'inherit' });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
    checked++;
  }
}
if (!checked) { console.error('NOT VERIFIED: no JavaScript source files found'); process.exit(2); }
console.log(`Syntax checked ${checked} JavaScript files.`);
