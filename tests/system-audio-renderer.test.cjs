'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystemAudioCapture } = require('../apps/desktop/renderer/system-audio.js');

function track(kind) {
  const listeners = new Map();
  return {
    kind, stopped: 0,
    stop() { this.stopped++; },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    end() { listeners.get('ended')?.(); },
  };
}

function fixture({ stream = null, invoke } = {}) {
  const calls = []; const contexts = []; const worklets = []; const constraints = [];
  const node = () => ({ connections: [], disconnected: 0, connect(target) { this.connections.push(target); }, disconnect() { this.disconnected++; } });
  class Context {
    constructor(settings) { Object.assign(this, { settings, sampleRate: 48000, destination: {}, source: node(), gain: { ...node(), gain: { value: 1 } }, closed: 0 }); this.audioWorklet = { addModule: async (url) => { this.moduleUrl = url; } }; contexts.push(this); }
    createMediaStreamSource(value) { this.stream = value; return this.source; }
    createGain() { return this.gain; }
    async resume() {}
    async close() { this.closed++; }
  }
  class Worklet extends EventTarget {
    constructor(context, name) { super(); Object.assign(this, node(), { context, name, port: { onmessage: null, close() {} } }); worklets.push(this); }
    emit(data) { this.port.onmessage?.({ data }); }
  }
  const mediaDevices = { async getDisplayMedia(value) { constraints.push(value); return stream; } };
  const bridge = { async invoke(name, payload) { calls.push({ name, payload }); return invoke ? invoke(name, payload) : { ok: true, accepted: true }; } };
  const capture = createSystemAudioCapture({ bridge, mediaDevices, AudioContextClass: Context, AudioWorkletNodeClass: Worklet });
  return { capture, calls, contexts, worklets, constraints };
}

test('system capture requests display media, stops video immediately, and negotiates mono PCM', async () => {
  const video = track('video'); const audio = track('audio');
  const f = fixture({ stream: { getTracks: () => [video, audio], getAudioTracks: () => [audio] } });
  await f.capture.start({ captureId: 'system-1' });
  assert.deepEqual(f.constraints[0], { video: true, audio: { channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  assert.equal(video.stopped, 1); assert.equal(audio.stopped, 0);
  assert.deepEqual(f.calls[0], { name: 'audio.system-ready', payload: { captureId: 'system-1', sampleRate: 48000, channels: 1 } });
  assert.equal(f.capture.getState().state, 'active');
  await f.capture.stop(); assert.equal(video.stopped, 2); assert.equal(audio.stopped, 1); assert.equal(f.contexts[0].closed, 1);
});

test('system capture forwards bounded PCM and releases on track end', async () => {
  const video = track('video'); const audio = track('audio');
  const f = fixture({ stream: { getTracks: () => [video, audio], getAudioTracks: () => [audio] } });
  await f.capture.start({ captureId: 'system-2' });
  f.worklets[0].emit(Uint8Array.from([1, 2, 3, 4]).buffer); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.find((item) => item.name === 'audio.system-chunk').payload, { captureId: 'system-2', sequence: 0, data: new Uint8Array([1, 2, 3, 4]) });
  audio.end(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1).payload, { captureId: 'system-2', code: 'SYSTEM_AUDIO_UNAVAILABLE' });
  assert.equal(f.capture.getState().state, 'failed');
});

test('system capture rejects a stream without an audio track and sanitizes browser failures', async () => {
  const video = track('video');
  const f = fixture({ stream: { getTracks: () => [video], getAudioTracks: () => [] } });
  await f.capture.start({ captureId: 'system-3' });
  assert.deepEqual(f.calls.at(-1).payload, { captureId: 'system-3', code: 'SYSTEM_AUDIO_UNAVAILABLE' });
  assert.equal(video.stopped, 2);
});
