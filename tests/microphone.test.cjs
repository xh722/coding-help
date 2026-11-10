'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMicrophoneProvider } = require('../packages/providers/microphone.cjs');

function harness() {
  let n = 0; const controls = []; const events = []; const chunks = []; const timers = new Map();
  const clock = { setTimeout(fn) { timers.set(++n, fn); return n; }, clearTimeout(id) { timers.delete(id); } };
  const provider = createMicrophoneProvider({ sendControl: (event) => controls.push(event), idFactory: () => `capture-${++n}`, clock });
  const start = () => { provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk) => chunks.push([...chunk]) }); return controls.at(-1).captureId; };
  const ready = (captureId, sampleRate = 16000) => provider.ready({ captureId, sampleRate, channels: 1 });
  const push = (captureId, sequence = 0, data = new Uint8Array([1, 2])) => provider.push({ captureId, sequence, data });
  return { provider, controls, events, chunks, timers, start, ready, push };
}

test('microphone requires ready, checks sequence, and never includes PCM in events', () => {
  const h = harness(); const id = h.start();
  assert.equal(h.provider.getState(), 'requesting'); assert.equal(h.provider.permissionExpected(), true);
  assert.deepEqual(h.push(id), { ok: true, accepted: false });
  assert.deepEqual(h.ready(id, 48000), { ok: true, accepted: true });
  assert.equal(h.timers.size, 0); assert.equal(h.events.at(-1).sampleRate, 48000);
  assert.deepEqual(h.push(id), { ok: true, accepted: true });
  assert.deepEqual(h.chunks, [[1, 2]]);
  assert.equal(h.push(id).ok, false); assert.equal(h.provider.getState(), 'error');
  assert.ok(h.events.every((e) => !('data' in e) && !('captureId' in e)));
});

test('pause revokes capture, resume issues a new ID, and late packets cannot enter the next acquisition', () => {
  const h = harness(); const first = h.start(); h.ready(first); h.push(first);
  h.provider.pause(); assert.equal(h.provider.permissionExpected(), false);
  assert.deepEqual(h.controls.at(-1), { type: 'microphone.stop', captureId: first });
  assert.equal(h.push(first, 1).accepted, false);
  h.provider.resume(); const second = h.controls.at(-1).captureId; assert.notEqual(first, second);
  assert.equal(h.ready(first).accepted, false); assert.equal(h.provider.fail({ captureId: first, code: 'DEVICE_LOST' }).accepted, false);
  h.ready(second); assert.equal(h.push(first, 1).accepted, false); h.push(second);
  assert.equal(h.chunks.length, 2); h.provider.stop(); h.provider.stop();
  assert.equal(h.provider.permissionExpected(), false); assert.equal(h.timers.size, 0);
  assert.equal(h.events.filter((e) => e.type === 'audio.stopped').length, 1);
});

test('stop cancels pending acquisition and timeout closes an abandoned permission request', () => {
  const h = harness(); const id = h.start(); h.provider.stop();
  assert.equal(h.timers.size, 0); assert.equal(h.ready(id).accepted, false);
  h.start(); [...h.timers.values()][0]();
  assert.equal(h.provider.getState(), 'error'); assert.equal(h.provider.permissionExpected(), false);
  assert.equal(h.events.at(-1).code, 'MICROPHONE_TIMEOUT'); assert.equal(h.controls.at(-1).type, 'microphone.stop');
});

test('main rejects malformed or excessive PCM packets and invalid format metadata', () => {
  for (const data of [new Uint8Array(), new Uint8Array(3), new Uint8Array(16386), new Int16Array(2), [1, 2], new ArrayBuffer(2)]) {
    const h = harness(); const id = h.start(); h.ready(id);
    assert.equal(h.push(id, 0, data).ok, false); assert.equal(h.chunks.length, 0); assert.equal(h.provider.permissionExpected(), false);
  }
  for (const sequence of [-1, 0.5, NaN, Infinity, 1]) {
    const h = harness(); const id = h.start(); h.ready(id); assert.equal(h.push(id, sequence).ok, false);
  }
  for (const [sampleRate, channels] of [[0, 1], [16000.5, 1], [192001, 1], [48000, 2]]) {
    const h = harness(); const captureId = h.start();
    assert.equal(h.provider.ready({ captureId, sampleRate, channels }).ok, false); assert.equal(h.provider.getState(), 'error');
  }
});

test('device and consumer errors revoke capture and expose only static codes', () => {
  const h = harness(); const captureId = h.start();
  h.provider.fail({ captureId, code: 'secret /private/device' });
  assert.equal(h.events.at(-1).code, 'MICROPHONE_UNAVAILABLE'); assert.equal(JSON.stringify(h.events).includes('private'), false);
  const controls = []; const events = [];
  const p = createMicrophoneProvider({ sendControl: (e) => controls.push(e) });
  p.start({ onEvent: (e) => events.push(e), onChunk() { throw new Error('private'); } });
  const id = controls[0].captureId; p.ready({ captureId: id, sampleRate: 16000, channels: 1 });
  assert.equal(p.push({ captureId: id, sequence: 0, data: new Uint8Array(2) }).ok, false);
  assert.equal(events.at(-1).code, 'AUDIO_CONSUMER_ERROR'); assert.equal(p.permissionExpected(), false);
});
