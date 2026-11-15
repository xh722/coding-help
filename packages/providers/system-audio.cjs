'use strict';

const { randomUUID } = require('node:crypto');

const PLATFORM_NOTES = Object.freeze({
  win32: 'Electron loopback desktop audio is a Windows-only path; a future capture flow must request display permission first.',
  darwin: 'macOS desktop audio requires the platform System Audio Recording permission and may expose an ended track when permission is missing.',
  linux: 'Linux desktop audio depends on PipeWire and the user display picker; this probe does not start a capture.',
});

function createSystemAudioCapabilityProvider({ platform = process.platform, desktopCapturer, getSources } = {}) {
  const sourceReader = getSources || (typeof desktopCapturer?.getSources === 'function'
    ? () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    : null);
  return {
    async probe() {
      if (typeof sourceReader !== 'function') return { capability: 'unavailable', captureStarted: false, code: 'CAPTURE_API_UNAVAILABLE', message: 'Desktop audio capture is unavailable in this build.' };
      let sources;
      try { sources = await sourceReader(); } catch { return { capability: 'unavailable', captureStarted: false, code: 'CAPTURE_SOURCE_ERROR', message: 'Desktop audio sources could not be inspected.' }; }
      if (!Array.isArray(sources) || sources.length === 0) return { capability: 'unavailable', captureStarted: false, code: 'NO_DESKTOP_SOURCE', message: 'No desktop source is available for system audio.' };
      if (!PLATFORM_NOTES[platform]) return { capability: 'unknown', captureStarted: false, code: 'PLATFORM_UNSUPPORTED', message: 'System audio capture is not implemented for this platform.' };
      return { capability: 'potential', captureStarted: false, platform, sourceCount: sources.length, method: 'display-media', message: PLATFORM_NOTES[platform] };
    },
  };
}

const SYSTEM_FAILURE_CODES = new Set(['PERMISSION_DENIED', 'DISPLAY_NOT_FOUND', 'SYSTEM_AUDIO_UNAVAILABLE', 'SYSTEM_AUDIO_BACKPRESSURE']);
const ignored = () => ({ ok: true, accepted: false });

// Owns the main-process side of a renderer display-media stream. The renderer
// owns browser tracks; this provider only accepts bounded, sequenced PCM.
function createSystemAudioProvider({ sendControl, idFactory = randomUUID, clock = globalThis } = {}) {
  let state = 'idle'; let captureId = null; let sequence = 0; let timer = null;
  let onEvent = () => {}; let onChunk = () => {}; let resumed = false;
  function cancelTimer() { if (timer !== null) clock.clearTimeout(timer); timer = null; }
  function release() {
    cancelTimer(); const old = captureId; captureId = null;
    if (old) { try { sendControl({ type: 'system-audio.stop', captureId: old }); } catch {} }
  }
  function fail(code) {
    release(); state = 'error'; onEvent({ type: 'audio.error', code });
    return { ok: false, error: { code, message: 'System audio input failed.' } };
  }
  function acquire() {
    state = 'requesting'; sequence = 0; captureId = idFactory();
    onEvent({ type: 'audio.requesting' });
    timer = clock.setTimeout(() => fail('SYSTEM_AUDIO_UNAVAILABLE'), 30000); timer?.unref?.();
    try { sendControl({ type: 'system-audio.start', captureId }); } catch { fail('SYSTEM_AUDIO_UNAVAILABLE'); return false; }
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
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || channels !== 1) return fail('SYSTEM_AUDIO_UNAVAILABLE');
      cancelTimer(); state = 'active';
      onEvent({ type: resumed ? 'audio.resumed' : 'audio.started', sampleRate, channels, bitsPerSample: 16, format: 'pcm_s16le' });
      return { ok: true, accepted: true };
    },
    push({ captureId: id, sequence: next, data }) {
      if (!id || id !== captureId || state !== 'active') return ignored();
      if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 16384 || data.byteLength % 2 !== 0 || !Number.isSafeInteger(next) || next !== sequence) return fail('SYSTEM_AUDIO_UNAVAILABLE');
      try {
        const accepted = onChunk(data);
        if (accepted === false) return fail('SYSTEM_AUDIO_UNAVAILABLE');
      } catch { return fail('SYSTEM_AUDIO_UNAVAILABLE'); }
      sequence++; return { ok: true, accepted: true };
    },
    fail({ captureId: id, code }) {
      if (!id || id !== captureId || !['requesting', 'active'].includes(state)) return ignored();
      return fail(SYSTEM_FAILURE_CODES.has(code) ? code : 'SYSTEM_AUDIO_UNAVAILABLE');
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

module.exports = { createSystemAudioCapabilityProvider, createSystemAudioProvider, PLATFORM_NOTES, SYSTEM_FAILURE_CODES };
