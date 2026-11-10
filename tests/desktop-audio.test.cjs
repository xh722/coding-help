'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppDependencies } = require('../apps/desktop/main/index.cjs');

function clockHarness() {
  let now = 0; let id = 0; const jobs = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) { jobs.set(++id, { fn, due: now + delay }); return id; },
    clearTimeout: (key) => jobs.delete(key),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...jobs].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next || next[1].due > until) break;
        jobs.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
    pending: () => jobs.size,
  };
}

function writeWav(root, byteLength = 6400) {
  const data = Buffer.alloc(byteLength, 1);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const file = path.join(root, 'local-fixture.wav'); fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

function harness(extra = {}) {
  const timer = clockHarness(); const events = []; const saved = []; let sequence = 0;
  const deps = createAppDependencies({
    timer, clock: timer.now, idFactory: () => `session-${++sequence}`,
    auth: { getSession: () => ({ accessToken: 'test-access' }) },
    sessionApi: { create: async () => ({ id: 'saved' }), append: async (_token, _id, event) => { saved.push(event); } },
    ...extra,
  });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send(_ch, event) { events.push(event); } } };
  const invoke = (name, payload = {}) => deps.router.dispatch(name, payload, { source: 'renderer', windowId: 1 });
  return { deps, timer, events, saved, invoke };
}

test('desktop default stream receives PCM, pauses, stops, and starts a fresh second session', async () => {
  const { deps, timer, invoke } = harness();
  const first = await invoke('session.start', { title: 'First' });
  timer.advance(100);
  assert.ok(deps.transcription.getAudioStats().bytes > 0, 'default stream must contain audio');
  await invoke('session.pause'); const paused = deps.transcription.getAudioStats();
  timer.advance(1000); assert.deepEqual(deps.transcription.getAudioStats(), paused);
  await invoke('session.resume'); timer.advance(100);
  assert.ok(deps.transcription.getAudioStats().bytes > paused.bytes);
  await invoke('session.stop'); assert.equal(timer.pending(), 0);
  const second = await invoke('session.start', { title: 'Second' });
  assert.equal(second.state, 'active'); assert.notEqual(second.id, first.id);
  timer.advance(100); assert.ok(deps.transcription.getAudioStats().bytes > 0);
  await invoke('session.stop'); assert.equal(timer.pending(), 0);
});

test('WAV selection delivers every frame through main and stores only metadata', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-wav-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = writeWav(root);
  const { deps, timer, events, saved, invoke } = harness({ electron: { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } } });
  const chosen = await invoke('audio.select-file');
  assert.equal(chosen.source, 'file'); assert.equal(chosen.label, 'local-fixture.wav');
  assert.equal(JSON.stringify(chosen).includes(root), false);
  await invoke('session.start', { title: 'File' });
  timer.advance(50);
  const busy = await invoke('audio.use-demo'); assert.equal(busy.ok, false);
  timer.advance(1000);
  assert.deepEqual(deps.transcription.getAudioStats(), { bytes: 6400, chunks: 10 });
  assert.equal(events.filter((event) => event.type === 'transcript.final').length, 1);
  await invoke('session.stop'); await deps.flushSessionEvents();
  assert.equal(saved.some((event) => event.type === 'audio.started'), true);
  assert.ok(saved.every((event) => !('data' in event) && !('chunk' in event) && !JSON.stringify(event).includes(root)));
});

