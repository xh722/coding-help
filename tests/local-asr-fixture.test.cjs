'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalHttpTranscriptionProvider } = require('../packages/providers/transcription-http.cjs');
const { createFixtureServer } = require('../tools/local-asr-fixture.cjs');

test('reference local ASR fixture accepts PCM WAV through the real loopback HTTP path', async (t) => {
  const fixture = createFixtureServer({ port: 0, text: 'fixture response' }); const address = await fixture.start(); t.after(() => fixture.stop());
  const provider = createLocalHttpTranscriptionProvider({ endpoint: `http://127.0.0.1:${address.port}/transcribe` }); const events = [];
  provider.start({ emit: (event) => events.push(event) }); provider.setAudioFormat({ sampleRate: 16000, channels: 1, bitsPerSample: 16, format: 'pcm_s16le' }); provider.pushAudio(new Uint8Array([0, 0, 1, 0])); await provider.finishAudio();
  assert.equal(events.at(-1).text, 'fixture response'); assert.equal(fixture.getRequestCount(), 1); provider.stop();
});

test('reference fixture rejects malformed input without exposing server details', async (t) => {
  const fixture = createFixtureServer({ port: 0 }); const address = await fixture.start(); t.after(() => fixture.stop());
  const response = await fetch(`http://127.0.0.1:${address.port}/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: Buffer.from('not wav') });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'Invalid PCM WAV input.' }); assert.equal(fixture.getRequestCount(), 0);
});
