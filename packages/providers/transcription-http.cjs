'use strict';

const { randomUUID } = require('node:crypto');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS = 65536;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 20000;
const MESSAGES = Object.freeze({
  TRANSCRIPTION_UNAVAILABLE: 'The local transcription service could not process the audio.',
  TRANSCRIPTION_TIMEOUT: 'The local transcription service timed out.',
  TRANSCRIPTION_PAYLOAD_TOO_LARGE: 'This audio segment is too large for the local transcription service.',
  TRANSCRIPTION_INVALID_FORMAT: 'The audio format is not supported by the local transcription service.',
  TRANSCRIPTION_BAD_RESPONSE: 'The local transcription service returned an invalid response.',
});

function isLoopbackEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new TypeError('Transcription endpoint must be a valid loopback URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError('Transcription endpoint must be a credential-free loopback URL without query or fragment.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new TypeError('Transcription endpoint must use a loopback host.');
  if (host === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

function validFormat(format = {}) {
  return Number.isInteger(format.sampleRate) && format.sampleRate > 0 && format.sampleRate <= 384000
    && Number.isInteger(format.channels) && format.channels > 0 && format.channels <= 32
    && [8, 16, 24, 32].includes(format.bitsPerSample)
    && (!format.format || format.format === (format.bitsPerSample === 8 ? 'pcm_u8' : `pcm_s${format.bitsPerSample}le`));
}

function createWav(data, format) {
  const blockAlign = format.channels * format.bitsPerSample / 8;
  if (!validFormat(format) || data.length % blockAlign !== 0) throw new TypeError('Invalid PCM format.');
  const padding = Buffer.alloc(data.length % 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + data.length + padding.length, 4); header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22); header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * blockAlign, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data, padding]);
}

function badResponse(message = 'Invalid transcription response.') {
  return Object.assign(new Error(message), { code: 'TRANSCRIPTION_BAD_RESPONSE' });
}

async function readBoundedJson(response) {
  const decoder = new TextDecoder();
  let total = 0;
  const parts = [];
  const append = (value) => {
    const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : Number(value?.byteLength);
    if (!Number.isSafeInteger(length) || length < 0 || total + length > MAX_RESPONSE_BYTES) throw badResponse('Transcription response is too large.');
    const chunk = Buffer.from(value);
    total += length;
    parts.push(chunk);
  };
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        append(next.value);
      }
    } catch (error) {
      try { await reader.cancel?.(); } catch {}
      if (error?.code === 'TRANSCRIPTION_BAD_RESPONSE') throw error;
      throw badResponse();
    }
    try { return JSON.parse(decoder.decode(Buffer.concat(parts))); } catch { throw badResponse(); }
  }
  throw badResponse('Transcription response body is unavailable.');
}

