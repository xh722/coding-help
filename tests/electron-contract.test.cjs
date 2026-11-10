'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('main composes transcription events and enforces secure windows', async () => {
  const events = [];
  const provider = { start(options) { this.emit = options.emit; }, pause() { events.push('pause'); }, resume() { events.push('resume'); }, stop() { events.push('stop'); } };
  const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
  const deps = createAppDependencies({ idFactory: () => 'session-1', clock: () => 1, transcription: provider, suggestions: { suggest: (text) => ({ text: `suggest:${text}` }) } });
  deps.windows.dashboard = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
  await deps.router.dispatch('session.start', { title: 'Test' }, { source: 'renderer', windowId: 1 });
  provider.emit({ type: 'transcript.final', text: 'answer', timestamp: 2 });
  assert.deepEqual(events.filter((event) => typeof event === 'object'), [{ type: 'capture.started', source: 'local' }, { type: 'transcript.final', text: 'answer', timestamp: 2 }, { type: 'suggestion', text: 'suggest:answer', timestamp: 2 }]);
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
