'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildUpdate } = require('./build-update.cjs');
const { createUpdateManager } = require('../packages/core/update.cjs');

const FIRST_VERSION = '0.0.1-self-test';
const SECOND_VERSION = '0.0.2-self-test';

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function defaultRunCommand(file, args, options = {}) {
  return execFileSync(file, args, { stdio: 'pipe', ...options });
}

function fixedFailure(code) {
  return { ok: false, code: ['UPDATE_GPG_UNAVAILABLE', 'UPDATE_VERIFY_FAILED'].includes(code) ? code : 'UPDATE_VERIFY_FAILED' };
}

function parseFingerprint(output) {
  const line = String(output).split('\n').find((entry) => entry.startsWith('fpr:::::::::'));
  const fingerprint = line?.split(':')[9]?.toUpperCase();
  if (!/^[A-F0-9]{40,64}$/.test(fingerprint || '')) throw new VerificationError('UPDATE_VERIFY_FAILED');
  return fingerprint;
}

function makePrivateDirectory(root, name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return directory;
}

function createFixtureBundle(root) {
  const bundle = path.join(root, 'bundle');
  fs.mkdirSync(path.join(bundle, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'electron', 'runtime.txt'), 'self-test\n');
  fs.writeFileSync(path.join(bundle, 'bundle-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    platform: 'linux-x64',
    sourceRevision: 'update-self-test',
  })}\n`);
  const launcher = path.join(bundle, 'run.sh');
  fs.writeFileSync(launcher, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(launcher, 0o755);
  return bundle;
}

function runVerification({
  gpgBinary = 'gpg',
  runCommand = defaultRunCommand,
  clock = Date.now,
} = {}) {
  let temporaryRoot;
  const started = clock();
  try {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-update-verify-'));
    const signerHome = makePrivateDirectory(temporaryRoot, 'signer');
    const verifierHome = makePrivateDirectory(temporaryRoot, 'verifier');
    const batchPath = path.join(temporaryRoot, 'key.batch');
    fs.writeFileSync(batchPath, [
      '%no-protection',
      'Key-Type: RSA',
      'Key-Length: 2048',
      'Name-Real: Coding Help Update Self Test',
      'Name-Email: update-self-test@example.invalid',
      'Expire-Date: 1d',
      '%commit',
      '',
    ].join('\n'));

    const runGpg = (args, options = {}) => {
      try {
        return runCommand(gpgBinary, args, options);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new VerificationError('UPDATE_GPG_UNAVAILABLE');
        throw error;
      }
    };
    const command = (file, args, options = {}) => file === gpgBinary ? runGpg(args, options) : runCommand(file, args, options);

    runGpg(['--batch', '--yes', '--no-options', '--homedir', signerHome, '--generate-key', batchPath], { encoding: 'utf8' });
    const fingerprint = parseFingerprint(runGpg([
      '--batch', '--no-options', '--homedir', signerHome, '--with-colons', '--list-keys',
    ], { encoding: 'utf8' }));
    const publicKeyPath = path.join(temporaryRoot, 'public-key.asc');
    fs.writeFileSync(publicKeyPath, runGpg([
      '--batch', '--no-options', '--homedir', signerHome, '--armor', '--export', fingerprint,
    ]));

    const bundle = createFixtureBundle(temporaryRoot);
    const updates = path.join(temporaryRoot, 'updates');
    const first = buildUpdate(bundle, updates, FIRST_VERSION, { gpgBinary, gpgHome: signerHome, fingerprint, runCommand: command });
    const second = buildUpdate(bundle, updates, SECOND_VERSION, { gpgBinary, gpgHome: signerHome, fingerprint, runCommand: command });
    const manager = createUpdateManager({
      installRoot: path.join(temporaryRoot, 'install'),
      gpgBinary,
      gpgHome: verifierHome,
      publicKeyPath,
      trustedFingerprint: fingerprint,
      runCommand: command,
    });

    const firstApplied = manager.applyUpdate(first);
    const secondApplied = manager.applyUpdate(second);
    const beforeRollback = manager.getCurrent();
    const rollbackVersion = manager.rollback();
    const afterRollback = manager.getCurrent();
    if (
      firstApplied !== FIRST_VERSION ||
      secondApplied !== SECOND_VERSION ||
      beforeRollback.version !== SECOND_VERSION ||
      beforeRollback.previousVersion !== FIRST_VERSION ||
      rollbackVersion !== FIRST_VERSION ||
      afterRollback.version !== FIRST_VERSION ||
      afterRollback.previousVersion !== SECOND_VERSION
    ) throw new VerificationError('UPDATE_VERIFY_FAILED');

    return {
      ok: true,
      provider: 'gpg+tar+update-manager',
      version: SECOND_VERSION,
      rollbackVersion,
      checks: { signature: true, archive: true, rollback: true },
      duration_ms: Math.round(Math.max(0, Number(clock()) - Number(started)) * 100) / 100,
    };
  } catch (error) {
    return fixedFailure(error?.code);
  } finally {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const result = runVerification();
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.ok) process.stdout.write(`Update verification passed: ${result.version}, rollback ${result.rollbackVersion}.\n`);
  else process.stdout.write(`NOT VERIFIED: ${result.code}.\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { FIRST_VERSION, SECOND_VERSION, parseFingerprint, runVerification, main };