test('permission failure stops both consumers and is visible without leaking local paths', async () => {
  const { deps, timer, events, invoke } = harness({ audio: {
    start({ onEvent }) { onEvent({ type: 'audio.error', code: 'PERMISSION_DENIED', message: 'secret /private/file', chunk: Buffer.from([99]) }); return false; },
    stop() {}, pause() {}, resume() {}, getState: () => 'stopped',
  } });
  const result = await invoke('session.start', { title: 'Denied' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'PERMISSION_DENIED');
  assert.equal(deps.session.getSnapshot().state, 'stopped');
  timer.advance(100); assert.equal(timer.pending(), 0);
  assert.equal(events.some((event) => event.type === 'transcript.final'), false);
  assert.equal(JSON.stringify(events).includes('private'), false);
  assert.ok(events.every((event) => !('chunk' in event)));
});

test('desktop loads the actual dashboard file that ships with the app', () => {
  const loaded = [];
  const electron = { BrowserWindow: class {
    constructor() { this.webContents = { on() {}, setWindowOpenHandler() {} }; }
    on() {} loadFile(file) { loaded.push(file); return Promise.resolve(); }
  } };
  createAppDependencies({ electron }).createWindows();
  assert.equal(loaded.length, 2); for (const file of loaded) assert.ok(fs.existsSync(file), `Missing renderer: ${file}`);
});

test('a throwing device adapter leaves the session stopped with no live consumer', async () => {
  let stopped = 0;
  const { deps, timer, invoke } = harness({ audio: {
    start() { throw Object.assign(new Error('private device information'), { code: 'PERMISSION_DENIED' }); },
    stop() { stopped++; }, pause() {}, resume() {},
  } });
  const result = await invoke('session.start', { title: 'Throwing adapter' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'PERMISSION_DENIED');
  assert.equal(deps.session.getSnapshot().state, 'stopped'); assert.ok(stopped > 0);
  assert.equal(timer.pending(), 0);
});

test('shutdown drains ordered writes and stops an active source exactly once', async () => {
  let writes = 0; let complete = 0;
  const { deps, timer, invoke } = harness({ sessionApi: {
    create: async () => ({ id: 'saved' }),
    append: async () => { writes++; await new Promise((r) => setImmediate(r)); complete++; },
  } });
  await invoke('session.start', { title: 'Shutdown' }); timer.advance(60);
  await Promise.all([deps.shutdown(), deps.shutdown()]);
  assert.equal(deps.session.getSnapshot().state, 'stopped'); assert.equal(timer.pending(), 0);
  assert.ok(writes > 0); assert.equal(writes, complete);
});

test('IPC rejects a foreign window or subframe before opening a file picker', async () => {
  let handler; let dialogs = 0;
  const { deps } = harness({ electron: { dialog: { showOpenDialog() { dialogs++; } } } });
  const sender = deps.windows.dashboard.webContents; sender.id = 1; sender.mainFrame = {};
  deps.registerIpc({ handle(_name, value) { handler = value; } });
  for (const event of [{ sender: { id: 999 }, senderFrame: {} }, { sender, senderFrame: {} }]) {
    const result = await handler(event, 'audio.select-file', {});
    assert.equal(result.error.code, 'INVALID_CONTEXT');
  }
  assert.equal(dialogs, 0);
});

test('canceled or invalid file selection preserves the previous source', async () => {
  let answer = { canceled: true, filePaths: [] };
  const { invoke } = harness({ electron: { dialog: { showOpenDialog: async () => answer } } });
  const canceled = await invoke('audio.select-file');
  assert.equal(canceled.canceled, true); assert.equal(canceled.source, 'deterministic');
  answer = { canceled: false, filePaths: ['/nonexistent/private/audio.wav'] };
  const invalid = await invoke('audio.select-file');
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'FILE_NOT_FOUND');
  assert.equal((await invoke('audio.get-status')).source, 'deterministic');
  assert.equal(JSON.stringify(invalid).includes('private'), false);
});

test('renderer cannot supply an arbitrary path to the file picker IPC', async () => {
  const { invoke } = harness();
  assert.equal((await invoke('audio.select-file', { path: '/private/file' })).error.code, 'INVALID_PAYLOAD');
});

test('overlong but well-formed WAV is rejected during selection before any session starts', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'long-desktop-wav-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = writeWav(root, 16000 * 2 * 60 * 22);
  const { deps, invoke } = harness({ electron: { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } } });
  const result = await invoke('audio.select-file');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'AUDIO_TOO_LONG');
  assert.equal(deps.session.getSnapshot().state, 'idle');
  assert.equal((await invoke('audio.get-status')).source, 'deterministic');
});

test('session events are appended serially and stop waits for the final write', async () => {
  let activeWrites = 0; let maximumWrites = 0; const persisted = [];
  const { invoke, timer } = harness({ sessionApi: {
    create: async () => ({ id: 'saved' }),
    append: async (_token, _id, event) => {
      maximumWrites = Math.max(maximumWrites, ++activeWrites);
      await new Promise((r) => setImmediate(r)); persisted.push(event.type); activeWrites--;
    },
  } });
  await invoke('session.start', { title: 'Ordered' }); timer.advance(100);
  await invoke('session.stop');
  assert.equal(maximumWrites, 1); assert.equal(activeWrites, 0);
  assert.equal(persisted[0], 'audio.started');
  assert.equal(persisted.at(-1), 'capture.stopped');
  assert.ok(persisted.indexOf('transcript.final') < persisted.indexOf('session.stopped'));
});
