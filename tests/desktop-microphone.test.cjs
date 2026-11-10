'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createAppDependencies } = require('../apps/desktop/main/index.cjs');
const { installBridge } = require('../apps/desktop/preload/index.cjs');
const { validateCommand } = require('../packages/core/ipc.cjs');

function harness() {
  const saved = []; const sent = []; let handler; let check; let request;
  const electron = { BrowserWindow: class extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); Object.assign(this.webContents, { id: sent.length + 1, mainFrame: {}, getURL: () => this.url, send: (_channel, event) => sent.push({ win: this, event }), setWindowOpenHandler() {} }); }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    isDestroyed() { return false; }
  }, session: { defaultSession: { setPermissionCheckHandler(fn) { check = fn; }, setPermissionRequestHandler(fn) { request = fn; } } } };
  const deps = createAppDependencies({ electron,
    auth: { getSession: () => ({ accessToken: 'test' }), logout: async () => {} },
    sessionApi: { create: async () => ({ id: 'saved' }), append: async (_token, _id, event) => saved.push(event) },
  });
  deps.createWindows(); deps.registerIpc({ handle(_channel, fn) { handler = fn; } }); deps.registerMediaPermissions?.();
  const sender = deps.windows.dashboard.webContents;
  const invoke = (command, payload = {}, source = sender, senderFrame = source.mainFrame) => handler({ sender: source, senderFrame }, command, payload);
  const captureId = () => sent.filter(({ event }) => event.type === 'microphone.start').at(-1)?.event.captureId;
  return { deps, saved, sent, sender, invoke, captureId, check: (...args) => check?.(...args), request: (...args) => request?.(...args) };
}

test('main microphone session consumes negotiated PCM, isolates acquisitions, and persists metadata only', async (t) => {
  const h = harness(); t.after(() => h.deps.shutdown());
  assert.equal((await h.invoke('audio.use-microphone')).source, 'microphone');
  await h.invoke('session.start', { title: 'Microphone' }); const first = h.captureId(); assert.ok(first);
  assert.equal(h.sent.filter(({ event, win }) => event.type === 'microphone.start' && win === h.deps.windows.overlay).length, 0);
  assert.deepEqual(await h.invoke('audio.microphone-ready', { captureId: first, sampleRate: 48000, channels: 1 }), { ok: true, accepted: true });
  await h.invoke('audio.microphone-chunk', { captureId: first, sequence: 0, data: new Uint8Array(1920) });
  let status = await h.invoke('audio.get-status'); assert.equal(status.sampleRate, 48000); assert.equal(status.bytes, 1920);
  await h.invoke('session.pause');
  assert.equal((await h.invoke('audio.microphone-chunk', { captureId: first, sequence: 1, data: new Uint8Array(1920) })).accepted, false);
  await h.invoke('session.resume'); const second = h.captureId(); assert.notEqual(first, second);
  assert.equal((await h.invoke('audio.microphone-failed', { captureId: first, code: 'DEVICE_LOST' })).accepted, false);
  await h.invoke('audio.microphone-ready', { captureId: second, sampleRate: 16000, channels: 1 });
  await h.invoke('audio.microphone-chunk', { captureId: second, sequence: 0, data: new Uint8Array(640) });
  status = await h.invoke('audio.get-status'); assert.equal(status.bytes, 2560); assert.equal(status.sampleRate, 16000);
  assert.equal((await h.invoke('audio.use-demo')).error.code, 'AUDIO_BUSY');
  await h.invoke('session.stop'); assert.equal(h.deps.audio.permissionExpected(), false);
  assert.ok(h.saved.some((e) => e.type === 'transcript.final' && e.text.includes('2560 bytes')));
  assert.ok(h.saved.every((e) => !('data' in e) && !('captureId' in e)));
});

test('IPC denies microphone submission from overlay, subframes, foreign or navigated pages', async (t) => {
  const h = harness(); t.after(() => h.deps.shutdown());
  await h.invoke('audio.use-microphone'); await h.invoke('session.start', { title: 'Bounded' });
  const payload = { captureId: h.captureId(), sampleRate: 16000, channels: 1 };
  for (const [sender, frame] of [[h.deps.windows.overlay.webContents], [h.sender, {}], [{ id: 55, mainFrame: {} }]]) {
    assert.equal((await h.invoke('audio.microphone-ready', payload, sender, frame)).error.code, 'INVALID_CONTEXT');
  }
  h.sender.getURL = () => 'https://untrusted.invalid';
  assert.equal((await h.invoke('audio.microphone-ready', payload)).error.code, 'INVALID_CONTEXT');
  assert.equal(h.deps.transcription.getAudioStats().bytes, 0);
});

test('microphone permission follows acquisition and logout/reload/crash revoke it', async (t) => {
  for (const end of ['auth.logout', 'did-start-navigation', 'render-process-gone', 'closed']) {
    const h = harness(); t.after(() => h.deps.shutdown());
    const details = { mediaType: 'audio', mediaTypes: ['audio'], requestingUrl: h.sender.getURL(), isMainFrame: true };
    assert.equal(h.check(h.sender, 'media', 'file://', details), false);
    await h.invoke('audio.use-microphone'); await h.invoke('session.start', { title: end });
    assert.equal(h.check(h.sender, 'media', 'file://', details), true);
    if (end === 'auth.logout') await h.invoke(end);
    else if (end === 'closed') h.deps.windows.dashboard.emit('closed');
    else if (end === 'did-start-navigation') h.sender.emit(end, {}, h.sender.getURL(), false, true);
    else h.sender.emit(end, {}, {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.check(h.sender, 'media', 'file://', details), false, end);
    assert.equal(h.deps.session.getSnapshot().state, 'stopped', end);
  }
});

test('both preload and main bound binary payloads and reject inherited command names', async () => {
  const bridge = installBridge({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { on() {}, invoke: async (_channel, command, payload) => validateCommand(command, payload) } });
  const base = { captureId: 'id', sequence: 0, data: new Uint8Array(640) };
  assert.equal((await bridge.invoke('audio.microphone-chunk', base)).ok, true);
  for (const data of [new Uint8Array(16386), new Uint8Array(3), new Uint8Array(), new Int16Array(4), [], new ArrayBuffer(640)]) {
    assert.equal(validateCommand('audio.microphone-chunk', { ...base, data }).ok, false);
    await assert.rejects(bridge.invoke('audio.microphone-chunk', { ...base, data }));
  }
  for (const command of ['constructor', 'toString', '__proto__']) {
    assert.equal(validateCommand(command, {}).ok, false); await assert.rejects(bridge.invoke(command, {}));
  }
});
