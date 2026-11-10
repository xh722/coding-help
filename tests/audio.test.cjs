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
  const buffer = Buffer.alloc(44 + data.length + data.length % 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
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

test('clock injection may provide now without timer methods', () => {
  const events = [];
  const provider = createAudioCaptureProvider({ source: 'deterministic', chunks: [], clock: { now: () => 1000 } });
  provider.start({ onEvent: (event) => events.push(event) });
  assert.deepEqual(events.map((event) => event.type), ['audio.started', 'audio.stopped']);
});

test('pause and resume suspend and continue deterministic chunks', () => {
  const clock = createFakeClock();
  const received = [];
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0]), Buffer.from([2, 0])], clock, chunkDurationMs: 10 });
  provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk) => received.push(chunk) });
  provider.pause();
  assert.equal(clock.pending(), 0);
  provider.resume();
  clock.runNext();
  assert.deepEqual([...received[0]], [1, 0]);
  provider.pause();
  provider.resume();
  clock.runNext();
  assert.deepEqual([...received[1]], [2, 0]);
  assert.deepEqual(events.map((event) => event.type), ['audio.started', 'audio.paused', 'audio.resumed', 'audio.paused', 'audio.resumed', 'audio.stopped']);
});

test('stop is idempotent, cancels pending chunks, and reports state', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0])], clock });
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

test('WAV bit depth is reflected in chunk metadata', () => {
  const clock = createFakeClock();
  const events = [];
  const chunks = [];
  const provider = createAudioCaptureProvider({ source: 'file', filePath: 'fixture.wav', fs: { readFileSync: () => wavBuffer({ bitsPerSample: 8, data: Buffer.from([5, 6]) }) }, clock, chunkDurationMs: 10 });
  provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk, metadata) => chunks.push(metadata) });
  clock.runNext();
  assert.equal(events[0].format, 'pcm_u8');
  assert.equal(chunks[0].format, 'pcm_u8');
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
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'audio.error');
  assert.equal(events[0].code, 'UNSUPPORTED_SOURCE');
  assert.equal(typeof events[0].timestamp, 'number');
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

test('file playback preserves whole frames and exact sample positions at 44.1kHz stereo 24bit', () => {
  const clock = createFakeClock();
  const data = Buffer.alloc(6 * 100, 31);
  const received = [];
  const events = [];
  const provider = createAudioCaptureProvider({ source: 'file', filePath: 'private.wav', fs: { readFileSync: () => wavBuffer({ sampleRate: 44100, channels: 2, bitsPerSample: 24, data }) }, clock, chunkDurationMs: 1 });
  assert.equal(provider.start({ onEvent: (event) => events.push(event), onChunk: (chunk, metadata) => received.push({ chunk, metadata }) }), true);
  clock.runAll();
  assert.deepEqual(Buffer.concat(received.map(({ chunk }) => chunk)), data);
  assert.deepEqual(received.map(({ chunk }) => chunk.length), [264, 264, 72]);
  assert.deepEqual(received.map(({ metadata }) => metadata.sampleOffset), [0, 44, 88]);
  assert.deepEqual(received.map(({ metadata }) => metadata.sequence), [0, 1, 2]);
  received.forEach(({ chunk, metadata }) => {
    assert.equal(metadata.durationMs, (chunk.length / 6) / 44100 * 1000);
    assert.equal(metadata.format, 'pcm_s24le');
    assert.equal(metadata.bitsPerSample, 24);
  });
  events.forEach((event) => {
    assert.equal(typeof event.timestamp, 'number');
    assert.equal(event.sampleRate, 44100);
    assert.equal(JSON.stringify(event).includes('private.wav'), false);
  });
  assert.equal(clock.pending(), 0);
  assert.equal(provider.getState(), 'stopped');
});

test('WAV parsing rejects inconsistent RIFF sizes, truncated chunks, padding and invalid PCM layout', () => {
  const mutations = [
    (b) => b.writeUInt32LE(b.length - 9, 4),
    (b) => b.writeUInt32LE(b.length - 7, 4),
    (b) => b.writeUInt32LE(100, 40),
    (b) => b.writeUInt16LE(3, 20),
    (b) => b.writeUInt16LE(0, 22),
    (b) => b.writeUInt32LE(0, 24),
    (b) => b.writeUInt16LE(1, 32),
    (b) => b.writeUInt32LE(123, 28),
    (b) => b.writeUInt16LE(12, 34),
  ];
  for (const mutate of mutations) {
    const buffer = wavBuffer();
    mutate(buffer);
    assert.throws(() => readWavFile('bad.wav', { readFileSync: () => buffer }), (error) => ['MALFORMED_WAV', 'UNSUPPORTED_FORMAT'].includes(error.code));
  }
  const unaligned = wavBuffer({ channels: 2, data: Buffer.alloc(2) });
  assert.throws(() => readWavFile('bad.wav', { readFileSync: () => unaligned }), { code: 'MALFORMED_WAV' });
  const noPadding = wavBuffer({ bitsPerSample: 8, data: Buffer.alloc(1) }).subarray(0, 45);
  noPadding.writeUInt32LE(noPadding.length - 8, 4);
  assert.throws(() => readWavFile('bad.wav', { readFileSync: () => noPadding }), { code: 'MALFORMED_WAV' });
});

