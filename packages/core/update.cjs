'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PRODUCT = 'interviewcoder-local-rebuild';
const PLATFORM = 'linux-x64';
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;
const FINGERPRINT_PATTERN = /^[A-F0-9]{40,64}$/;

class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

function fail(code, message) { throw new UpdateError(code, message); }

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value || '');
  if (!match) fail('UPDATE_INVALID_VERSION', 'Update version is invalid.');
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || null };
}

function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const aParts = a.prerelease.split('.'); const bParts = b.prerelease.split('.');
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    if (index >= aParts.length) return -1;
    if (index >= bParts.length) return 1;
    const aPart = aParts[index]; const bPart = bParts[index];
    if (aPart === bPart) continue;
    const aNumeric = /^[0-9]+$/.test(aPart); const bNumeric = /^[0-9]+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) > Number(bPart) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

function validateUpdateManifest(value, { product = PRODUCT, platform = PLATFORM } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('UPDATE_INVALID_MANIFEST', 'Update manifest is invalid.');
  if (value.schemaVersion !== 1 || value.product !== product || value.platform !== platform) fail('UPDATE_INVALID_MANIFEST', 'Update manifest is not for this product or platform.');
  parseVersion(value.version);
  if (typeof value.archive !== 'string' || !value.archive || value.archive.includes('\\') || value.archive !== path.basename(value.archive) || value.archive === '.' || value.archive === '..') fail('UPDATE_INVALID_ARCHIVE', 'Update archive path is invalid.');
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) fail('UPDATE_INVALID_BYTES', 'Update archive bytes are invalid.');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail('UPDATE_INVALID_HASH', 'Update archive hash is invalid.');
  const manifest = { schemaVersion: 1, product: value.product, platform: value.platform, version: value.version, archive: value.archive, bytes: value.bytes, sha256: value.sha256 };
  if (typeof value.sourceRevision === 'string' && value.sourceRevision) manifest.sourceRevision = value.sourceRevision;
  return Object.freeze(manifest);
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function normalizeFingerprint(value) {
  const fingerprint = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!FINGERPRINT_PATTERN.test(fingerprint)) fail('UPDATE_INVALID_KEY', 'Trusted update key fingerprint is invalid.');
  return fingerprint;
}

function readManifest(filePath, options) {
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { fail('UPDATE_INVALID_MANIFEST', 'Update manifest could not be read.'); }
  return validateUpdateManifest(value, options);
}

function verifySignature({ manifestPath, signaturePath, gpgBinary, gpgHome, publicKeyPath, trustedFingerprint, runCommand }) {
  const fingerprint = normalizeFingerprint(trustedFingerprint);
  if (publicKeyPath) {
    if (!gpgHome) fail('UPDATE_INVALID_KEY', 'An isolated GPG home is required when importing a public key.');
    runCommand(gpgBinary, ['--batch', '--homedir', gpgHome, '--import', publicKeyPath]);
  }
  const args = ['--batch', '--no-options', '--status-fd', '1'];
  if (gpgHome) args.push('--homedir', gpgHome);
  args.push('--verify', signaturePath, manifestPath);
  let output;
  try { output = runCommand(gpgBinary, args, { encoding: 'utf8' }); } catch { fail('UPDATE_INVALID_SIGNATURE', 'Update manifest signature is invalid.'); }
  const validLine = String(output).split('\n').find((line) => line.startsWith('[GNUPG:] VALIDSIG '));
  const actual = validLine?.split(/\s+/)[2]?.toUpperCase();
  if (!actual || actual !== fingerprint) fail('UPDATE_UNTRUSTED_SIGNER', 'Update manifest signer is not trusted.');
  return actual;
}

function safeTarEntries(listing) {
  for (const raw of String(listing).split('\n')) {
    const entry = raw.trim();
    if (!entry || entry === '.') continue;
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) fail('UPDATE_UNSAFE_ARCHIVE', 'Update archive contains an unsafe path.');
  }
}

function pointerTarget(filePath, root, fsImpl = fs) {
  let stat;
  try { stat = fsImpl.lstatSync(filePath); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (!stat.isSymbolicLink()) fail('UPDATE_POINTER_INVALID', 'Update pointer is not a symbolic link.');
  const target = fsImpl.readlinkSync(filePath);
  const absolute = path.resolve(path.dirname(filePath), target);
  const versionsRoot = path.resolve(root, 'versions');
  if (absolute !== versionsRoot && !absolute.startsWith(`${versionsRoot}${path.sep}`)) fail('UPDATE_POINTER_INVALID', 'Update pointer leaves the versions directory.');
  return absolute;
}

function atomicPointer(filePath, target, root, fsImpl = fs) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fsImpl.symlinkSync(path.relative(path.dirname(filePath), target), temporary);
  try { fsImpl.renameSync(temporary, filePath); } finally { try { fsImpl.unlinkSync(temporary); } catch {} }
}

