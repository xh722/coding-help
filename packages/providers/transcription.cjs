const PARTIAL_TEXT = 'Local capture started';
const FINAL_TEXT = 'This is a deterministic transcript.';

function createLocalTranscriptionProvider({ clock = globalThis, mode = 'demo' } = {}) {
  if (!['demo', 'audio'].includes(mode)) throw new TypeError('Unknown transcription mode');
  const setTimeout = clock.setTimeout.bind(clock);
  const clearTimeout = clock.clearTimeout.bind(clock);
  let emit = null;
  let state = 'idle';
  let pendingTimer = null;
  let partialEmitted = false;
  let audioBytes = 0;
  let audioChunks = 0;
  const now = typeof clock.now === 'function' ? clock.now.bind(clock) : Date.now;
  let inputEnded = false;
  const emitPartialAudio = () => {
    if (!partialEmitted && audioBytes > 0 && state === 'active') {
      partialEmitted = true;
      emit({ type: 'transcript.partial', text: 'Demo: receiving local PCM audio (no speech recognition).', timestamp: now(), demo: true });
    }
  };
  const finishAudio = () => {
    if (mode !== 'audio' || !['active', 'paused'].includes(state)) return;
    inputEnded = true;
    if (state === 'paused') return;
    emitPartialAudio();
    state = 'completed';
    if (audioBytes > 0) emit({ type: 'transcript.final', text: `Demo: received ${audioChunks} PCM chunks (${audioBytes} bytes). Connect a speech provider for transcription.`, timestamp: now(), demo: true });
  };

  const scheduleFinal = () => {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (state !== 'active' || !emit) return;
      emit({ type: 'transcript.final', text: FINAL_TEXT, timestamp: now() });
      state = 'completed';
    }, 10);
  };

  return {
    start(options = {}) {
      if (state === 'active' || state === 'paused') return;
      emit = typeof options.emit === 'function' ? options.emit : () => {};
      state = 'active';
      partialEmitted = false;
      inputEnded = false;
      audioBytes = 0;
      audioChunks = 0;
      if (mode === 'audio') return;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (state !== 'active' || !emit) return;
        partialEmitted = true;
        emit({ type: 'transcript.partial', text: PARTIAL_TEXT, timestamp: now() });
        scheduleFinal();
      }, 10);
    },
    pause() {
      if (state !== 'active') return;
      state = 'paused';
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    },
    resume() {
      if (state !== 'paused') return;
      state = 'active';
      if (mode === 'audio') { emitPartialAudio(); if (inputEnded) finishAudio(); return; }
      if (partialEmitted) scheduleFinal();
      else {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (state !== 'active' || !emit) return;
          partialEmitted = true;
          emit({ type: 'transcript.partial', text: PARTIAL_TEXT, timestamp: now() });
          scheduleFinal();
        }, 10);
      }
    },
    stop() {
      if (state === 'stopped') return;
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = null;
      state = 'stopped';
      emit = null;
      audioBytes = 0;
      audioChunks = 0;
    },
    pushAudio(chunk) {
      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        throw new TypeError('Audio chunks must be Buffer or Uint8Array.');
      }
      if (state !== 'active' && state !== 'paused') return false;
      audioBytes += chunk.byteLength;
      audioChunks += 1;
      if (mode === 'audio') emitPartialAudio();
      return true;
    },
    finishAudio,
    getAudioStats() {
      return { bytes: audioBytes, chunks: audioChunks };
    },
  };
}

module.exports = { createLocalTranscriptionProvider };
