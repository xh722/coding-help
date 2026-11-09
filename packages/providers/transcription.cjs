const PARTIAL_TEXT = 'Local capture started';
const FINAL_TEXT = 'This is a deterministic transcript.';

function createLocalTranscriptionProvider({ clock = globalThis } = {}) {
  const setTimeout = clock.setTimeout.bind(clock);
  const clearTimeout = clock.clearTimeout.bind(clock);
  let emit = null;
  let state = 'idle';
  let pendingTimer = null;

  const scheduleFinal = () => {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (state !== 'active' || !emit) return;
      emit({ type: 'final', text: FINAL_TEXT });
      state = 'completed';
    }, 0);
  };

  return {
    start(options = {}) {
      if (state !== 'idle') return;
      emit = typeof options.emit === 'function' ? options.emit : () => {};
      state = 'active';
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (state !== 'active' || !emit) return;
        emit({ type: 'partial', text: PARTIAL_TEXT });
        scheduleFinal();
      }, 0);
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
      scheduleFinal();
    },
    stop() {
      if (state === 'stopped') return;
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = null;
      state = 'stopped';
      emit = null;
    },
  };
}

module.exports = { createLocalTranscriptionProvider };
