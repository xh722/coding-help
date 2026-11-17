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
