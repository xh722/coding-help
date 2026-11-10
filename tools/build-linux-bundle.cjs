'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const defaultOutput = path.join(repo, 'dist', 'interviewcoder-local-rebuild-linux-x64');
const appFiles = ['apps', 'packages', 'services'];

function walk(root) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  visit(root); return files;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makeManifest(root, sourceRevision) {
  const files = walk(root).map((file) => ({ path: path.relative(root, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, sha256: sha256(file) }));
  return { schemaVersion: 1, product: 'InterviewCoder Local Rebuild', platform: 'linux-x64', sourceRevision, electronVersion: process.versions.electron || require('electron/package.json').version, files };
}

function build(output = process.env.CODING_HELP_BUNDLE_DIR || defaultOutput) {
  output = path.resolve(output);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const electronEntry = require.resolve('electron');
  const runtime = path.join(path.dirname(electronEntry), 'dist');
  if (!fs.existsSync(path.join(runtime, 'electron'))) throw new Error(`Electron runtime is missing at ${runtime}`);
  fs.cpSync(runtime, output, { recursive: true, dereference: false });
  const appRoot = path.join(output, 'resources', 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  for (const directory of appFiles) fs.cpSync(path.join(repo, directory), path.join(appRoot, directory), { recursive: true });
  const packageJson = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: packageJson.name, version: packageJson.version, private: true, main: packageJson.main }, null, 2) + '\n');
  const launcher = `#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/electron" "$@" "$root/resources/app"\n`;
  fs.writeFileSync(path.join(output, 'run.sh'), launcher, { mode: 0o755 });
  let sourceRevision = 'working-tree';
  try { sourceRevision = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
  const manifest = makeManifest(output, sourceRevision);
  fs.writeFileSync(path.join(output, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, manifest, appRoot };
}

if (require.main === module) {
  const result = build(process.argv[2]);
  console.log(`Linux bundle created: ${result.output}`);
  console.log(`Manifest files: ${result.manifest.files.length}`);
  console.log(`Electron: ${result.manifest.electronVersion}`);
}

module.exports = { build, makeManifest, walk, defaultOutput };
