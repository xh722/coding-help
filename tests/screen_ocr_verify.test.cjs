'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { EMBEDDED_SELF_TEST_PNG, runVerification } = require('../tools/screen-ocr-verify.cjs');

test('OCR verification uses an embedded PNG and reports only redacted metrics', async () => {
  let received;
  const result = await runVerification({
    recognizer: async ({ png, language }) => {
      received = { png, language };
      return { ok: true, text: 'LOCAL OCR TEST', language, chars: 14 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'embedded-self-test');
  assert.equal(result.matchesExpected, true);
  assert.equal(result.chars, 14);
  assert.equal(result.language, 'eng');
  assert.ok(received.png.equals(Buffer.from(EMBEDDED_SELF_TEST_PNG, 'base64')));
  assert.equal(received.language, 'eng');
  assert.doesNotMatch(JSON.stringify(result), /LOCAL OCR TEST/);
});

test('OCR verification reads a supplied PNG without exposing path or text', async () => {
  const result = await runVerification({
    pngPath: '/private/desktop.png',
    readFile: () => Buffer.from('png'),
    recognizer: async () => ({ ok: true, text: 'secret words', language: 'chi_sim+eng', chars: 12 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, 'provided-png');
  assert.equal(result.matchesExpected, null);
  assert.equal(result.chars, 12);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|desktop/);
});

test('OCR verification returns a fixed failure for unavailable OCR', async () => {
  const result = await runVerification({
    recognizer: async () => ({ ok: false, code: 'OCR_UNAVAILABLE' }),
  });
  assert.deepEqual(result, { ok: false, code: 'OCR_UNAVAILABLE', source: 'embedded-self-test' });
});
