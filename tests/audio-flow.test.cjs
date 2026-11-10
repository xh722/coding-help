'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioCaptureProvider } = require('../packages/providers/audio.cjs');
const { createLocalTranscriptionProvider } = require('../packages/providers/transcription.cjs');

function fakeClock() {
  let time = 0;
  let nextId = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimeout(fn, ms) { jobs.set(++nextId, { fn, due: time + ms }); return nextId; },
    clearTimeout(id) { jobs.delete(id); },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...jobs].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next || next[1].due > end) break;
        jobs.delete(next[0]); time = next[1].due; next[1].fn();
      }
      time = end;
    },
    pending: () => jobs.size,
  };
}

test('real PCM and transcription providers receive the entire stream beyond the demo timer', () => {
  const clock = fakeClock();
  const events = [];
  const sink = createLocalTranscriptionProvider({ clock, mode: 'audio' });
  sink.start({ emit: (event) => events.push(event) });
  const source = createAudioCaptureProvider({ clock, chunks: Array.from({ length: 10 }, () => Buffer.alloc(640)) });
  source.start({
    onChunk(chunk) { assert.equal(sink.pushAudio(chunk), true); },
    onEvent(event) { if (event.type === 'audio.stopped') sink.finishAudio(); },
  });
  clock.advance(50);
  assert.equal(events.some((event) => event.type === 'transcript.final'), false);
  source.pause(); sink.pause();
  const before = sink.getAudioStats();
  clock.advance(500);
  assert.deepEqual(sink.getAudioStats(), before);
  sink.resume(); source.resume(); clock.advance(300);
  assert.deepEqual(sink.getAudioStats(), { bytes: 6400, chunks: 10 });
  assert.equal(events.filter((event) => event.type === 'transcript.final').length, 1);
  assert.ok(events.every((event) => event.demo === true && !('data' in event) && !('chunk' in event)));
  assert.equal(clock.pending(), 0);
});

test('stream transcription has no fabricated text without input and can run a second session', () => {
  const clock = fakeClock(); const events = [];
  const sink = createLocalTranscriptionProvider({ clock, mode: 'audio' });
  sink.start({ emit: (event) => events.push(event) }); clock.advance(500);
  sink.finishAudio(); assert.deepEqual(events, []);
  sink.stop(); sink.start({ emit: (event) => events.push(event) });
  sink.pushAudio(Buffer.alloc(320)); sink.finishAudio(); sink.finishAudio();
  assert.deepEqual(sink.getAudioStats(), { bytes: 320, chunks: 1 });
  assert.equal(events.filter((event) => event.type === 'transcript.final').length, 1);
  sink.stop(); assert.deepEqual(sink.getAudioStats(), { bytes: 0, chunks: 0 });
});

module.exports = { fakeClock };
