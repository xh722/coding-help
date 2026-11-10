'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemAudioCapabilityProvider } = require('../packages/providers/system-audio.cjs');

test('system audio probe is read-only and reports a potential platform path without starting capture', async () => {
  let calls = 0;
  const provider = createSystemAudioCapabilityProvider({ platform: 'linux', getSources: async (options) => { calls++; assert.deepEqual(options, undefined); return [{ id: 'screen:1' }]; } });
  const result = await provider.probe();
  assert.equal(calls, 1); assert.equal(result.capability, 'potential'); assert.equal(result.captureStarted, false); assert.equal(result.method, 'display-media');
});

test('system audio probe uses explicit unavailable results for missing APIs, no sources and errors', async () => {
  assert.deepEqual(await createSystemAudioCapabilityProvider({ platform: 'linux' }).probe(), { capability: 'unavailable', captureStarted: false, code: 'CAPTURE_API_UNAVAILABLE', message: 'Desktop audio capture is unavailable in this build.' });
  assert.equal((await createSystemAudioCapabilityProvider({ platform: 'linux', getSources: async () => [] }).probe()).code, 'NO_DESKTOP_SOURCE');
  assert.equal((await createSystemAudioCapabilityProvider({ platform: 'linux', getSources: async () => { throw new Error('private'); } }).probe()).code, 'CAPTURE_SOURCE_ERROR');
  assert.equal((await createSystemAudioCapabilityProvider({ platform: 'plan9', getSources: async () => [{ id: 'screen:1' }] }).probe()).code, 'PLATFORM_UNSUPPORTED');
});
