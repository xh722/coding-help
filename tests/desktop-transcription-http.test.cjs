'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppDependencies } = require('../apps/desktop/main/index.cjs');

function fakeAudio() {
  return {
    start(options) { this.options = options; options.onEvent({ type: 'audio.started', sampleRate: 16000, channels: 1, bitsPerSample: 16, format: 'pcm_s16le' }); options.onChunk(new Uint8Array([0, 0, 1, 0])); return true; },
    pause() {}, resume() {}, stop() {},
  };
}

function invoke(deps, command, payload = {}) { return deps.router.dispatch(command, payload, { source: 'renderer', windowId: 1 }); }

test('configured loopback ASR is awaited at stop and replaces demo text', async () => {
  const requests = []; const events = [];
  const deps = createAppDependencies({
    audio: fakeAudio(), transcriptionEndpoint: 'http://127.0.0.1:43123/transcribe',
    transcriptionFetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, async text() { return JSON.stringify({ text: 'local answer' }); } }; },
    auth: { getSession: () => ({ accessToken: 'test' }) }, sessionApi: { create: async () => ({ id: 'saved' }), append: async (_t, _id, event) => events.push(event) },
  });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  await invoke(deps, 'session.start', { title: 'Local ASR' });
  assert.equal((await invoke(deps, 'audio.get-status')).transcriptionMode, 'local-http');
  await invoke(deps, 'session.stop');
  assert.equal(requests.length, 1); assert.equal(requests[0].options.body.toString('ascii', 0, 4), 'RIFF');
  assert.ok(events.some((event) => event.type === 'transcript.final' && event.text === 'local answer' && event.demo === false));
  assert.equal(events.some((event) => event.type === 'transcript.final' && event.demo === true), false);
  assert.ok(events.some((event) => event.type === 'suggestion'));
  await deps.shutdown();
});

test('invalid configured endpoint fails closed and visibly uses demo mode', async () => {
  const events = []; const deps = createAppDependencies({ transcriptionEndpoint: 'https://example.com/transcribe', auth: { getSession: () => ({ accessToken: 'test' }) }, sessionApi: { create: async () => ({ id: 'saved' }), append: async (_t, _id, event) => events.push(event) } });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  await invoke(deps, 'session.start', { title: 'Fallback' });
  assert.equal((await invoke(deps, 'audio.get-status')).transcriptionMode, 'audio');
  assert.ok(events.some((event) => event.type === 'transcription.config-error'));
  await invoke(deps, 'session.stop'); await deps.shutdown();
});

test('HTTP ASR failure is sanitized and stop remains awaitable', async () => {
  const events = []; const deps = createAppDependencies({ audio: fakeAudio(), transcriptionEndpoint: 'http://localhost/transcribe', transcriptionFetch: async () => { throw new Error('private token=secret'); }, auth: { getSession: () => ({ accessToken: 'test' }) }, sessionApi: { create: async () => ({ id: 'saved' }), append: async (_t, _id, event) => events.push(event) } });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  await invoke(deps, 'session.start', { title: 'Failure' }); await invoke(deps, 'session.stop');
  const failure = events.find((event) => event.type === 'transcript.error');
  assert.equal(failure.code, 'TRANSCRIPTION_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(events), /private|secret|token/);
  await deps.shutdown();
});
