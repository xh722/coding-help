'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultOutput: defaultBundleOutput } = require('./build-linux-bundle.cjs');

const repo = path.resolve(__dirname, '..');
const packageName = 'interviewcoder-local-rebuild';
const defaultOutput = path.join(repo, 'dist', `${packageName}_0.1.0_amd64.deb`);

function readAppPackage(bundle) {
  const file = path.join(bundle, 'resources', 'app', 'package.json');
  if (!fs.existsSync(file)) throw new Error(`Bundle app package is missing: ${file}`);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.name !== packageName || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value.version || '')) throw new Error('Bundle app package has an invalid product or version.');
  return value;
}

function copyExecutable(source, destination) {
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
}

function buildDeb(bundle = process.env.CODING_HELP_BUNDLE_DIR || defaultBundleOutput, output = process.env.CODING_HELP_DEB_FILE || defaultOutput, options = {}) {
  bundle = path.resolve(bundle); output = path.resolve(output);
  for (const required of ['electron', 'run.sh']) if (!fs.existsSync(path.join(bundle, required))) throw new Error(`Bundle file is missing: ${path.join(bundle, required)}`);
  const appPackage = readAppPackage(bundle);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName}-deb-`));
  try {
    const installRoot = path.join(stage, 'opt', packageName);
    fs.mkdirSync(installRoot, { recursive: true });
    fs.cpSync(bundle, installRoot, { recursive: true, dereference: false });
    const binDir = path.join(stage, 'usr', 'bin');
    const desktopDir = path.join(stage, 'usr', 'share', 'applications');
    const controlDir = path.join(stage, 'DEBIAN');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.mkdirSync(controlDir, { recursive: true });
    copyExecutable(path.join(repo, 'tools', 'linux-package-launcher.sh'), path.join(binDir, packageName));
    fs.writeFileSync(path.join(desktopDir, `${packageName}.desktop`), [
      '[Desktop Entry]', 'Type=Application', 'Name=InterviewCoder Local Rebuild',
      `Exec=/usr/bin/${packageName}`, 'Terminal=false', 'Categories=Utility;', '',
    ].join('\n'), { mode: 0o644 });
    fs.writeFileSync(path.join(controlDir, 'control'), [
      `Package: ${packageName}`, `Version: ${appPackage.version}`, 'Section: utils', 'Priority: optional',
      'Architecture: amd64', 'Maintainer: liuxu <19856850715@163.com>',
      'Description: InterviewCoder Local Rebuild', ' Local offline Electron desktop rebuild.', '',
    ].join('\n'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporaryOutput = `${output}.tmp-${process.pid}`;
    fs.rmSync(temporaryOutput, { force: true });
    const runPackageBuilder = options.runPackageBuilder || ((stagePath, outputPath) => execFileSync('dpkg-deb', ['--build', '--root-owner-group', stagePath, outputPath], { stdio: 'pipe' }));
    try {
      runPackageBuilder(stage, temporaryOutput);
      fs.renameSync(temporaryOutput, output);
    } finally {
      fs.rmSync(temporaryOutput, { force: true });
    }
    return { output, version: appPackage.version };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const result = buildDeb(process.argv[2], process.argv[3]);
  console.log(`Debian package created: ${result.output}`);
  console.log(`Version: ${result.version}`);
}

module.exports = { buildDeb, defaultOutput, packageName };
