'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const preload = require('../apps/desktop/preload/index.cjs');

function fakeBridge() {
  const exposed = {};
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (...args) => args,
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  const contextBridge = { exposeInMainWorld: (name, api) => { exposed[name] = api; } };
  return { exposed, listeners, ipcRenderer, contextBridge };
}

test('preload exposes only the narrow localRebuild bridge', async () => {
  const fake = fakeBridge();
  const api = preload.installBridge(fake);
  assert.strictEqual(fake.exposed.localRebuild, api);
  assert.deepEqual(Object.keys(api).sort(), ['invoke', 'onEvent', 'removeEventListener']);
  assert.equal('send' in api, false);
  assert.equal('require' in api, false);
  assert.equal('process' in api, false);

  await assert.rejects(() => api.invoke('shell.open', {}), /Unknown command/);
  assert.deepEqual(await api.invoke('app.get-version', {}), ['local-rebuild:invoke', 'app.get-version', {}]);
});

test('preload event callbacks receive payload without sender metadata and can be removed', () => {
  const fake = fakeBridge();
  const api = preload.installBridge(fake);
  const events = [];
  const remove = api.onEvent((event) => events.push(event));
  assert.equal(typeof remove, 'function');
  const listener = fake.listeners.get('local-rebuild:event');
  listener({ sender: { id: 99 } }, { type: 'transcript.final', text: 'hello' });
  assert.deepEqual(events, [{ type: 'transcript.final', text: 'hello' }]);
  remove();
  assert.equal(fake.listeners.has('local-rebuild:event'), false);
});

test('preload rejects duplicate event listener registration', () => {
  const fake = fakeBridge();
  const api = preload.installBridge(fake);
  const listener = () => {};
  api.onEvent(listener);
  assert.throws(() => api.onEvent(listener), /already registered/);
});

test('IPC command allowlist is mirrored by preload validation', async () => {
  const fake = fakeBridge();
  const api = preload.installBridge(fake);
  await api.invoke('auth.get-session', {});
  await api.invoke('app.get-version', {});
  await assert.rejects(() => api.invoke('auth.login', null), /Payload must be an object/);
});

test('main composes transcription events and enforces secure windows', async (t) => {
  const events = [];
  const provider = { start(options) { this.emit = options.emit; }, pause() { events.push('pause'); }, resume() { events.push('resume'); }, stop() { events.push('stop'); } };
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const deps = createAppDependencies({ idFactory: () => 'session-1', clock: () => 1, transcription: provider, suggestions: { suggest: (text) => ({ text: `suggest:${text}` }) } });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  await deps.router.dispatch('session.start', { title: 'Test' }, { source: 'renderer', windowId: 1 });
  t.after(() => deps.shutdown());
  provider.emit({ type: 'transcript.final', text: 'answer', timestamp: 2 });
  assert.deepEqual(events.filter((event) => ['capture.started', 'transcript.final', 'suggestion'].includes(event?.type)), [{ type: 'capture.started', source: 'local' }, { type: 'transcript.final', text: 'answer', timestamp: 2 }, { type: 'suggestion', text: 'suggest:answer', timestamp: 2 }]);
  assert.equal(events.some((event) => event?.type === 'audio.error'), false);
  await deps.router.dispatch('session.pause', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.resume', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.stop', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(events.filter((event) => typeof event === 'string'), ['pause', 'resume', 'stop']);

  const created = [];
  const electron = { BrowserWindow: class { constructor(options) { this.options = options; this.webContents = { on: () => {}, setWindowOpenHandler: () => {} }; created.push(this); } loadFile() { return Promise.resolve(); } on() {} } };
  const secure = createAppDependencies({ electron });
  secure.createWindow('dashboard', { webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, preload: '/bad' } });
  assert.deepEqual(created[0].options.webPreferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: require('node:path').join(require('node:path').dirname(__dirname), 'apps/desktop/preload/index.cjs') });
});

