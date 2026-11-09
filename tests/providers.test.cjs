const test = require('node:test');
const assert = require('node:assert/strict');

const { createLocalTranscriptionProvider } = require('../packages/providers/transcription.cjs');
const { createSuggestionProvider } = require('../packages/providers/suggestions.cjs');
const { createCaptureProvider } = require('../packages/providers/capture.cjs');

function createFakeClock() {
  let nextId = 1;
  let current = 1000;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    now() { return current; },
    clearTimeout(id) {
      timers.delete(id);
    },
    runNext() {
      const [id, timer] = timers.entries().next().value || [];
      if (id === undefined) return false;
      timers.delete(id);
      current += timer.delay;
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
  assert.equal(events[0].type, 'transcript.partial');
  assert.equal(events[0].timestamp, 1010);

  provider.pause();
  clock.runNext();
  assert.equal(events.length, 1);

  provider.resume();
  clock.runNext();
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'transcript.final');
  assert.equal(events[1].text, 'This is a deterministic transcript.');
  assert.equal(events[1].timestamp, 1020);
});

test('pause before first emission resumes with the partial then final sequence', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createLocalTranscriptionProvider({ clock });
  provider.start({ emit: (event) => events.push(event) });
  provider.pause();
  assert.equal(clock.pending(), 0);
  provider.resume();
  clock.runNext();
  clock.runNext();
  assert.deepEqual(events.map((event) => event.type), ['transcript.partial', 'transcript.final']);
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
    text: 'Consider explaining: This is a deterministic transcript.',
    source: 'local',
  });
  assert.deepEqual(provider.suggest(''), { text: '', source: 'local' });
  assert.deepEqual(provider.suggest('  \n\t '), { text: '', source: 'local' });
  assert.notEqual(provider.suggest('Explain closures.').text, provider.suggest('Explain promises.').text);
});

test('capture delegates displays and screenshot to injected functions', async () => {
  const calls = [];
  const screenshotResult = 'data:image/png;base64,exact';
  const screenshot = async (displayId) => { calls.push(displayId); return screenshotResult; };
  const displays = [{ id: 'display-1', name: 'Primary' }];
  const provider = createCaptureProvider({
    screenshot,
    getDisplays: () => displays,
  });
  assert.strictEqual(provider.getDisplays(), displays);
  assert.strictEqual(await provider.takeScreenshot('display-1'), screenshotResult);
  assert.deepEqual(calls, ['display-1']);
});
