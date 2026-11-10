'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { defaultOutput, walk } = require('./build-linux-bundle.cjs');

const root = path.resolve(process.argv[2] || process.env.CODING_HELP_BUNDLE_DIR || defaultOutput);
const manifestPath = path.join(root, 'bundle-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing bundle manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.platform !== 'linux-x64') throw new Error('Unsupported bundle manifest.');
const expectedRevision = process.env.CODING_HELP_EXPECTED_REVISION;
if (expectedRevision && manifest.sourceRevision !== expectedRevision) throw new Error(`Bundle source revision mismatch: expected ${expectedRevision}, got ${manifest.sourceRevision || 'missing'}.`);
if (!fs.existsSync(path.join(root, 'electron')) || !fs.existsSync(path.join(root, 'resources', 'app', 'package.json'))) throw new Error('Bundle runtime or app package is missing.');
if ((fs.statSync(path.join(root, 'run.sh')).mode & 0o111) === 0) throw new Error('Bundle launcher is not executable.');
const actual = new Set(walk(root).map((file) => path.relative(root, file).split(path.sep).join('/')).filter((file) => file !== 'bundle-manifest.json'));
const listed = new Set();
for (const file of manifest.files) {
  if (listed.has(file.path) || !actual.has(file.path)) throw new Error(`Manifest file mismatch: ${file.path}`);
  listed.add(file.path);
  const full = path.join(root, file.path); const stat = fs.statSync(full);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  if (stat.size !== file.bytes || digest !== file.sha256) throw new Error(`Manifest hash mismatch: ${file.path}`);
}
if (listed.size !== actual.size) throw new Error(`Manifest is incomplete: listed ${listed.size}, actual ${actual.size}`);
const forbidden = ['interviewcoder-setup.exe', 'agent-windows.exe', 'libbot_desktop_rs.dll', 'coding-help.zip'];
for (const file of actual) if (forbidden.some((name) => file.toLowerCase().includes(name.toLowerCase()))) throw new Error(`Forbidden original artifact in bundle: ${file}`);
console.log(`Linux bundle verified: ${listed.size} files, SHA-256 manifest matches.`);