test('main OCR captures the primary display in memory and broadcasts only the result', async (t) => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const events = [];
  let captureOptions;
  let receivedPng;
  const deps = createAppDependencies({
    screen: { getPrimaryDisplay: () => ({ id: 7, bounds: { width: 1280, height: 720 } }) },
    desktopCapturer: {
      getSources: async (options) => {
        captureOptions = options;
        return [{ display_id: '7', thumbnail: { toPNG: () => Buffer.from('png-bytes') } }];
      },
    },
    screenOcr: {
      recognize: async ({ png }) => { receivedPng = png; return { ok: true, text: '状态解释', language: 'chi_sim+eng', chars: 4 }; },
    },
    clock: () => 100,
  });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  t.after(() => deps.shutdown());

  const result = await deps.router.dispatch('capture.ocr-screen', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, { ok: true, text: '状态解释', language: 'chi_sim+eng', chars: 4 });
  assert.deepEqual(captureOptions, { types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
  assert.deepEqual(receivedPng, Buffer.from('png-bytes'));
  assert.deepEqual(events.map((event) => event.type), ['screen-ocr.started', 'screen-ocr.result']);
  assert.equal(events.some((event) => event.dataUrl), false);
});

test('main OCR rejects concurrent work and permits a later request', async (t) => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  let release;
  let calls = 0;
  const deps = createAppDependencies({
    screen: { getPrimaryDisplay: () => ({ id: 7, bounds: { width: 320, height: 80 } }) },
    desktopCapturer: { getSources: async () => [{ display_id: '7', thumbnail: { toPNG: () => Buffer.from('png') } }] },
    screenOcr: { recognize: async () => { calls += 1; return new Promise((resolve) => { release = resolve; }); } },
  });
  t.after(() => deps.shutdown());

  const first = deps.ocrPrimaryDisplay();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await deps.ocrPrimaryDisplay(), { ok: false, error: { code: 'OCR_BUSY', message: 'Screen OCR is already running.' } });
  release({ ok: true, text: 'first', language: 'eng', chars: 5 });
  assert.deepEqual(await first, { ok: true, text: 'first', language: 'eng', chars: 5 });
  assert.equal(calls, 1);
});

test('main OCR clears in-flight state after failure so the next request can run', async (t) => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const events = [];
  let calls = 0;
  const deps = createAppDependencies({
    screen: { getPrimaryDisplay: () => ({ id: 7, bounds: { width: 320, height: 80 } }) },
    desktopCapturer: { getSources: async () => [{ display_id: '7', thumbnail: { toPNG: () => Buffer.from('png') } }] },
    screenOcr: { recognize: async () => ++calls === 1 ? { ok: false, code: 'OCR_TIMEOUT' } : { ok: true, text: 'retry', language: 'eng', chars: 5 } },
    clock: () => 100,
  });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  t.after(() => deps.shutdown());

  assert.deepEqual((await deps.ocrPrimaryDisplay()).error.code, 'OCR_TIMEOUT');
  assert.deepEqual(await deps.ocrPrimaryDisplay(), { ok: true, text: 'retry', language: 'eng', chars: 5 });
  assert.equal(calls, 2);
  assert.deepEqual(events.map((event) => event.type), ['screen-ocr.started', 'screen-ocr.failed', 'screen-ocr.started', 'screen-ocr.result']);
});

test('main registers and unregisters the screen OCR shortcut', () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const deps = createAppDependencies();
  let registration;
  let unregistered;
  const globalShortcut = {
    register: (accelerator, callback) => { registration = { accelerator, callback }; return true; },
    unregister: (accelerator) => { unregistered = accelerator; },
  };
  assert.equal(deps.registerScreenOcrShortcut(globalShortcut), true);
  assert.equal(registration.accelerator, 'CommandOrControl+Shift+O');
  assert.equal(deps.registerScreenOcrShortcut(globalShortcut), false);
  deps.unregisterScreenOcrShortcut(globalShortcut);
  assert.equal(unregistered, 'CommandOrControl+Shift+O');
});

