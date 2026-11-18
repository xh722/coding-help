'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReport } = require('../tools/local-capability-preflight.cjs');

test('capability report classifies ready, unavailable and configuration states', () => {
  const report = buildReport({
    ocrProbe: () => ({ ok: true, code: 'OCR_READY', languages: ['chi_sim', 'eng'], missing: [] }),
    audioProbe: () => ({ ok: false, reason: 'audio probe unavailable', display: { available: false } }),
    asrProbe: () => ({ ok: false, code: 'ASR_MODEL_MISSING', message: 'model path is missing' }),
    updateProbe: () => ({ ok: true, code: 'UPDATE_TOOLS_READY', tools: { gpg: true, tar: true } }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.code, 'CAPABILITIES_PARTIAL');
  assert.deepEqual(report.summary, { checked: 4, ready: 2, unavailable: 1, needs_configuration: 1 });
  assert.equal(report.checks.ocr.status, 'ready');
  assert.equal(report.checks.audio.status, 'unavailable');
  assert.equal(report.checks.asr.status, 'needs_configuration');
  assert.equal(report.checks.update.status, 'ready');
});

test('capability report keeps probe output bounded and redacted', () => {
  const report = buildReport({
    ocrProbe: () => ({ ok: false, code: 'OCR_LANGUAGE_MISSING', languages: ['eng'], missing: ['chi_sim'], tessdata: '/private/tessdata' }),
    audioProbe: () => ({ ok: false, reason: 'private device /secret/audio', alsa: { cards: 4 }, pulse: { sources: 2 } }),
    asrProbe: () => ({ ok: false, code: 'ASR_RUNTIME_UNAVAILABLE', message: 'private model /secret/model' }),
    updateProbe: () => ({ ok: false, code: 'UPDATE_TOOLS_MISSING', tools: { gpg: false, tar: true }, stderr: 'private failure' }),
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /private|secret|tessdata|stderr/);
  assert.equal(report.checks.ocr.languages[0], 'eng');
  assert.equal(report.checks.audio.reason, 'audio probe unavailable');
  assert.equal(report.checks.asr.message, 'ASR runtime is unavailable.');
  assert.deepEqual(report.checks.update.tools, { gpg: false, tar: true });
});

test('capability report converts malformed probes to a fixed failure', () => {
  const report = buildReport({
    ocrProbe: () => ({ ok: true, code: 'OCR_READY' }),
    audioProbe: () => { throw new Error('/private/audio'); },
    asrProbe: () => null,
    updateProbe: () => ({ ok: true, code: 'UPDATE_TOOLS_READY', tools: { gpg: true, tar: true } }),
  });
  assert.equal(report.checks.audio.code, 'CAPABILITY_PROBE_FAILED');
  assert.equal(report.checks.asr.code, 'CAPABILITY_PROBE_FAILED');
  assert.equal(report.checks.audio.status, 'unavailable');
});

test('deep capability report records sanitized OCR and update regressions', () => {
  const report = buildReport({
    deep: true,
    ocrProbe: () => ({ ok: true, code: 'OCR_READY', languages: ['eng'], missing: [] }),
    audioProbe: () => ({ ok: true, reason: 'audio input detected', display: { available: true } }),
    asrProbe: () => ({ ok: true, code: 'ASR_READY', message: 'ready' }),
    updateProbe: () => ({ ok: true, code: 'UPDATE_TOOLS_READY', tools: { gpg: true, tar: true } }),
    ocrVerify: () => ({ ok: true, chars: 14, matchesExpected: true, text: 'private screen text' }),
    updateVerify: () => ({ ok: true, checks: { signature: true, archive: true, rollback: true }, fingerprint: 'private-fingerprint', path: '/private/update' }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.deep, true);
  assert.deepEqual(report.regressions, { checked: 2, ready: 2, unavailable: 0 });
  assert.deepEqual(report.checks.ocr.deep, {
    status: 'ready',
    code: 'OCR_REGRESSION_READY',
    chars: 14,
    matchesExpected: true,
  });
  assert.deepEqual(report.checks.update.deep, {
    status: 'ready',
    code: 'UPDATE_REGRESSION_READY',
    checks: { signature: true, archive: true, rollback: true },
  });
  assert.doesNotMatch(JSON.stringify(report), /private|fingerprint|update\/|screen text/);
});

test('deep capability report distinguishes regression failure from base readiness', () => {
  const report = buildReport({
    deep: true,
    ocrProbe: () => ({ ok: true, code: 'OCR_READY', languages: ['eng'], missing: [] }),
    audioProbe: () => ({ ok: true, reason: 'audio input detected', display: { available: true } }),
    asrProbe: () => ({ ok: true, code: 'ASR_READY', message: 'ready' }),
    updateProbe: () => ({ ok: true, code: 'UPDATE_TOOLS_READY', tools: { gpg: true, tar: true } }),
    ocrVerify: () => ({ ok: false, code: 'OCR_MISMATCH', text: 'private mismatch' }),
    updateVerify: () => ({ ok: false, code: 'UPDATE_VERIFY_FAILED', stderr: 'private failure' }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.code, 'CAPABILITIES_PARTIAL');
  assert.deepEqual(report.regressions, { checked: 2, ready: 0, unavailable: 2 });
  assert.deepEqual(report.checks.ocr.deep, { status: 'unavailable', code: 'OCR_REGRESSION_FAILED' });
  assert.deepEqual(report.checks.update.deep, { status: 'unavailable', code: 'UPDATE_REGRESSION_FAILED' });
  assert.doesNotMatch(JSON.stringify(report), /private|stderr/);
});
