'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectEnvironment } = require('../tools/screen-ocr-preflight.cjs');

function runnerFor({ version = 'tesseract 5.3.0', languages = 'List of available languages in "/private/path":\nchi_sim\neng\n' } = {}) {
  return (_command, args) => ({ status: 0, stdout: args[0] === '--version' ? version : languages, stderr: '' });
}

test('OCR preflight reports ready only when Tesseract and both languages are available', () => {
  const result = inspectEnvironment({ runner: runnerFor() });
  assert.deepEqual(result, { ok: true, code: 'OCR_READY', languages: ['chi_sim', 'eng'], missing: [] });
});

test('OCR preflight returns a static unavailable result when Tesseract cannot start', () => {
  const result = inspectEnvironment({ runner: () => ({ status: null, error: new Error('spawn denied') }) });
  assert.deepEqual(result, { ok: false, code: 'OCR_UNAVAILABLE', languages: [], missing: ['chi_sim', 'eng'] });
});

test('OCR preflight reports missing language data without exposing the tessdata path', () => {
  const result = inspectEnvironment({ runner: runnerFor({ languages: 'List of available languages in "/secret/tessdata":\neng\n' }) });
  assert.deepEqual(result, { ok: false, code: 'OCR_LANGUAGE_MISSING', languages: ['eng'], missing: ['chi_sim'] });
  assert.doesNotMatch(JSON.stringify(result), /secret|tessdata|private/);
});

test('OCR preflight treats a failed language probe as unavailable', () => {
  const result = inspectEnvironment({ runner: (_command, args) => args[0] === '--version' ? { status: 0, stdout: 'tesseract 5.3.0' } : { status: 1, stdout: '', stderr: 'private failure' } });
  assert.deepEqual(result, { ok: false, code: 'OCR_UNAVAILABLE', languages: [], missing: ['chi_sim', 'eng'] });
});
