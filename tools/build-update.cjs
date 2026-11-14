'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateUpdateManifest, PRODUCT, PLATFORM } = require('../packages/core/update.cjs');

const PACKAGE_NAME = 'interviewcoder-local-rebuild';

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function buildUpdate(bundle, outputDir, version, { gpgBinary = 'gpg', gpgHome = process.env.CODING_HELP_GPG_HOME, fingerprint = process.env.CODING_HELP_UPDATE_FINGERPRINT, runCommand = (file, args, options = {}) => execFileSync(file, args, { stdio: 'pipe', ...options }) } = {}) {
  bundle = path.resolve(bundle); outputDir = path.resolve(outputDir);
  if (!fs.existsSync(path.join(bundle, 'bundle-manifest.json')) || !fs.existsSync(path.join(bundle, 'run.sh')) || !fs.existsSync(path.join(bundle, 'electron'))) throw new Error('Bundle is missing required release files.');
  const archiveName = `${PACKAGE_NAME}-${version}-${PLATFORM}.tar.gz`;
  const manifestName = `${PACKAGE_NAME}-${version}-${PLATFORM}.manifest.json`;
  const archivePath = path.join(outputDir, archiveName);
  const manifestPath = path.join(outputDir, manifestName);
  const signaturePath = `${manifestPath}.asc`;
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of [archivePath, manifestPath, signaturePath]) if (fs.existsSync(file)) throw new Error(`Update artifact already exists: ${path.basename(file)}`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `${PACKAGE_NAME}-update-`));
  const stagedArchive = path.join(stage, archiveName); const stagedManifest = path.join(stage, manifestName); const stagedSignature = `${stagedManifest}.asc`;
  try {
    runCommand('tar', ['--create', '--gzip', '--file', stagedArchive, '--directory', bundle, '.']);
    const bundleManifest = JSON.parse(fs.readFileSync(path.join(bundle, 'bundle-manifest.json'), 'utf8'));
    const manifest = validateUpdateManifest({ schemaVersion: 1, product: PACKAGE_NAME, platform: PLATFORM, version, archive: archiveName, bytes: fs.statSync(stagedArchive).size, sha256: sha256(stagedArchive), sourceRevision: bundleManifest.sourceRevision || null });
    fs.writeFileSync(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    if (!gpgHome || typeof fingerprint !== 'string' || !fingerprint) throw new Error('GPG home and update signing fingerprint are required.');
    runCommand(gpgBinary, ['--batch', '--yes', '--no-options', '--homedir', gpgHome, '--local-user', fingerprint, '--armor', '--detach-sign', '--output', stagedSignature, stagedManifest]);
    try {
      fs.renameSync(stagedArchive, archivePath); fs.renameSync(stagedManifest, manifestPath); fs.renameSync(stagedSignature, signaturePath);
      return { archivePath, manifestPath, signaturePath, version };
    } catch (error) {
      for (const file of [archivePath, manifestPath, signaturePath]) fs.rmSync(file, { force: true });
      throw error;
    }
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) {
  const [bundle, outputDir, version] = process.argv.slice(2);
  if (!bundle || !outputDir || !version) throw new Error('Usage: node tools/build-update.cjs <bundle> <output-dir> <version>');
  const result = buildUpdate(bundle, outputDir, version);
  console.log(`Update artifact created: ${result.manifestPath}`);
}

module.exports = { buildUpdate, sha256, PRODUCT, PLATFORM };
