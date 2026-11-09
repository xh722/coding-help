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

test('IPC command allowlist is mirrored by preload validation', async () => {
  const fake = fakeBridge();
  const api = preload.installBridge(fake);
  await api.invoke('auth.get-session', {});
  await api.invoke('app.get-version', {});
  await assert.rejects(() => api.invoke('auth.login', null), /Payload must be an object/);
});