function createUpdateManager({
  installRoot,
  product = PRODUCT,
  platform = PLATFORM,
  gpgBinary = 'gpg',
  gpgHome,
  publicKeyPath,
  trustedFingerprint,
  tarBinary = 'tar',
  fsImpl = fs,
  runCommand = (file, args, options = {}) => execFileSync(file, args, { stdio: 'pipe', ...options }),
  runTar: injectedRunTar,
  allowDowngrade = false,
} = {}) {
  if (typeof installRoot !== 'string' || !installRoot) throw new TypeError('installRoot is required.');
  const root = path.resolve(installRoot);
  const fingerprint = normalizeFingerprint(trustedFingerprint);
  if (publicKeyPath && !gpgHome) fail('UPDATE_INVALID_KEY', 'An isolated GPG home is required when importing a public key.');
  const versionsRoot = path.join(root, 'versions');
  const currentPointer = path.join(root, 'current');
  const previousPointer = path.join(root, 'previous');
  fsImpl.mkdirSync(versionsRoot, { recursive: true, mode: 0o755 });

  let runTar = injectedRunTar || ((args) => runCommand(tarBinary, args));
  function getCurrent() {
    const current = pointerTarget(currentPointer, root, fsImpl); const previous = pointerTarget(previousPointer, root, fsImpl);
    return { version: current ? path.basename(current) : null, previousVersion: previous ? path.basename(previous) : null };
  }

  function switchPointers(nextTarget, oldCurrent, oldPrevious) {
    if (oldCurrent) atomicPointer(previousPointer, oldCurrent, root, fsImpl);
    else { try { fsImpl.unlinkSync(previousPointer); } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
    try { atomicPointer(currentPointer, nextTarget, root, fsImpl); } catch (error) {
      if (oldPrevious) atomicPointer(previousPointer, oldPrevious, root, fsImpl);
      throw error;
    }
  }

  function applyUpdate({ manifestPath, signaturePath, archivePath }) {
    const manifest = readManifest(manifestPath, { product, platform });
    const current = getCurrent();
    if (!allowDowngrade && current.version && compareVersions(manifest.version, current.version) <= 0) fail('UPDATE_DOWNGRADE', 'Update would downgrade or repeat the current version.');
    verifySignature({ manifestPath, signaturePath, gpgBinary, gpgHome, publicKeyPath, trustedFingerprint: fingerprint, runCommand });
    let stat;
    try { stat = fsImpl.statSync(archivePath); } catch { fail('UPDATE_ARCHIVE_MISSING', 'Update archive is missing.'); }
    if (path.basename(archivePath) !== manifest.archive || stat.size !== manifest.bytes || sha256(archivePath) !== manifest.sha256) fail('UPDATE_ARCHIVE_MISMATCH', 'Update archive hash or size does not match the manifest.');
    const versionPath = path.join(versionsRoot, manifest.version);
    if (fsImpl.existsSync(versionPath)) fail('UPDATE_ALREADY_INSTALLED', 'Update version is already installed.');
    const staging = fsImpl.mkdtempSync(path.join(versionsRoot, `.staging-${manifest.version}-`));
    try {
      safeTarEntries(runTar(['--list', '--file', archivePath, '--gzip', '--quoting-style', 'escape']));
      runTar(['--extract', '--file', archivePath, '--gzip', '--directory', staging, '--no-same-owner', '--no-same-permissions']);
      const bundleManifest = path.join(staging, 'bundle-manifest.json');
      if (!fsImpl.existsSync(bundleManifest) || !fsImpl.existsSync(path.join(staging, 'run.sh'))) fail('UPDATE_INVALID_PAYLOAD', 'Update payload is missing its bundle files.');
      fsImpl.writeFileSync(path.join(staging, 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      fsImpl.renameSync(staging, versionPath);
      switchPointers(versionPath, pointerTarget(currentPointer, root, fsImpl), pointerTarget(previousPointer, root, fsImpl));
      return manifest.version;
    } catch (error) {
      fsImpl.rmSync(staging, { recursive: true, force: true });
      fsImpl.rmSync(versionPath, { recursive: true, force: true });
      throw error;
    }
  }

  function rollback() {
    const current = pointerTarget(currentPointer, root, fsImpl); const previous = pointerTarget(previousPointer, root, fsImpl);
    if (!previous) fail('UPDATE_NO_ROLLBACK', 'No previous update is available.');
    switchPointers(previous, current, previous);
    return path.basename(previous);
  }

  return { applyUpdate, rollback, getCurrent, verifyManifest: (manifestPath, signaturePath) => { const manifest = readManifest(manifestPath, { product, platform }); verifySignature({ manifestPath, signaturePath, gpgBinary, gpgHome, publicKeyPath, trustedFingerprint: fingerprint, runCommand }); return manifest; } };
}

module.exports = { createUpdateManager, validateUpdateManifest, compareVersions, UpdateError, PRODUCT, PLATFORM };
