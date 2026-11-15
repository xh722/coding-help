'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installMediaPermissions } = require('../apps/desktop/main/media-permissions.cjs');

test('permission request and check deny all but expected Dashboard audio from its main frame', () => {
  const url = 'file:///test/index.html'; const sender = { getURL: () => url }; let expected = false; let check; let request;
  installMediaPermissions({
    session: { setPermissionCheckHandler(fn) { check = fn; }, setPermissionRequestHandler(fn) { request = fn; } },
    getDashboard: () => ({ webContents: sender }), dashboardUrl: url, isExpected: () => expected,
  });
  const details = { requestingUrl: url, isMainFrame: true, mediaType: 'audio', mediaTypes: ['audio'] };
  const ask = (contents = sender, permission = 'media', d = details) => { let result; request(contents, permission, (allowed) => { result = allowed; }, d); return result; };
  assert.equal(ask(), false); assert.equal(check(sender, 'media', 'file://', details), false);
  expected = true; assert.equal(ask(), true); assert.equal(check(sender, 'media', 'file://', details), true);
  for (const d of [{ ...details, isMainFrame: false }, { ...details, requestingUrl: 'https://untrusted.invalid/' }, { ...details, mediaTypes: ['audio', 'video'], mediaType: 'video' }, { ...details, mediaTypes: [], mediaType: 'unknown' }, {}]) {
    assert.equal(ask(sender, 'media', d), false); assert.equal(check(sender, 'media', 'file://', d), false);
  }
  for (const contents of [null, { getURL: () => url }]) { assert.equal(ask(contents), false); assert.equal(check(contents, 'media', 'file://', details), false); }
  assert.equal(ask(sender, 'display-capture'), false); assert.equal(check(sender, 'notifications', 'file://', details), false);
  sender.getURL = () => 'file:///test/overlay.html'; assert.equal(ask(), false);
});

test('display-capture is allowed only for a pending trusted system-audio request', () => {
  const url = 'file:///test/index.html'; const sender = { getURL: () => url }; let expected = false; let check; let request;
  installMediaPermissions({
    session: { setPermissionCheckHandler(fn) { check = fn; }, setPermissionRequestHandler(fn) { request = fn; } },
    getDashboard: () => ({ webContents: sender }), dashboardUrl: url, isExpected: (kind) => kind === 'system' && expected,
  });
  const details = { requestingUrl: url, isMainFrame: true, mediaType: 'video', mediaTypes: ['video'] };
  const ask = () => { let result; request(sender, 'display-capture', (allowed) => { result = allowed; }, details); return result; };
  assert.equal(ask(), false); assert.equal(check(sender, 'display-capture', 'file://', details), false);
  expected = true; assert.equal(ask(), true); assert.equal(check(sender, 'display-capture', 'file://', details), true);
  assert.equal(check(sender, 'display-capture', 'file://', { ...details, mediaType: 'audio', mediaTypes: ['audio'] }), false);
});
