'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-bundle-'));
  const files = {
    'electron': '#!/bin/sh\n',
    'run.sh': '#!/bin/sh\n',
    'resources/app/package.json': '{"name":"interviewcoder-local-rebuild","version":"0.1.0"}\n',
    'sbom.cdx.json': JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', metadata: { component: { type: 'application', name: 'interviewcoder-local-rebuild', version: '0.1.0' }, properties: [{ name: 'sourceRevision', value: 'a'.repeat(40) }] }, components: [] }) + '\n',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  fs.chmodSync(path.join(root, 'run.sh'), 0o755);
  const entries = Object.keys(files).sort().map((relative) => {
    const full = path.join(root, relative);
    return { path: relative, bytes: fs.statSync(full).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') };
  });
  fs.writeFileSync(path.join(root, 'bundle-manifest.json'), JSON.stringify({
    schemaVersion: 1, product: 'InterviewCoder Local Rebuild', platform: 'linux-x64', sourceRevision: 'a'.repeat(40), electronVersion: 'fixture', files: entries,
  }) + '\n');
  return root;
}

function runChecker(root, expectedRevision) {
  return spawnSync(process.execPath, ['tools/check-linux-bundle.cjs', root], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CODING_HELP_EXPECTED_REVISION: expectedRevision },
    encoding: 'utf8',
  });
}

test('bundle checker enforces the expected source revision when CI supplies one', () => {
  const root = writeFixture();
  try {
    assert.equal(runChecker(root, 'a'.repeat(40)).status, 0);
    const mismatch = runChecker(root, 'b'.repeat(40));
    assert.notEqual(mismatch.status, 0);
    assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /source revision/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bundle checker rejects a missing SBOM', () => {
  const root = writeFixture();
  try {
    fs.unlinkSync(path.join(root, 'sbom.cdx.json'));
    const result = runChecker(root, 'a'.repeat(40));
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /SBOM/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
