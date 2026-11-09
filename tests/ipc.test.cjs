'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COMMANDS, validateCommand, createIpcRouter } = require('../packages/core/ipc.cjs');

test('allowlist contains every renderer command', () => {
  assert.deepEqual(COMMANDS, [
    'auth.login', 'auth.logout', 'auth.get-session',
    'session.start', 'session.pause', 'session.resume', 'session.stop', 'session.get-current',
    'capture.get-displays', 'capture.take-screenshot',
    'overlay.set-visible', 'overlay.set-bounds', 'app.get-version',
  ]);
});

test('unknown commands are rejected', async () => {
  const router = createIpcRouter({});
  await assert.rejects(router.dispatch('shell.exec', {}), /unknown command/i);
});

test('session.start rejects missing metadata title and unknown fields', () => {
  assert.equal(validateCommand('session.start', {}).ok, false);
  assert.equal(validateCommand('session.start', { title: 'demo' }).ok, true);
  assert.equal(validateCommand('session.start', { title: 'demo', extra: true }).ok, false);
});

test('dispatch validates and passes a safe context to the handler', async () => {
  let received;
  const router = createIpcRouter({ 'session.start': async (payload, context) => {
    received = { payload, context };
    return { id: 's1' };
  }});
  const result = await router.dispatch('session.start', { title: 'demo' }, { source: 'renderer', windowId: 7 });
  assert.deepEqual(result, { id: 's1' });
  assert.deepEqual(received, { payload: { title: 'demo' }, context: { source: 'renderer', windowId: 7 } });
});

test('handler failures become structured errors without stacks', async () => {
  const router = createIpcRouter({ 'app.get-version': () => { throw new Error('token=secret'); } });
  const result = await router.dispatch('app.get-version', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HANDLER_ERROR');
  assert.match(result.error.message, /request failed/i);
  assert.equal('stack' in result.error, false);
  assert.equal(result.error.message.includes('secret'), false);
});
