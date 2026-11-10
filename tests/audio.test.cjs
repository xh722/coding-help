const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAudioCaptureProvider,
  readWavFile,
} = require('../packages/providers/audio.cjs');

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
    clearTimeout(id) { timers.delete(id); },
    now() { return current; },
    runNext() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, timer] = entry;
      timers.delete(id);
      current += timer.delay;
      timer.callback();
      return true;
    },
    runAll() { while (this.runNext()) {} },
    pending() { return timers.size; },
  };
}

function wavBuffer({ sampleRate = 8000, channels = 1, bitsPerSample = 16, data = Buffer.from([1, 2, 3, 4]) } = {}) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = Buffer.alloc(44 + data.length);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + data.length, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(data.length, 40);
  data.copy(buffer, 44);
  return buffer;
}

test('deterministic source emits ordered chunks at configured intervals', () => {
  const clock = createFakeClock();
  const chunks = [Buffer.from([1, 2]), Uint8Array.from([3, 4])];
  const events = [];
  const received = [];
  const provider = createAudioCaptureProvider({ source: 'deterministic', chunks, clock, sampleRate: 16000, channels: 1, chunkDurationMs: 25 });

  provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk, metadata) => received.push({ chunk, metadata }) });
  assert.deepEqual(events.map((event) => event.type), ['audio.started']);
  assert.equal(clock.pending(), 1);
  clock.runNext();
  assert.deepEqual([...received[0].chunk], [1, 2]);
  assert.equal(received[0].metadata.timestamp, 1025);
  clock.runNext();
  assert.deepEqual([...received[1].chunk], [3, 4]);
  assert.equal(received[1].metadata.timestamp, 1050);
  assert.deepEqual(events.map((event) => event.type), ['audio.started', 'audio.stopped']);
});

test('pause and resume suspend and continue deterministic chunks', () => {
  const clock = createFakeClock();
  const received = [];
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1]), Buffer.from([2])], clock, chunkDurationMs: 10 });
  provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk) => received.push(chunk) });
  provider.pause();
  assert.equal(clock.pending(), 0);
  provider.resume();
  clock.runNext();
  assert.deepEqual([...received[0]], [1]);
  provider.pause();
  provider.resume();
  clock.runNext();
  assert.deepEqual([...received[1]], [2]);
  assert.deepEqual(events.map((event) => event.type), ['audio.started', 'audio.paused', 'audio.resumed', 'audio.paused', 'audio.resumed', 'audio.stopped']);
});

test('stop is idempotent, cancels pending chunks, and reports state', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1])], clock });
  provider.start({ onEvent: (event) => events.push(event), onChunk: () => assert.fail('chunk should not arrive') });
  provider.stop();
  provider.stop();
  clock.runAll();
  assert.equal(provider.getState(), 'stopped');
  assert.deepEqual(events.map((event) => event.type), ['audio.started', 'audio.stopped']);
});

test('readWavFile parses PCM metadata and data', () => {
  const source = wavBuffer({ sampleRate: 16000, channels: 2, bitsPerSample: 16, data: Buffer.from([5, 6, 7, 8]) });
  const result = readWavFile('fixture.wav', { readFileSync: () => source });
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.channels, 2);
  assert.equal(result.bitsPerSample, 16);
  assert.deepEqual(result.data, source.subarray(44));
});

test('missing WAV file is reported as a structured error event', () => {
  const events = [];
  const provider = createAudioCaptureProvider({ source: 'file', filePath: 'missing.wav', fs: { readFileSync() { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } } });
  provider.start({ onEvent: (event) => events.push(event) });
  assert.equal(events[0].type, 'audio.error');
  assert.equal(events[0].code, 'FILE_NOT_FOUND');
  assert.equal(events[0].source, 'file');
  assert.equal(provider.getState(), 'stopped');
});

test('malformed WAV throws a typed parser error', () => {
  assert.throws(() => readWavFile('bad.wav', { readFileSync: () => Buffer.from('not wav') }), (error) => error.code === 'MALFORMED_WAV');
});

test('unsupported device source emits an error without starting capture', () => {
  const events = [];
  const provider = createAudioCaptureProvider({ source: 'device' });
  provider.start({ onEvent: (event) => events.push(event) });
  assert.deepEqual(events, [{ type: 'audio.error', source: 'device', code: 'UNSUPPORTED_SOURCE', message: 'Audio source is not supported.' }]);
  assert.equal(provider.getState(), 'stopped');
});

test('lifecycle events never include raw audio chunks', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([9, 9])], clock });
  provider.start({ onEvent: (event) => events.push(event), onChunk: () => {} });
  clock.runAll();
  for (const event of events) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'chunk'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'data'), false);
  }
});
