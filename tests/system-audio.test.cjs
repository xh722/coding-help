'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemAudioCapabilityProvider, createSystemAudioProvider } = require('../packages/providers/system-audio.cjs');

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

test('system audio provider owns the bounded main-process handshake and lifecycle', () => {
  let now = 0; let nextTimer = 0; const timers = new Map(); const controls = []; const events = []; const chunks = [];
  const clock = { now: () => now, setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id) };
  const provider = createSystemAudioProvider({ sendControl: (event) => controls.push(event), idFactory: () => 'system-1', clock });
  provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk) => chunks.push(chunk) });
  assert.equal(provider.getState(), 'requesting'); assert.equal(provider.permissionExpected(), true); assert.equal(controls[0].type, 'system-audio.start');
  assert.deepEqual(provider.ready({ captureId: 'system-1', sampleRate: 48000, channels: 1 }), { ok: true, accepted: true });
  assert.equal(provider.push({ captureId: 'system-1', sequence: 0, data: new Uint8Array(4) }).accepted, true);
  assert.equal(chunks.length, 1); provider.pause(); assert.equal(controls.at(-1).type, 'system-audio.stop'); assert.equal(provider.getState(), 'paused');
  provider.resume(); assert.equal(provider.getState(), 'requesting'); provider.stop(); assert.equal(provider.permissionExpected(), false); assert.equal(timers.size, 0); assert.ok(events.some((event) => event.type === 'audio.paused'));
});