function createLocalHttpTranscriptionProvider({
  endpoint, fetchImpl = globalThis.fetch, clock = globalThis, requestTimeoutMs = 15000,
  maxBytes = DEFAULT_MAX_BYTES, idFactory = randomUUID,
} = {}) {
  const url = isLoopbackEndpoint(endpoint).toString();
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120000) throw new TypeError('Invalid transcription timeout.');
  if (!Number.isInteger(maxBytes) || maxBytes < 2 || maxBytes > DEFAULT_MAX_BYTES || maxBytes % 2 !== 0) throw new TypeError('Invalid transcription payload limit.');
  const setTimer = typeof clock.setTimeout === 'function' ? clock.setTimeout.bind(clock) : globalThis.setTimeout.bind(globalThis);
  const clearTimer = typeof clock.clearTimeout === 'function' ? clock.clearTimeout.bind(clock) : globalThis.clearTimeout.bind(globalThis);
  const now = typeof clock.now === 'function' ? clock.now.bind(clock) : Date.now;
  let current = null;
  const isCurrent = (run) => current === run && run.state !== 'stopped';
  function event(run, type, fields = {}) {
    if (isCurrent(run)) run.emit({ type, provider: 'local-http', timestamp: now(), ...fields });
  }
  function fail(run, code) {
    run.parts = []; run.state = 'error';
    event(run, 'transcript.error', { code, message: MESSAGES[code] });
  }
  function deliver(run) {
    if (!isCurrent(run) || run.paused || run.result === undefined) return;
    const text = run.result; run.result = undefined; run.state = 'completed';
    event(run, text ? 'transcript.final' : 'transcript.empty', { text, demo: false });
  }
  async function request(run) {
    run.state = 'transcribing'; run.controller = new AbortController();
    const signal = run.controller.signal;
    let cancel;
    const aborted = new Promise((_resolve, reject) => {
      cancel = () => reject(Object.assign(new Error('Cancelled'), { code: run.timedOut ? 'TRANSCRIPTION_TIMEOUT' : 'ABORTED' }));
      signal.addEventListener('abort', cancel, { once: true });
    });
    const timer = setTimer(() => { run.timedOut = true; run.controller.abort(); }, requestTimeoutMs);
    try {
      const body = createWav(Buffer.concat(run.parts, run.bytes), run.format); run.parts = [];
      // Redirects must never forward recorded audio to another endpoint.
      const result = await Promise.race([aborted, (async () => {
        const response = await fetchImpl(url, {
          method: 'POST', redirect: 'error',
          headers: { accept: 'application/json', 'content-type': 'audio/wav', 'x-coding-help-request': idFactory() },
          body, signal,
        });
        if (signal.aborted) {
          Promise.resolve(response?.body?.cancel?.()).catch(() => {});
          throw new Error('Cancelled');
        }
        if (response?.ok !== true) {
          Promise.resolve(response?.body?.cancel?.()).catch(() => {});
          throw new Error('Service unavailable');
        }
        return readBoundedJson(response);
      })()]);
      if (!isCurrent(run)) return;
      if (typeof result?.text !== 'string' || result.text.length > MAX_TEXT_LENGTH) throw badResponse();
      run.result = result.text.trim(); deliver(run);
    } catch (cause) {
      if (!isCurrent(run)) return;
      fail(run, run.timedOut ? 'TRANSCRIPTION_TIMEOUT' : (cause?.code === 'TRANSCRIPTION_BAD_RESPONSE' ? 'TRANSCRIPTION_BAD_RESPONSE' : 'TRANSCRIPTION_UNAVAILABLE'));
    } finally {
      clearTimer(timer); signal.removeEventListener('abort', cancel);
      run.controller.abort(); run.controller = null; run.parts = [];
    }
  }
  function finishAudio() {
    const run = current;
    if (!run) return Promise.resolve();
    if (run.completion) return run.completion;
    if (!['active', 'paused'].includes(run.state)) return Promise.resolve();
    run.inputEnded = true;
    if (run.paused) return Promise.resolve();
    if (!run.bytes) { run.state = 'completed'; return Promise.resolve(); }
    run.completion = request(run); return run.completion;
  }
  return {
    start(options = {}) {
      if (current && ['active', 'paused', 'transcribing'].includes(current.state)) return false;
      current = { state: 'active', emit: typeof options.emit === 'function' ? options.emit : () => {},
        parts: [], bytes: 0, chunks: 0, paused: false, inputEnded: false,
        format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 } };
      return true;
    },
    pause() {
      if (current && ['active', 'transcribing'].includes(current.state)) { current.paused = true; current.state = 'paused'; }
    },
    resume() {
      const run = current;
      if (!run || run.state !== 'paused') return;
      run.paused = false; run.state = run.completion ? 'transcribing' : 'active';
      deliver(run); if (run.inputEnded) return finishAudio();
    },
    stop() {
      if (!current) return;
      current.state = 'stopped'; current.controller?.abort(); current.parts = []; current.result = undefined;
      current.emit = () => {}; current.bytes = 0; current.chunks = 0;
    },
    pushAudio(chunk) {
      const run = current;
      if (!run || run.state !== 'active' || run.inputEnded) return false;
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength % (run.format.channels * run.format.bitsPerSample / 8)) return false;
      if (run.bytes + chunk.byteLength > maxBytes || run.chunks >= MAX_CHUNKS) { fail(run, 'TRANSCRIPTION_PAYLOAD_TOO_LARGE'); return false; }
      run.parts.push(Buffer.from(chunk)); run.bytes += chunk.byteLength; run.chunks++; return true;
    },
    finishAudio,
    setAudioFormat(next = {}) {
      const run = current;
      if (!run || !['active', 'paused'].includes(run.state)) return false;
      if (!validFormat(next) || (run.bytes && ['sampleRate', 'channels', 'bitsPerSample'].some((key) => next[key] !== run.format[key]))) {
        fail(run, 'TRANSCRIPTION_INVALID_FORMAT'); return false;
      }
      run.format = { sampleRate: next.sampleRate, channels: next.channels, bitsPerSample: next.bitsPerSample }; return true;
    },
    getAudioStats: () => ({ bytes: current?.bytes || 0, chunks: current?.chunks || 0 }),
    getMode: () => 'local-http', getState: () => current?.state || 'idle', getEndpoint: () => url,
  };
}

module.exports = { createLocalHttpTranscriptionProvider, isLoopbackEndpoint, createWav, readBoundedJson, MESSAGES, MAX_RESPONSE_BYTES };
