'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createLocalHttpTranscriptionProvider } = require('../packages/providers/transcription-http.cjs');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fetchResponse(body, options = {}) {
  return { ok: options.ok !== false, status: options.status || 200, async text() { return JSON.stringify(body); } };
}

test('local HTTP ASR accepts loopback only and rejects credentials/remote endpoints', () => {
  for (const endpoint of ['https://example.com/transcribe', 'ftp://127.0.0.1/transcribe', 'http://user:pass@127.0.0.1/transcribe', 'not a URL']) {
    assert.throws(() => createLocalHttpTranscriptionProvider({ endpoint }), /loopback|endpoint/i);
  }
  for (const endpoint of ['http://127.0.0.1:43123/transcribe', 'http://localhost/transcribe', 'https://[::1]/transcribe']) {
    assert.doesNotThrow(() => createLocalHttpTranscriptionProvider({ endpoint }));
  }
});

test('provider posts a bounded PCM WAV and emits validated final text', async () => {
  const calls = [];
  const provider = createLocalHttpTranscriptionProvider({
    endpoint: 'http://127.0.0.1:43123/transcribe',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return fetchResponse({ text: '  hello from local whisper  ' }); },
  });
  const events = []; provider.start({ emit: (event) => events.push(event) });
  provider.setAudioFormat({ sampleRate: 16000, channels: 1, bitsPerSample: 16, format: 'pcm_s16le' });
  assert.equal(provider.pushAudio(Uint8Array.from([1, 2, 3, 4])), true);
  await provider.finishAudio(); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'http://127.0.0.1:43123/transcribe');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers['content-type'], 'audio/wav');
  assert.equal(calls[0].options.body.readUInt32LE(24), 16000); assert.equal(calls[0].options.body.readUInt16LE(22), 1);
  assert.equal(calls[0].options.body.toString('ascii', 0, 4), 'RIFF'); assert.equal(calls[0].options.body.toString('ascii', 36, 40), 'data');
  assert.deepEqual(events.map((event) => event.type), ['transcript.final']);
  assert.equal(events[0].text, 'hello from local whisper'); assert.equal(events[0].provider, 'local-http'); assert.equal(events[0].demo, false);
  assert.deepEqual(provider.getAudioStats(), { bytes: 4, chunks: 1 });
  provider.stop(); assert.deepEqual(provider.getAudioStats(), { bytes: 0, chunks: 0 });
});

test('response, timeout and network errors are static and do not leak bodies or URLs', async () => {
  for (const [fetchImpl, expectedCode] of [
    [async () => fetchResponse({ error: 'private transcript server path' }, { ok: false, status: 500 }), 'TRANSCRIPTION_UNAVAILABLE'],
    [async () => fetchResponse({ text: 'x'.repeat(20001) }), 'TRANSCRIPTION_BAD_RESPONSE'],
    [async () => { throw new Error('http://private/token=secret'); }, 'TRANSCRIPTION_UNAVAILABLE'],
  ]) {
    const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl });
    provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); await provider.finishAudio();
    assert.equal(events.length, 1); assert.equal(events[0].type, 'transcript.error'); assert.equal(events[0].code, expectedCode);
    assert.doesNotMatch(JSON.stringify(events), /private|secret|token/); provider.stop();
  }
  const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', requestTimeoutMs: 1, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); await provider.finishAudio();
  assert.equal(events.at(-1).code, 'TRANSCRIPTION_TIMEOUT'); provider.stop();
});

test('response JSON is bounded before parsing and malformed responses use a distinct static code', async () => {
  let cancelled = false; let reads = 0;
  const body = { getReader() { return { async read() { reads++; return { done: false, value: new Uint8Array(300 * 1024) }; }, async cancel() { cancelled = true; } }; } };
  const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => ({ ok: true, body }) });
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); await provider.finishAudio();
  assert.equal(events.at(-1).code, 'TRANSCRIPTION_BAD_RESPONSE'); assert.equal(cancelled, true); assert.equal(reads, 1);
  const malformed = []; const second = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => ({ ok: true, async text() { return '{broken'; } }) });
  second.start({ emit: (event) => malformed.push(event) }); second.pushAudio(new Uint8Array([0, 0])); await second.finishAudio();
  assert.equal(malformed.at(-1).code, 'TRANSCRIPTION_BAD_RESPONSE');
});

test('pause/resume preserves bounded input and rejects invalid PCM or oversized payloads', async () => {
  const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', maxBytes: 4, fetchImpl: async () => fetchResponse({ text: 'ok' }) });
  const events = []; provider.start({ emit: (event) => events.push(event) }); provider.pause();
  assert.equal(provider.pushAudio(new Uint8Array([0, 0])), false); provider.resume();
  assert.equal(provider.pushAudio(new Uint8Array([0, 0, 0, 0])), true); assert.equal(provider.pushAudio(new Uint8Array([0, 0])), false);
  assert.equal(provider.pushAudio(new Uint8Array([0, 1, 2])), false); await provider.finishAudio();
  assert.equal(events.at(-1).type, 'transcript.error'); assert.equal(events.at(-1).code, 'TRANSCRIPTION_PAYLOAD_TOO_LARGE'); provider.stop();
});

test('finish is idempotent and stop clears a pending request', async () => {
  let resolve; const request = new Promise((yes) => { resolve = yes; }); const events = [];
  const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => { await request; return fetchResponse({ text: 'late' }); } });
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); const first = provider.finishAudio(); const second = provider.finishAudio();
  assert.strictEqual(first, second); provider.stop(); resolve(); await first; await flush(); assert.deepEqual(events, []); assert.equal(provider.getMode(), 'local-http');
});

test('default fetch path accepts a real loopback JSON response body', async (t) => {
  const server = http.createServer((request, response) => {
    assert.equal(request.method, 'POST'); assert.equal(request.headers['content-type'], 'audio/wav');
    const parts = []; request.on('data', (part) => parts.push(part)); request.on('end', () => {
      const body = Buffer.concat(parts); assert.equal(body.toString('ascii', 0, 4), 'RIFF');
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ text: 'real loopback response' }));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => server.close());
  const address = server.address(); const provider = createLocalHttpTranscriptionProvider({ endpoint: `http://127.0.0.1:${address.port}/transcribe` });
  const events = []; provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); await provider.finishAudio();
  assert.equal(events.at(-1).type, 'transcript.final'); assert.equal(events.at(-1).text, 'real loopback response'); provider.stop();
});
