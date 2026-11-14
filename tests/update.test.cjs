'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createUpdateManager, validateUpdateManifest } = require('../packages/core/update.cjs');

function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function createSigningHome(char = 'A') {
  const home = tempDir('coding-help-gpg-');
  fs.chmodSync(home, 0o700);
  const fingerprint = char.repeat(40);
  const publicKey = path.join(home, 'update-public-key.asc');
  fs.writeFileSync(publicKey, `FAKE PUBLIC KEY FOR ${fingerprint}\n`);
  return { home, fingerprint, publicKey };
}

function createArtifact({ root, signing, version, contents = 'version' }) {
  const payload = tempDir('coding-help-update-payload-');
  fs.writeFileSync(path.join(payload, 'electron'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(payload, 'run.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(payload, 'bundle-manifest.json'), JSON.stringify({ schemaVersion: 1, product: 'InterviewCoder Local Rebuild', platform: 'linux-x64', version, contents }) + '\n');
  fs.mkdirSync(path.join(payload, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'resources', 'app', 'version.txt'), contents);
  const archive = path.join(root, `bundle-${version}.tar.gz`);
  fs.writeFileSync(archive, `ARCHIVE:${version}:${contents}\n`);
  const manifestPath = path.join(root, `manifest-${version}.json`);
  const manifest = {
    schemaVersion: 1,
    product: 'interviewcoder-local-rebuild',
    platform: 'linux-x64',
    version,
    archive: path.basename(archive),
    bytes: fs.statSync(archive).size,
    sha256: sha256(archive),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(`${manifestPath}.asc`, `SIGNER:${signing.fingerprint}\n`);
  return { manifestPath, signaturePath: `${manifestPath}.asc`, archivePath: archive, version, payloadPath: payload };
}

function manager(root, signing, artifacts = new Map(), runTar) {
  const runCommand = (file, args, options = {}) => {
    if (file === 'gpg') {
      const signaturePath = args.at(-2);
      const signature = fs.readFileSync(signaturePath, 'utf8').trim();
      return `[GNUPG:] VALIDSIG ${signature.slice('SIGNER:'.length)} 0 0 0 0 0 0 0 0 0\n`;
    }
    if (file === 'tar') {
      const archivePath = args[args.indexOf('--file') + 1]; const payload = artifacts.get(archivePath);
      if (!payload) throw new Error(`missing payload for ${archivePath}`);
      if (args.includes('--list')) return './\n./bundle-manifest.json\n./run.sh\n./resources/\n./resources/app/\n./resources/app/version.txt\n';
      fs.cpSync(payload, args[args.indexOf('--directory') + 1], { recursive: true });
      return '';
    }
    return execFileSync(file, args, options);
  };
  return createUpdateManager({ installRoot: root, gpgHome: signing.home, trustedFingerprint: signing.fingerprint, runCommand, runTar: runTar || undefined });
}

test('update manifest validation rejects traversal, mismatched archive size and invalid versions', () => {
  assert.throws(() => validateUpdateManifest({ schemaVersion: 1, product: 'interviewcoder-local-rebuild', platform: 'linux-x64', version: '1.0.0', archive: '../bundle.tar.gz', bytes: 1, sha256: 'a'.repeat(64) }), /archive/i);
  assert.throws(() => validateUpdateManifest({ schemaVersion: 1, product: 'interviewcoder-local-rebuild', platform: 'linux-x64', version: '1.0.0', archive: 'bundle\\name.tar.gz', bytes: 1, sha256: 'a'.repeat(64) }), /archive/i);
  assert.throws(() => validateUpdateManifest({ schemaVersion: 1, product: 'interviewcoder-local-rebuild', platform: 'linux-x64', version: '1.0', archive: 'bundle.tar.gz', bytes: 1, sha256: 'a'.repeat(64) }), /version/i);
  assert.throws(() => validateUpdateManifest({ schemaVersion: 1, product: 'interviewcoder-local-rebuild', platform: 'linux-x64', version: '1.0.0', archive: 'bundle.tar.gz', bytes: -1, sha256: 'a'.repeat(64) }), /bytes/i);
});

test('signed update is staged, switched atomically, and rollback restores the previous version', () => {
  const root = tempDir('coding-help-update-root-'); const signing = createSigningHome();
  try {
    const first = createArtifact({ root, signing, version: '1.0.0', contents: 'first' });
    const second = createArtifact({ root, signing, version: '1.1.0', contents: 'second' });
    const updates = manager(root, signing, new Map([[first.archivePath, first.payloadPath], [second.archivePath, second.payloadPath]]));
    assert.deepEqual(updates.getCurrent(), { version: null, previousVersion: null });
    assert.equal(updates.applyUpdate(first), '1.0.0');
    assert.equal(fs.readFileSync(path.join(root, 'current', 'resources', 'app', 'version.txt'), 'utf8'), 'first');
    assert.equal(updates.applyUpdate(second), '1.1.0');
    assert.deepEqual(updates.getCurrent(), { version: '1.1.0', previousVersion: '1.0.0' });
    assert.equal(updates.rollback(), '1.0.0');
    assert.deepEqual(updates.getCurrent(), { version: '1.0.0', previousVersion: '1.1.0' });
    assert.equal(fs.readFileSync(path.join(root, 'current', 'resources', 'app', 'version.txt'), 'utf8'), 'first');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(signing.home, { recursive: true, force: true }); }
});

test('tampering, wrong signer and downgrade are rejected without changing current', () => {
  const root = tempDir('coding-help-update-reject-'); const signing = createSigningHome('A'); const other = createSigningHome('B');
  try {
    const first = createArtifact({ root, signing, version: '2.0.0', contents: 'stable' });
    const tampered = createArtifact({ root, signing, version: '2.1.0', contents: 'candidate' });
    const payloads = new Map([[first.archivePath, first.payloadPath], [tampered.archivePath, tampered.payloadPath]]);
    const updates = manager(root, signing, payloads);
    updates.applyUpdate(first);
    fs.appendFileSync(tampered.archivePath, 'tamper');
    assert.throws(() => updates.applyUpdate(tampered), /hash|size/i);
    assert.equal(updates.getCurrent().version, '2.0.0');
    const downgrade = createArtifact({ root, signing, version: '1.9.0', contents: 'old' });
    payloads.set(downgrade.archivePath, downgrade.payloadPath);
    assert.throws(() => updates.applyUpdate(downgrade), /downgrade/i);
    const wrong = createArtifact({ root, signing: other, version: '2.2.0', contents: 'wrong signer' });
    payloads.set(wrong.archivePath, wrong.payloadPath);
    assert.throws(() => updates.applyUpdate(wrong), /signature|fingerprint|signer/i);
    assert.equal(updates.getCurrent().version, '2.0.0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(signing.home, { recursive: true, force: true }); fs.rmSync(other.home, { recursive: true, force: true });
  }
});

test('failed extraction leaves no staging directory or partial current switch', () => {
  const root = tempDir('coding-help-update-failure-'); const signing = createSigningHome();
  try {
    const first = createArtifact({ root, signing, version: '1.0.0', contents: 'stable' });
    const broken = createArtifact({ root, signing, version: '1.1.0', contents: 'broken' });
    const updates = manager(root, signing, new Map([[first.archivePath, first.payloadPath], [broken.archivePath, broken.payloadPath]]));
    updates.applyUpdate(first);
    const failed = manager(root, signing, new Map([[broken.archivePath, broken.payloadPath]]), () => { throw new Error('simulated extraction failure'); });
    assert.throws(() => failed.applyUpdate(broken), /extraction failure/);
    assert.equal(updates.getCurrent().version, '1.0.0');
    assert.deepEqual(fs.readdirSync(path.join(root, 'versions')).filter((name) => name.startsWith('.staging-')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(signing.home, { recursive: true, force: true }); }
});
