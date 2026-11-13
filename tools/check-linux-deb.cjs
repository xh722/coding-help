'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultOutput, packageName } = require('./build-linux-deb.cjs');

const deb = path.resolve(process.argv[2] || process.env.CODING_HELP_DEB_FILE || defaultOutput);
if (!fs.existsSync(deb) || fs.statSync(deb).size === 0) throw new Error(`Missing Debian package: ${deb}`);
function field(name) {
  return execFileSync('dpkg-deb', ['-f', deb, name], { encoding: 'utf8' }).trim();
}
if (field('Package') !== packageName || field('Architecture') !== 'amd64') throw new Error('Unexpected Debian package identity.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName}-deb-check-`));
try {
  execFileSync('dpkg-deb', ['-x', deb, stage], { stdio: 'pipe' });
  const installRoot = path.join(stage, 'opt', packageName);
  const launcher = path.join(stage, 'usr', 'bin', packageName);
  const desktop = path.join(stage, 'usr', 'share', 'applications', `${packageName}.desktop`);
  if (!fs.existsSync(path.join(installRoot, 'bundle-manifest.json')) || !fs.existsSync(path.join(installRoot, 'run.sh'))) throw new Error('Debian package does not contain the application bundle.');
  if (!fs.existsSync(launcher) || (fs.statSync(launcher).mode & 0o111) === 0) throw new Error('Debian package launcher is missing or not executable.');
  if (!fs.existsSync(desktop) || !fs.readFileSync(desktop, 'utf8').includes(`Exec=/usr/bin/${packageName}`)) throw new Error('Debian desktop entry is missing or points to the wrong launcher.');
  execFileSync(process.execPath, [path.join(__dirname, 'check-linux-bundle.cjs'), installRoot], {
    env: process.env, stdio: 'pipe',
  });
  console.log(`Debian package verified: ${packageName} ${field('Version')} amd64.`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
