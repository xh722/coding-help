'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runVerification } = require('../tools/update-verify.cjs');

test('update verification maps a missing GPG executable to a fixed failure', async () => {
  const result = await runVerification({ gpgBinary: '/missing/coding-help-gpg' });
  assert.deepEqual(result, { ok: false, code: 'UPDATE_GPG_UNAVAILABLE' });
});

test('update verification redacts command failures and local paths', async () => {
  const result = await runVerification({
    gpgBinary: 'gpg',
    runCommand: () => { throw new Error('/private/update-root SECRET_FINGERPRINT'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UPDATE_VERIFY_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /private|SECRET_FINGERPRINT/);
});
