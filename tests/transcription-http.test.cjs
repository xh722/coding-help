'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createLocalHttpTranscriptionProvider } = require('../packages/providers/transcription-http.cjs');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fetchResponse(body, options = {}) {
  return new Response(JSON.stringify(body), { status: options.status || 200, headers: { 'content-type': 'application/json' } });
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

test('non-success responses with synchronous body cancellation stay on the static error path', async () => {
  let cancelled = false;
  const events = [];
  const provider = createLocalHttpTranscriptionProvider({
    endpoint: 'http://localhost/transcribe',
    fetchImpl: async () => ({ ok: false, body: { cancel() { cancelled = true; } } }),
  });
  provider.start({ emit: (event) => events.push(event) });
  provider.pushAudio(new Uint8Array([0, 0]));
  await provider.finishAudio();
  assert.equal(cancelled, true);
  assert.equal(events.at(-1).code, 'TRANSCRIPTION_UNAVAILABLE');
  provider.stop();
});

test('response JSON is bounded before parsing and malformed responses use a distinct static code', async () => {
  let cancelled = false; let reads = 0;
  const body = { getReader() { return { async read() { reads++; return { done: false, value: new Uint8Array(300 * 1024) }; }, async cancel() { cancelled = true; } }; } };
  const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => ({ ok: true, body }) });
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array([0, 0])); await provider.finishAudio();
  assert.equal(events.at(-1).code, 'TRANSCRIPTION_BAD_RESPONSE'); assert.equal(cancelled, true); assert.equal(reads, 1);
  const malformed = []; const second = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => new Response('{broken') });
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

test('a cancelled request cannot publish into a new session after its body finishes', async () => {
  let finishBody; const lateBody = new Promise((resolve) => { finishBody = resolve; });
  const events = []; let calls = 0;
  const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => ++calls === 1
    ? new Response(new ReadableStream({ async start(controller) { await lateBody; controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: 'old' }))); controller.close(); } }))
    : fetchResponse({ text: 'new' }) });
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array(2));
  const old = provider.finishAudio(); await flush(); provider.stop();
  provider.start({ emit: (event) => events.push(event) }); provider.pushAudio(new Uint8Array(2));
  finishBody(); await old;
  await provider.finishAudio();
  assert.deepEqual(events.filter((e) => e.type === 'transcript.final').map((e) => e.text), ['new']);
  provider.stop();
});

test('a pending response held by pause is delivered only on resume', async () => {
  let resolve; const result = new Promise((yes) => { resolve = yes; }); const events = [];
  const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: () => result });
  provider.start({ emit: (e) => events.push(e) }); provider.pushAudio(new Uint8Array(2));
  const pending = provider.finishAudio(); provider.pause(); resolve(fetchResponse({ text: 'paused result' })); await pending;
  assert.equal(events.length, 0); provider.resume();
  assert.equal(events.at(-1).text, 'paused result'); provider.stop();
});

test('valid silence produces no fabricated transcript and format changes cannot corrupt buffered audio', async () => {
  const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: 'http://localhost/transcribe', fetchImpl: async () => fetchResponse({ text: '' }) });
  provider.start({ emit: (e) => events.push(e) }); provider.pushAudio(new Uint8Array(2));
  assert.equal(provider.setAudioFormat({ sampleRate: 48000, channels: 1, bitsPerSample: 16 }), false);
  provider.stop(); events.length = 0; provider.start({ emit: (e) => events.push(e) }); provider.pushAudio(new Uint8Array(2));
  await provider.finishAudio(); assert.equal(provider.getState(), 'completed');
  assert.equal(events.some((e) => ['transcript.final', 'transcript.error'].includes(e.type)), false);
  provider.stop();
});

test('WAV encoding includes RIFF padding for odd unsigned PCM byte lengths', () => {
  const { createWav } = require('../packages/providers/transcription-http.cjs');
  const wav = createWav(Buffer.from([128, 129, 130]), { sampleRate: 8000, channels: 1, bitsPerSample: 8 });
  assert.equal(wav.length, 48); assert.equal(wav.readUInt32LE(4) + 8, wav.length);
  assert.equal(wav.readUInt32LE(40), 3); assert.equal(wav.at(-1), 0);
});

test('loopback transcription refuses HTTP redirects before resending audio', async (t) => {
  let redirected = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/redirected') redirected++;
    request.resume();
    if (request.url === '/transcribe') response.writeHead(307, { location: '/redirected' }).end();
    else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: 'redirected' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const events = []; const provider = createLocalHttpTranscriptionProvider({ endpoint: `http://127.0.0.1:${server.address().port}/transcribe` });
  provider.start({ emit: (e) => events.push(e) }); provider.pushAudio(new Uint8Array(2)); await provider.finishAudio();
  assert.equal(redirected, 0); assert.equal(events.at(-1).code, 'TRANSCRIPTION_UNAVAILABLE'); provider.stop();
});
