'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COMMANDS, SCHEMAS, validateCommand, createIpcRouter } = require('../packages/core/ipc.cjs');

test('allowlist contains every renderer command', () => {
  assert.deepEqual(COMMANDS, [
    'auth.login', 'auth.logout', 'auth.get-session',
    'session.start', 'session.pause', 'session.resume', 'session.stop', 'session.get-current', 'session.list', 'session.delete',
    'capture.get-displays', 'capture.take-screenshot',
    'audio.select-file', 'audio.use-demo', 'audio.get-status', 'audio.use-microphone',
    'audio.microphone-ready', 'audio.microphone-chunk', 'audio.microphone-failed', 'audio.get-system-capabilities',
    'overlay.set-visible', 'overlay.set-bounds', 'app.get-version',
  ]);
  assert.equal(Object.isFrozen(SCHEMAS), true);
  assert.equal(Object.isFrozen(SCHEMAS['session.start']), true);
});

test('unknown commands are rejected', async () => {
  const router = createIpcRouter({});
  await assert.rejects(async () => router.dispatch('shell.exec', {}, { source: 'renderer', windowId: 1 }), (error) => {
    assert.match(error.message, /unknown command/i);
    assert.equal(error.code, 'UNKNOWN_COMMAND');
    assert.deepEqual(error.error, { code: 'UNKNOWN_COMMAND', message: 'Unknown command' });
    return true;
  });
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

test('dispatch rejects missing or invalid renderer context', async () => {
  const router = createIpcRouter({ 'app.get-version': () => 'ok' });
  for (const context of [null, {}, { source: 'main', windowId: 1 }, { source: 'renderer', windowId: '' }, { source: 'renderer', windowId: NaN }, { source: 'renderer', windowId: Infinity }]) {
    const result = await router.dispatch('app.get-version', {}, context);
    assert.deepEqual(result, { ok: false, error: { code: 'INVALID_CONTEXT', message: 'Invalid renderer context' } });
  }
});

test('sanitizes handler returned errors', async () => {
  const router = createIpcRouter({ 'app.get-version': () => ({ ok: false, error: {
    code: 'AUTH_FAILED', message: 'password=secret token=abc', stack: 'private stack', token: 'abc', password: 'secret'
  }}) });
  const result = await router.dispatch('app.get-version', {}, { source: 'renderer', windowId: 1 });
  assert.deepEqual(result, { ok: false, error: { code: 'AUTH_FAILED', message: 'Request failed' } });
});

test('handler failures become structured errors without stacks', async () => {
  const router = createIpcRouter({ 'app.get-version': () => { throw new Error('token=secret'); } });
  const result = await router.dispatch('app.get-version', {}, { source: 'renderer', windowId: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'HANDLER_ERROR');
  assert.match(result.error.message, /request failed/i);
  assert.equal('stack' in result.error, false);
  assert.equal(result.error.message.includes('secret'), false);
});