test('source limits reject invalid configuration and over 64MiB without emitting private input', () => {
  const oversized = Buffer.alloc(64 * 1024 * 1024 + 2);
  const cases = [
    { chunks: [oversized] }, { chunks: [Buffer.from([1])] },
    { sampleRate: 0 }, { sampleRate: Infinity }, { sampleRate: 1000000 },
    { channels: -1 }, { channels: 1.5 }, { channels: 1000 },
    { chunkDurationMs: 0 }, { chunkDurationMs: NaN }, { chunkDurationMs: 1000000 },
    { source: 'file', filePath: '/private/path.wav', fs: { statSync: () => ({ size: oversized.length }), readFileSync: () => assert.fail('must reject before file read') } },
  ];
  for (const options of cases) {
    const events = [];
    const clock = createFakeClock();
    const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0])], ...options, clock });
    assert.equal(provider.start({ onEvent: (event) => events.push(event) }), false);
    assert.equal(events[0].type, 'audio.error');
    assert.equal(clock.pending(), 0);
    assert.equal(JSON.stringify(events).includes('/private/'), false);
  }
});

test('consumer failures end capture safely and error consumer failures never escape', () => {
  for (const failingType of ['chunk', 'audio.started', 'audio.paused', 'audio.resumed', 'audio.stopped', 'audio.error']) {
    const clock = createFakeClock();
    const events = [];
    const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0]), Buffer.from([2, 0])], clock });
    assert.doesNotThrow(() => {
      provider.start({
        onChunk: () => { if (failingType === 'chunk' || failingType === 'audio.error') throw new Error('/private/audio bytes'); },
        onEvent: (event) => { events.push(event); if (event.type === failingType) throw new Error('/private/path'); },
      });
      if (failingType === 'audio.paused') provider.pause();
      if (failingType === 'audio.resumed') { provider.pause(); provider.resume(); }
      clock.runAll();
    });
    assert.equal(provider.getState(), 'stopped');
    assert.equal(clock.pending(), 0);
    assert.equal(events.at(-1).code, 'AUDIO_CONSUMER_ERROR');
    assert.equal(JSON.stringify(events).includes('/private/'), false);
  }
});

test('a chunk consumer may stop synchronously without a duplicate stopped event', () => {
  const clock = createFakeClock();
  const events = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0])], clock });
  provider.start({ onChunk: () => provider.stop(), onEvent: (event) => events.push(event) });
  clock.runAll();
  assert.equal(events.filter((event) => event.type === 'audio.stopped').length, 1);
  assert.equal(clock.pending(), 0);
});

test('lifecycle consumers may pause and resume synchronously without duplicate timers', () => {
  const clock = createFakeClock();
  const received = [];
  const provider = createAudioCaptureProvider({ chunks: [Buffer.from([1, 0]), Buffer.from([2, 0])], clock });
  provider.start({ onEvent: (event) => { if (event.type === 'audio.started') { provider.pause(); provider.resume(); } }, onChunk: (chunk) => received.push(chunk) });
  assert.equal(clock.pending(), 1);
  clock.runAll();
  assert.equal(received.length, 2);
});

test('unsupported arbitrary sources are not copied into error metadata', () => {
  const events = [];
  const provider = createAudioCaptureProvider({ source: Buffer.from('private audio') });
  assert.equal(provider.start({ onEvent: (event) => events.push(event) }), false);
  assert.equal(events[0].source, 'unsupported');
  assert.equal(JSON.stringify(events).includes('private'), false);
});

test('real PCM WAV fixtures stream through the file provider for every supported bit depth', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-provider-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const bitsPerSample of [8, 16, 24, 32]) {
    const data = Buffer.alloc((bitsPerSample / 8) * 9, 35);
    const filePath = path.join(folder, `${bitsPerSample}.wav`);
    fs.writeFileSync(filePath, wavBuffer({ bitsPerSample, data }));
    const clock = createFakeClock();
    const received = [];
    const provider = createAudioCaptureProvider({ source: 'file', filePath, clock, chunkDurationMs: 1 });
    assert.equal(provider.start({ onChunk: (chunk) => received.push(chunk) }), true);
    clock.runAll();
    assert.deepEqual(Buffer.concat(received), data);
  }
});
