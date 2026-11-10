'use strict';

const { randomUUID } = require('node:crypto');
const FAILURE_CODES = new Set(['PERMISSION_DENIED', 'DEVICE_NOT_FOUND', 'DEVICE_LOST', 'MICROPHONE_UNAVAILABLE', 'MICROPHONE_BACKPRESSURE']);
const ignored = () => ({ ok: true, accepted: false });

// Owns the acquisition capability and accepts bounded PCM; browser resource ownership
// stays in the Dashboard. A new capability is required after every pause or stop.
function createMicrophoneProvider({ sendControl, idFactory = randomUUID, clock = globalThis } = {}) {
  let state = 'idle'; let captureId = null; let sequence = 0; let timer = null;
  let onEvent = () => {}; let onChunk = () => {}; let resumed = false;
  function cancelTimer() { if (timer !== null) clock.clearTimeout(timer); timer = null; }
  function release() {
    cancelTimer(); const old = captureId; captureId = null;
    if (old) { try { sendControl({ type: 'microphone.stop', captureId: old }); } catch {} }
  }
  function fail(code) {
    release(); state = 'error'; onEvent({ type: 'audio.error', code });
    return { ok: false, error: { code, message: 'Microphone input failed.' } };
  }
  function acquire() {
    state = 'requesting'; sequence = 0; captureId = idFactory();
    onEvent({ type: 'audio.requesting' });
    timer = clock.setTimeout(() => fail('MICROPHONE_TIMEOUT'), 30000);
    timer?.unref?.();
    try { sendControl({ type: 'microphone.start', captureId }); } catch { fail('MICROPHONE_UNAVAILABLE'); return false; }
    return true;
  }
  return {
    start(options = {}) {
      if (['requesting', 'active', 'paused'].includes(state)) return false;
      onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
      onChunk = typeof options.onChunk === 'function' ? options.onChunk : () => {};
      resumed = false; return acquire();
    },
    ready({ captureId: id, sampleRate, channels }) {
      if (!id || id !== captureId || state !== 'requesting') return ignored();
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channels !== 1) return fail('INVALID_CONFIGURATION');
      cancelTimer(); state = 'active';
      onEvent({ type: resumed ? 'audio.resumed' : 'audio.started', sampleRate, channels, bitsPerSample: 16, format: 'pcm_s16le' });
      return { ok: true, accepted: true };
    },
    push({ captureId: id, sequence: next, data }) {
      if (!id || id !== captureId || state !== 'active') return ignored();
      if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 16384 || data.byteLength % 2 !== 0 || !Number.isSafeInteger(next) || next !== sequence) return fail('INVALID_CHUNK');
      try {
        const accepted = onChunk(data);
        if (accepted === false) return fail('AUDIO_CONSUMER_ERROR');
      } catch { return fail('AUDIO_CONSUMER_ERROR'); }
      sequence++; return { ok: true, accepted: true };
    },
    fail({ captureId: id, code }) {
      if (!id || id !== captureId || !['requesting', 'active'].includes(state)) return ignored();
      return fail(FAILURE_CODES.has(code) ? code : 'MICROPHONE_UNAVAILABLE');
    },
    pause() {
      if (!['requesting', 'active'].includes(state)) return;
      release(); state = 'paused'; onEvent({ type: 'audio.paused' });
    },
    resume() { if (state !== 'paused') return false; resumed = true; return acquire(); },
    stop() {
      if (['idle', 'stopped'].includes(state)) return;
      const wasError = state === 'error'; release(); state = 'stopped';
      if (!wasError) onEvent({ type: 'audio.stopped' });
      onEvent = () => {}; onChunk = () => {};
    },
    permissionExpected: () => Boolean(captureId) && ['requesting', 'active'].includes(state),
    getState: () => state,
  };
}

module.exports = { createMicrophoneProvider };
