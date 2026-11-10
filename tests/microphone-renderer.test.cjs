const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { getEventListeners } = require('node:events');
const controllerPath = path.join(__dirname, '../apps/desktop/renderer/microphone.js');
const createMicrophoneCapture = fs.existsSync(controllerPath)
  ? require(controllerPath).createMicrophoneCapture
  : () => assert.fail('Microphone capture controller is not implemented');

function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function stream() {
  const listeners = new Map();
  const track = { stopped: 0, stop() { this.stopped++; }, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); }, end() { listeners.get('ended')?.(); } };
  return { track, getTracks: () => [track] };
}
function fixture(options = {}) {
  const calls = []; const contexts = []; const worklets = []; const streams = []; const constraints = [];
  const node = () => ({ disconnected: 0, connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.disconnected++; } });
  class Context {
    constructor(settings) { Object.assign(this, { settings, sampleRate: 48000, state: 'suspended', destination: {}, source: node(), gain: { ...node(), gain: { value: 1 } }, closed: 0 }); this.audioWorklet = { addModule: async (url) => { this.moduleUrl = url; if (options.module) await options.module(); } }; contexts.push(this); }
    createMediaStreamSource(value) { this.stream = value; return this.source; }
    createGain() { return this.gain; }
    async resume() { if (options.resume) await options.resume(); this.state = 'running'; }
    async close() { this.closed++; this.state = 'closed'; if (options.closeThrows) throw Error('secret close error'); }
  }
  class Worklet extends EventTarget {
    constructor(context, name) { super(); Object.assign(this, node(), { context, name, port: { onmessage: null, closed: 0, close() { this.closed++; } } }); worklets.push(this); }
    emit(data = new ArrayBuffer(1920)) { this.port.onmessage?.({ data }); }
  }
  const mediaDevices = {
    async getUserMedia(value) { constraints.push(value); if (options.getUserMedia) return options.getUserMedia(); const result = stream(); streams.push(result); return result; },
    async enumerateDevices() { return [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'camera' }, { kind: 'audiooutput', deviceId: 'speaker' }]; }
  };
  const bridge = { async invoke(name, payload) { calls.push({ name, payload }); if (options.invoke) return options.invoke(name, payload); return { ok: true, accepted: true }; } };
  const capture = createMicrophoneCapture({ bridge, mediaDevices, AudioContextClass: Context, AudioWorkletNodeClass: Worklet });
  return { capture, calls, contexts, worklets, streams, constraints, failures: () => calls.filter((c) => c.name === 'audio.microphone-failed'), chunks: () => calls.filter((c) => c.name === 'audio.microphone-chunk') };
}

test('enumeration never acquires hardware and exposes only microphone devices', async () => {
  const f = fixture();
  assert.deepEqual(await f.capture.enumerateDevices(), [{ kind: 'audioinput', deviceId: 'mic' }]);
  assert.equal(f.constraints.length, 0);
  assert.equal(f.contexts.length, 0);
});

test('browser global exports the same factory without needing Node', () => {
  assert.ok(fs.existsSync(controllerPath), 'controller exists');
  const sandbox = {}; vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), sandbox);
  assert.equal(typeof sandbox.createMicrophoneCapture, 'function');
});