test('main wires audio lifecycle and chunks into transcription idempotently', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const events = [];
  const audioCalls = [];
  const audio = {
    start(options) { audioCalls.push('start'); this.options = options; },
    pause() { audioCalls.push('pause'); },
    resume() { audioCalls.push('resume'); },
    stop() { audioCalls.push('stop'); },
  };
  const transcription = {
    start() {},
    pause() {},
    resume() {},
    stop() {},
    pushAudio(chunk) { events.push({ type: 'chunk', chunk }); return true; },
  };
  const deps = createAppDependencies({ audio, transcription, suggestions: { suggest: () => ({ text: 'suggestion' }) } });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };

  await deps.router.dispatch('session.start', { title: 'Audio test' }, { source: 'renderer', windowId: 1 });
  audio.options.onEvent({ type: 'audio.started', source: 'fake' });
  audio.options.onEvent({ type: 'audio.chunk', data: Buffer.from([99]) });
  audio.options.onChunk(Buffer.from([1, 2]), { source: 'fake' });
  assert.deepEqual(events.filter((event) => event?.type?.startsWith('audio.') && event.type !== 'audio.status').map((event) => event.type), ['audio.started']);
  assert.deepEqual(events.find((event) => event?.type === 'chunk').chunk, Buffer.from([1, 2]));

  await deps.router.dispatch('session.pause', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.pause', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.resume', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.resume', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.stop', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.stop', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(audioCalls, ['start', 'pause', 'resume', 'stop']);
});

test('main blocks will-redirect navigation', () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  let blocked = false;
  const electron = { BrowserWindow: class { constructor() { this.webContents = { on: (name, fn) => { if (name === 'will-redirect') fn({ preventDefault: () => { blocked = true; } }); }, setWindowOpenHandler: () => {} }; } loadFile() { return Promise.resolve(); } on() {} } };
  createAppDependencies({ electron }).createWindow('dashboard');
  assert.equal(blocked, true);
});

test('main enters offline mode when local API startup fails', async () => {
  const { runElectronApp } = require('../apps/desktop/main/index.cjs');
  let ready;
  const electron = {
    app: {
      whenReady: () => new Promise((resolve) => { ready = resolve; }),
      on: () => {},
      getPath: () => '/tmp',
      getVersion: () => '0.1.0',
      quit: () => {},
    },
    ipcMain: { handle: () => {} },
    screen: {},
    desktopCapturer: {},
    BrowserWindow: class {
      constructor() { this.webContents = { on: () => {}, setWindowOpenHandler: () => {} }; }
      loadFile() { return Promise.resolve(); }
      on() {}
    },
  };
  const localApi = {
    start: async () => { throw new Error('port unavailable'); },
    stop: async () => {},
    address: () => ({ host: '127.0.0.1', port: 0 }),
  };
  const deps = runElectronApp({ ...electron, __localApi: localApi });
  ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deps.offline, true);
  await assert.doesNotReject(() => deps.auth.login('local-dev@example.com', 'local-dev-password'));
  deps.session.start({ title: 'Offline interview' });
  assert.equal(deps.session.getSnapshot().state, 'active');
  deps.transcription.stop();
});

