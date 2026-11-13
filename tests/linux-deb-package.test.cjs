'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildDeb } = require('../tools/build-linux-deb.cjs');

function fixtureBundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-deb-bundle-'));
  const files = {
    'electron': '#!/bin/sh\n',
    'run.sh': '#!/bin/sh\nexec "$PWD/electron" "$PWD/resources/app"\n',
    'resources/app/package.json': '{"name":"interviewcoder-local-rebuild","version":"0.1.0"}\n',
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

test('Debian package builder creates install, launcher and desktop entry', () => {
  const bundle = fixtureBundle();
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-deb-out-')), 'interviewcoder-local-rebuild_0.1.0_amd64.deb');
  try {
    const build = spawnSync(process.execPath, ['tools/build-linux-deb.cjs', bundle, output], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.equal(fs.existsSync(output), true);
    const fields = spawnSync('dpkg-deb', ['-f', output, 'Package', 'Version', 'Architecture'], { encoding: 'utf8' });
    assert.equal(fields.status, 0, fields.stderr);
    assert.match(fields.stdout, /Package: interviewcoder-local-rebuild\nVersion: 0\.1\.0\nArchitecture: amd64\n/);
    const contents = spawnSync('dpkg-deb', ['-c', output], { encoding: 'utf8' });
    assert.equal(contents.status, 0, contents.stderr);
    assert.match(contents.stdout, /opt\/interviewcoder-local-rebuild\/run\.sh/);
    assert.match(contents.stdout, /usr\/bin\/interviewcoder-local-rebuild/);
    assert.match(contents.stdout, /usr\/share\/applications\/interviewcoder-local-rebuild\.desktop/);
  } finally {
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});

test('Debian package checker validates the embedded bundle revision', () => {
  const bundle = fixtureBundle();
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-deb-check-')), 'fixture.deb');
  try {
    const build = spawnSync(process.execPath, ['tools/build-linux-deb.cjs', bundle, output], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const good = spawnSync(process.execPath, ['tools/check-linux-deb.cjs', output], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, CODING_HELP_EXPECTED_REVISION: 'a'.repeat(40) }, encoding: 'utf8',
    });
    assert.equal(good.status, 0, `${good.stdout}\n${good.stderr}`);
    const bad = spawnSync(process.execPath, ['tools/check-linux-deb.cjs', output], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, CODING_HELP_EXPECTED_REVISION: 'b'.repeat(40) }, encoding: 'utf8',
    });
    assert.notEqual(bad.status, 0);
    assert.match(`${bad.stdout}\n${bad.stderr}`, /source revision/i);
  } finally {
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});

test('Debian package builder does not leave a partial archive when dpkg-deb fails', () => {
  const bundle = fixtureBundle();
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-deb-failure-')), 'fixture.deb');
  try {
    assert.throws(() => buildDeb(bundle, output, {
      runPackageBuilder: () => { throw new Error('simulated dpkg-deb failure'); },
    }), /simulated dpkg-deb failure/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.rmSync(path.dirname(output), { recursive: true, force: true });
  }
});