test('start requests processed mono audio, reports actual rate, and mutes destination', async () => {
  const f = fixture(); await f.capture.start({ captureId: 'one', deviceId: 'chosen' });
  assert.deepEqual(f.constraints, [{ audio: { deviceId: { exact: 'chosen' }, channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }]);
  assert.deepEqual(f.contexts[0].settings, { sampleRate: 16000 });
  assert.deepEqual(f.calls[0], { name: 'audio.microphone-ready', payload: { captureId: 'one', sampleRate: 48000, channels: 1 } });
  assert.equal(f.contexts[0].moduleUrl, './pcm-worklet.js');
  assert.equal(f.worklets[0].name, 'pcm-capture');
  assert.equal(f.contexts[0].gain.gain.value, 0);
  assert.equal(f.contexts[0].source.connections[0], f.worklets[0]);
  assert.equal(f.worklets[0].connections[0], f.contexts[0].gain);
  assert.equal(f.contexts[0].gain.connections[0], f.contexts[0].destination);
  assert.equal(f.capture.getState().state, 'active');
  await f.capture.stop();
  assert.equal(f.streams[0].track.stopped, 1);
  assert.equal(f.contexts[0].closed, 1);
  assert.equal(f.contexts[0].source.disconnected, 1);
  assert.equal(f.worklets[0].disconnected, 1);
  assert.equal(f.contexts[0].gain.disconnected, 1);
  assert.equal(f.failures().length, 0);
});

test('packets wait for ready acceptance and cross IPC as sequenced Uint8Arrays', async () => {
  const ready = deferred(); const f = fixture({ invoke: (name) => name === 'audio.microphone-ready' ? ready.promise : { ok: true, accepted: true } });
  const starting = f.capture.start({ captureId: 'one' }); await flush();
  f.worklets[0].emit(); assert.equal(f.chunks().length, 0);
  ready.resolve({ ok: true, accepted: true }); await starting;
  f.worklets[0].emit(Uint8Array.from([1, 2, 3, 4]).buffer); f.worklets[0].emit(new ArrayBuffer(4)); await flush();
  assert.deepEqual(f.chunks().map((c) => c.payload.sequence), [0, 1]);
  assert.ok(f.chunks()[0].payload.data instanceof Uint8Array);
  assert.deepEqual([...f.chunks()[0].payload.data], [1, 2, 3, 4]);
  await f.capture.stop();
});

test('pause cancels pending permission; a late grant is stopped and resume acquires a fresh ID', async () => {
  const permission = deferred(); let attempt = 0;
  const newer = stream(); const late = stream();
  const f = fixture({ getUserMedia: () => ++attempt === 1 ? permission.promise : newer });
  const first = f.capture.start({ captureId: 'old' });
  assert.equal(f.capture.getState().captureId, 'old');
  await f.capture.pause(); await f.capture.resume({ captureId: 'new' });
  permission.resolve(late); await first;
  assert.equal(late.track.stopped, 1); assert.equal(newer.track.stopped, 0);
  assert.equal(f.capture.getState().captureId, 'new');
  assert.deepEqual(f.calls.filter((c) => c.name === 'audio.microphone-ready').map((c) => c.payload.captureId), ['new']);
  await f.capture.stop(); assert.equal(newer.track.stopped, 1);
});

test('stop while worklet module or context resume is pending releases resources without ready', async () => {
  for (const stage of ['module', 'resume']) {
    const gate = deferred(); const f = fixture({ [stage]: () => gate.promise });
    const starting = f.capture.start({ captureId: stage }); await flush();
    await f.capture.stop(); gate.resolve(); await starting;
    assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
    assert.equal(f.calls.length, 0);
  }
});

test('a rejected ready stops capture quietly; an error ready uses a static allowed code', async () => {
  for (const response of [{ ok: true, accepted: false }, { ok: false, error: { code: 'PRIVATE', message: 'secret details' } }]) {
    const f = fixture({ invoke: (name) => name === 'audio.microphone-ready' ? response : { ok: true } });
    await f.capture.start({ captureId: 'one' });
    assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
    assert.notEqual(f.capture.getState().state, 'active');
    assert.deepEqual(f.failures().map((c) => c.payload.code), response.ok ? [] : ['MICROPHONE_UNAVAILABLE']);
    assert.doesNotMatch(JSON.stringify(f.calls), /PRIVATE|secret/);
  }
});

test('late ready rejection cannot stop a resumed stream', async () => {
  const ready = deferred(); const f = fixture({ invoke: (name, payload) => name === 'audio.microphone-ready' && payload.captureId === 'old' ? ready.promise : { ok: true, accepted: true } });
  const old = f.capture.start({ captureId: 'old' }); await flush(); await f.capture.pause();
  await f.capture.resume({ captureId: 'new' }); ready.reject(Error('secret')); await old;
  assert.equal(f.capture.getState().captureId, 'new'); assert.equal(f.streams[1].track.stopped, 0);
  assert.equal(f.failures().length, 0); await f.capture.stop();
});

test('only four packets wait behind one inflight packet; overflow terminates and clears the queue', async () => {
  const packet = deferred(); const f = fixture({ invoke: (name) => name === 'audio.microphone-chunk' ? packet.promise : { ok: true, accepted: true } });
  await f.capture.start({ captureId: 'one' });
  for (let i = 0; i < 5; i++) f.worklets[0].emit();
  assert.equal(f.chunks().length, 1); assert.equal(f.streams[0].track.stopped, 0);
  f.worklets[0].emit(); await flush();
  assert.equal(f.streams[0].track.stopped, 1);
  assert.deepEqual(f.failures().map((c) => c.payload.code), ['MICROPHONE_BACKPRESSURE']);
  packet.resolve({ ok: true, accepted: true }); await flush(); assert.equal(f.chunks().length, 1);
});

test('draining the bounded queue preserves every block in order', async () => {
  const packets = [];
  const f = fixture({ invoke: (name) => { if (name !== 'audio.microphone-chunk') return { ok: true, accepted: true }; const gate = deferred(); packets.push(gate); return gate.promise; } });
  await f.capture.start({ captureId: 'one' });
  for (let i = 0; i < 5; i++) f.worklets[0].emit(Uint8Array.from([i, 0]).buffer);
  for (let i = 0; i < 5; i++) { packets[i].resolve({ ok: true, accepted: true }); await flush(); }
  assert.deepEqual(f.chunks().map((c) => [c.payload.sequence, c.payload.data[0]]), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  await f.capture.stop();
});

test('rejected chunk stops quietly and stale inflight rejection cannot affect a new stream', async () => {
  const packet = deferred(); const f = fixture({ invoke: (name) => name === 'audio.microphone-chunk' ? packet.promise : { ok: true, accepted: true } });
  await f.capture.start({ captureId: 'old' }); f.worklets[0].emit();
  packet.resolve({ ok: true, accepted: false }); await flush();
  assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.failures().length, 0);

  const stale = deferred(); const g = fixture({ invoke: (name, payload) => name === 'audio.microphone-chunk' && payload.captureId === 'old' ? stale.promise : { ok: true, accepted: true } });
  await g.capture.start({ captureId: 'old' }); g.worklets[0].emit(); await g.capture.pause();
  await g.capture.resume({ captureId: 'new' }); g.worklets[1].emit(); await flush();
  stale.reject(Error('secret')); await flush();
  assert.equal(g.capture.getState().captureId, 'new'); assert.equal(g.streams[1].track.stopped, 0);
  assert.equal(g.chunks()[1].payload.sequence, 0); assert.equal(g.failures().length, 0); await g.capture.stop();
});

test('device end reports DEVICE_LOST once and cleanup survives context close errors', async () => {
  const f = fixture({ closeThrows: true }); await f.capture.start({ captureId: 'one' });
  f.streams[0].track.end(); f.streams[0].track.end(); await flush(); await f.capture.stop();
  assert.deepEqual(f.failures().map((c) => c.payload), [{ captureId: 'one', code: 'DEVICE_LOST' }]);
  assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
  assert.equal(f.worklets[0].disconnected, 1); assert.equal(f.worklets[0].port.closed, 1);
});

test('active processor failure reports a static code once and releases every capture resource', async () => {
  const f = fixture({ closeThrows: true }); await f.capture.start({ captureId: 'processor-error' });
  const error = Object.assign(new Event('processorerror'), { message: 'secret processor device details' });
  f.worklets[0].dispatchEvent(error); f.worklets[0].dispatchEvent(error); await flush();
  assert.deepEqual(f.capture.getState(), { state: 'failed', captureId: null });
  assert.deepEqual(f.failures().map((c) => c.payload), [{ captureId: 'processor-error', code: 'MICROPHONE_UNAVAILABLE' }]);
  assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
  assert.equal(f.contexts[0].source.disconnected, 1); assert.equal(f.contexts[0].gain.disconnected, 1);
  assert.equal(f.worklets[0].disconnected, 1); assert.equal(f.worklets[0].port.closed, 1);
  assert.equal(getEventListeners(f.worklets[0], 'processorerror').length, 0);
  f.worklets[0].emit(); assert.equal(f.chunks().length, 0);
  assert.doesNotMatch(JSON.stringify(f.calls), /secret|details/);
});

test('processor error during resume or ready setup cancels pending acquisition without revival', async () => {
  for (const stage of ['resume', 'ready']) {
    const gate = deferred();
    const options = stage === 'resume'
      ? { resume: () => gate.promise }
      : { invoke: (name) => name === 'audio.microphone-ready' ? gate.promise : { ok: true, accepted: true } };
    const f = fixture(options); const starting = f.capture.start({ captureId: stage }); await flush();
    f.worklets[0].dispatchEvent(new Event('processorerror')); await flush();
    assert.equal(f.capture.getState().state, 'failed');
    assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
    assert.deepEqual(f.failures().map((c) => c.payload), [{ captureId: stage, code: 'MICROPHONE_UNAVAILABLE' }]);
    gate.resolve({ ok: true, accepted: true }); await starting;
    assert.deepEqual(f.capture.getState(), { state: 'failed', captureId: null });
    assert.equal(f.calls.filter((c) => c.name === 'audio.microphone-ready').length, stage === 'resume' ? 0 : 1);
    assert.equal(getEventListeners(f.worklets[0], 'processorerror').length, 0);
  }
});

test('cleanup detaches processor errors and an already queued old callback cannot fail a replacement', async () => {
  const f = fixture(); await f.capture.start({ captureId: 'old' });
  const oldCallback = getEventListeners(f.worklets[0], 'processorerror')[0];
  assert.equal(typeof oldCallback, 'function');
  await f.capture.pause(); await f.capture.resume({ captureId: 'new' });
  assert.equal(getEventListeners(f.worklets[0], 'processorerror').length, 0);
  f.worklets[0].dispatchEvent(new Event('processorerror'));
  oldCallback(new Event('processorerror')); await flush();
  assert.deepEqual(f.capture.getState(), { state: 'active', captureId: 'new' });
  assert.equal(f.streams[1].track.stopped, 0); assert.equal(f.contexts[1].closed, 0);
  assert.equal(f.failures().length, 0);
  await f.capture.stop();
  assert.equal(getEventListeners(f.worklets[1], 'processorerror').length, 0);
});

test('permission and setup errors report sanitized static failure codes', async () => {
  for (const [name, want] of [['NotAllowedError', 'PERMISSION_DENIED'], ['SecurityError', 'PERMISSION_DENIED'], ['NotFoundError', 'DEVICE_NOT_FOUND'], ['OverconstrainedError', 'DEVICE_NOT_FOUND'], ['NotReadableError', 'MICROPHONE_UNAVAILABLE'], ['UnexpectedSecret', 'MICROPHONE_UNAVAILABLE']]) {
    const f = fixture({ getUserMedia: () => Promise.reject(Object.assign(Error('private device secret'), { name })) });
    await f.capture.start({ captureId: 'one' });
    assert.deepEqual(f.failures().map((c) => c.payload), [{ captureId: 'one', code: want }]);
    assert.doesNotMatch(JSON.stringify(f.calls), /private|secret|UnexpectedSecret/);
  }
  const f = fixture({ module: () => Promise.reject(Error('private path')) }); await f.capture.start({ captureId: 'one' });
  assert.equal(f.streams[0].track.stopped, 1); assert.equal(f.contexts[0].closed, 1);
  assert.deepEqual(f.failures().map((c) => c.payload.code), ['MICROPHONE_UNAVAILABLE']);
});
