const test = require('node:test');
const assert = require('node:assert/strict');

const { createLocalTranscriptionProvider } = require('../packages/providers/transcription.cjs');
const { createSuggestionProvider } = require('../packages/providers/suggestions.cjs');
const { createCaptureProvider } = require('../packages/providers/capture.cjs');

function createFakeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runNext() {
      const [id, timer] = timers.entries().next().value || [];
      if (id === undefined) return false;
      timers.delete(id);
      timer.callback();
      return true;
    },
    runAll() {
      while (this.runNext()) {}
    },
    pending() {
      return timers.size;
    },
  };
}

test('transcription emits partial then final and pause suppresses emissions until resume', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createLocalTranscriptionProvider({ clock });

  provider.start({ emit: (event) => events.push(event) });
  assert.deepEqual(events, []);
  clock.runNext();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'partial');

  provider.pause();
  clock.runNext();
  assert.equal(events.length, 1);

  provider.resume();
  clock.runNext();
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'final');
  assert.equal(events[1].text, 'This is a deterministic transcript.');
});

test('transcription stop is idempotent and prevents queued emissions', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createLocalTranscriptionProvider({ clock });
  provider.start({ emit: (event) => events.push(event) });
  provider.stop();
  provider.stop();
  clock.runAll();
  assert.deepEqual(events, []);
  assert.equal(clock.pending(), 0);
});

test('suggestions are local and derive from the final transcript', () => {
  const provider = createSuggestionProvider();
  assert.deepEqual(provider.suggest('This is a deterministic transcript.'), {
    text: 'Consider explaining the deterministic local flow.',
    source: 'local',
  });
  assert.deepEqual(provider.suggest(''), { text: '', source: 'local' });
});

test('capture delegates displays and screenshot to injected functions', async () => {
  const screenshot = async (displayId) => `data:image/png;base64,${displayId}`;
  const provider = createCaptureProvider({
    screenshot,
    getDisplays: () => [{ id: 'display-1', name: 'Primary' }],
  });
  assert.deepEqual(provider.getDisplays(), [{ id: 'display-1', name: 'Primary' }]);
  assert.match(await provider.takeScreenshot('display-1'), /^data:image\/png;base64,/);
});
