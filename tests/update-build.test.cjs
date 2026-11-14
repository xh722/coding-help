'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildUpdate } = require('../tools/build-update.cjs');

function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function fixtureBundle() {
  const root = tempDir('coding-help-update-bundle-');
  fs.writeFileSync(path.join(root, 'electron'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify({ schemaVersion: 1, sourceRevision: 'a'.repeat(40) }) + '\n');
  return root;
}

test('update builder atomically emits archive, manifest and detached signature', () => {
  const bundle = fixtureBundle(); const output = tempDir('coding-help-update-output-');
  try {
    const runCommand = (file, args) => {
      if (file === 'tar') { fs.writeFileSync(args[args.indexOf('--file') + 1], 'fixture archive'); return ''; }
      if (file === 'gpg') { fs.writeFileSync(args[args.indexOf('--output') + 1], 'fixture signature'); return ''; }
      throw new Error(`unexpected command: ${file}`);
    };
    const result = buildUpdate(bundle, output, '1.2.3', { gpgHome: '/tmp/gpg', fingerprint: 'A'.repeat(40), runCommand });
    assert.equal(fs.existsSync(result.archivePath), true);
    assert.equal(fs.existsSync(result.manifestPath), true);
    assert.equal(fs.existsSync(result.signaturePath), true);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.deepEqual({ version: manifest.version, archive: manifest.archive, bytes: manifest.bytes }, { version: '1.2.3', archive: 'interviewcoder-local-rebuild-1.2.3-linux-x64.tar.gz', bytes: 'fixture archive'.length });
    assert.equal(manifest.sourceRevision, 'a'.repeat(40));
  } finally { fs.rmSync(bundle, { recursive: true, force: true }); fs.rmSync(output, { recursive: true, force: true }); }
});

test('update builder cleans staged artifacts when signing fails', () => {
  const bundle = fixtureBundle(); const output = tempDir('coding-help-update-failure-');
  try {
    assert.throws(() => buildUpdate(bundle, output, '1.2.4', {
      gpgHome: '/tmp/gpg', fingerprint: 'A'.repeat(40),
      runCommand: (file, args) => { if (file === 'tar') { fs.writeFileSync(args[args.indexOf('--file') + 1], 'fixture archive'); return ''; } throw new Error('signing failed'); },
    }), /signing failed/);
    assert.deepEqual(fs.readdirSync(output), []);
  } finally { fs.rmSync(bundle, { recursive: true, force: true }); fs.rmSync(output, { recursive: true, force: true }); }
});
