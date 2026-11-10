'use strict';

const { randomUUID } = require('node:crypto');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Transcription endpoint must be a credential-free loopback URL.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new TypeError('Transcription endpoint must use a loopback host.');
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
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22); header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * blockAlign, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34); header.write('data', 36, 'ascii'); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
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
  if (typeof response?.text === 'function') {
    let text;
    try { text = await response.text(); } catch { throw badResponse(); }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw badResponse('Transcription response is too large.');
    try { return JSON.parse(text); } catch { throw badResponse(); }
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
  let state = 'idle'; let emit = () => {}; let buffer = Buffer.alloc(0); let bytes = 0; let chunks = 0;
  let format = { sampleRate: 16000, channels: 1, bitsPerSample: 16, format: 'pcm_s16le' };
  let finishPromise = null; let controller = null; let timeout = null; let timedOut = false; let inputEnded = false; let requestId = null;

  function event(type, fields = {}) { emit({ type, provider: 'local-http', timestamp: now(), ...fields }); }
  function error(code) { event('transcript.error', { code, message: MESSAGES[code] || MESSAGES.TRANSCRIPTION_UNAVAILABLE }); }
  function clearRequest() { if (timeout !== null) clearTimer(timeout); timeout = null; controller = null; }
  function resetBuffer() { buffer = Buffer.alloc(0); bytes = 0; chunks = 0; }

  async function request() {
    if (!buffer.length || state === 'stopped') return;
    state = 'transcribing'; requestId = idFactory(); controller = new AbortController(); timedOut = false;
    timeout = setTimer(() => { timedOut = true; controller?.abort(); }, requestTimeoutMs); timeout?.unref?.();
    try {
      const body = createWav(buffer, format);
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'audio/wav', 'x-coding-help-request': requestId },
        body, signal: controller.signal,
      });
      if (state === 'stopped') return;
      if (response?.ok === false) throw new Error('transcription response unavailable');
      let result;
      try { result = await readBoundedJson(response); } catch (error) { throw error?.code === 'TRANSCRIPTION_BAD_RESPONSE' ? error : badResponse(); }
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!text || text.length > MAX_TEXT_LENGTH) throw badResponse();
      state = 'completed'; event('transcript.final', { text, demo: false });
    } catch (cause) {
      if (state === 'stopped') return;
      state = 'error'; error(timedOut ? 'TRANSCRIPTION_TIMEOUT' : (cause?.code === 'TRANSCRIPTION_BAD_RESPONSE' ? 'TRANSCRIPTION_BAD_RESPONSE' : 'TRANSCRIPTION_UNAVAILABLE'));
    } finally { clearRequest(); requestId = null; }
  }

  return {
    start(options = {}) {
      if (state === 'active' || state === 'paused' || state === 'transcribing') return false;
      state = 'active'; emit = typeof options.emit === 'function' ? options.emit : () => {};
      resetBuffer(); finishPromise = null; inputEnded = false; return true;
    },
    pause() { if (state === 'active') state = 'paused'; },
    resume() { if (state === 'paused') { state = 'active'; if (inputEnded) return this.finishAudio(); } return undefined; },
    stop() {
      if (state === 'stopped' && !buffer.length) return;
      state = 'stopped'; inputEnded = true; controller?.abort(); clearRequest(); finishPromise = null; emit = () => {}; resetBuffer();
    },
    pushAudio(chunk) {
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength % (format.channels * format.bitsPerSample / 8) !== 0) return false;
      if (state !== 'active') return false;
      if (bytes + chunk.byteLength > maxBytes) { state = 'error'; error('TRANSCRIPTION_PAYLOAD_TOO_LARGE'); return false; }
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]); bytes += chunk.byteLength; chunks += 1; return true;
    },
    finishAudio() {
      if (finishPromise) return finishPromise;
      if (!['active', 'paused'].includes(state)) return Promise.resolve();
      inputEnded = true; if (state === 'paused') return Promise.resolve();
      if (!buffer.length) { state = 'completed'; return Promise.resolve(); }
      finishPromise = request(); return finishPromise;
    },
    setAudioFormat(next = {}) {
      if (!validFormat(next)) { error('TRANSCRIPTION_INVALID_FORMAT'); return false; }
      if (buffer.length && (next.channels !== format.channels || next.bitsPerSample !== format.bitsPerSample)) return false;
      format = { sampleRate: next.sampleRate, channels: next.channels, bitsPerSample: next.bitsPerSample, format: next.format || (next.bitsPerSample === 8 ? 'pcm_u8' : `pcm_s${next.bitsPerSample}le`) };
      return true;
    },
    getAudioStats: () => ({ bytes, chunks }),
    getMode: () => 'local-http',
    getState: () => state,
    getEndpoint: () => url,
  };
}

module.exports = { createLocalHttpTranscriptionProvider, isLoopbackEndpoint, createWav, readBoundedJson, MESSAGES, MAX_RESPONSE_BYTES };