test('local API authentication errors do not trigger offline fallback', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const localApi = {
    start: async () => {},
    stop: async () => {},
    address: () => ({ host: '127.0.0.1', port: 43123 }),
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Invalid credentials' } }),
  });
  try {
    const deps = createAppDependencies({ localApi, clock: () => 1 });
    await assert.rejects(() => deps.auth.login('local-dev@example.com', 'wrong'), /Invalid credentials/);
    assert.equal(deps.offline, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('local API startup is shared and can restart after stop', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  let starts = 0;
  let stops = 0;
  const localApi = {
    start: async () => { starts += 1; await new Promise((resolve) => setTimeout(resolve, 5)); },
    stop: async () => { stops += 1; },
    address: () => ({ host: '127.0.0.1', port: 43123 }),
  };
  const deps = createAppDependencies({ localApi, clock: () => 1 });
  await Promise.all([deps.ensureApiStarted(), deps.ensureApiStarted()]);
  assert.equal(starts, 1);
  await deps.stopApi();
  assert.equal(stops, 1);
  await deps.ensureApiStarted();
  assert.equal(starts, 2);
});

test('main persists session lifecycle and provider events through the session API', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const persisted = [];
  const provider = { start(options) { this.emit = options.emit; }, pause() {}, resume() {}, stop() {} };
  const deps = createAppDependencies({
    auth: { getSession: () => ({ accessToken: 'access-1' }) },
    sessionApi: {
      create: async (_token, metadata) => { persisted.push({ type: 'session.created', metadata }); return { id: 'api-session-1' }; },
      append: async (_token, _id, event) => { persisted.push(event); },
    },
    transcription: provider,
    suggestions: { suggest: (text) => ({ text: `suggest:${text}` }) },
    idFactory: () => 'session-1',
    clock: () => 10,
  });
  await deps.router.dispatch('session.start', { title: 'Persisted interview' }, { source: 'renderer', windowId: 1 });
  provider.emit({ type: 'transcript.final', text: 'answer', timestamp: 11 });
  await deps.router.dispatch('session.pause', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.resume', {}, { source: 'renderer', windowId: 1 });
  await deps.router.dispatch('session.stop', {}, { source: 'renderer', windowId: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted[0].type, 'session.created');
  assert.deepEqual(persisted.slice(1).map((event) => event.type), [
    'audio.started', 'capture.started', 'transcript.final', 'suggestion', 'audio.paused', 'session.paused', 'audio.resumed', 'session.resumed', 'audio.stopped', 'session.stopped', 'capture.stopped',
  ]);
});

test('main exposes persisted session history through IPC', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const deps = createAppDependencies({
    auth: { getSession: () => ({ accessToken: 'access-1' }) },
    sessionApi: { list: async (token) => [{ id: 'saved-1', token }] },
  });
  const result = await deps.router.dispatch('session.list', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, [{ id: 'saved-1', token: 'access-1' }]);
});

test('main exposes session deletion through IPC', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  let deleted;
  const deps = createAppDependencies({
    auth: { getSession: () => ({ accessToken: 'access-1' }) },
    sessionApi: { delete: async (token, id) => { deleted = { token, id }; return { ok: true }; } },
  });
  const result = await deps.router.dispatch('session.delete', { id: 'saved-1' }, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(deleted, { token: 'access-1', id: 'saved-1' });
});

test('main exposes a sanitized session backup through IPC', async () => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const backup = { format: 'coding-help-session-backup', schemaVersion: 1, product: 'interviewcoder-local-rebuild', exportedAt: '2026-11-15T00:00:00.000Z', sessions: [] };
  const deps = createAppDependencies({
    auth: { getSession: () => ({ accessToken: 'access-1' }) },
    sessionApi: { backup: async (token) => ({ ...backup, token }) },
  });
  const result = await deps.router.dispatch('session.export', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, backup);
});

test('main imports a validated session backup through the desktop file picker', async (t) => {
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-backup-'));
  const file = path.join(directory, 'backup.json');
  const backup = { format: 'coding-help-session-backup', schemaVersion: 1, product: 'interviewcoder-local-rebuild', exportedAt: '2026-11-15T00:00:00.000Z', sessions: [{ id: 'restored-1', events: [] }] };
  fs.writeFileSync(file, JSON.stringify(backup));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let restored;
  const deps = createAppDependencies({
    electron: { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) } },
    auth: { getSession: () => ({ accessToken: 'access-1' }) },
    sessionApi: { restore: async (token, document) => { restored = { token, document }; return { imported: 1 }; } },
  });
  t.after(() => deps.shutdown());
  const result = await deps.router.dispatch('session.import', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, { ok: true, imported: 1 });
  assert.deepEqual(restored, { token: 'access-1', document: backup });
});
