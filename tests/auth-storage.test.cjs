const test = require('node:test');
const assert = require('node:assert/strict');
const { createJsonStore } = require('../packages/core/storage.cjs');
const { createAuthService } = require('../packages/core/auth.cjs');

function memoryStore(initial) {
  let value = initial;
  return {
    read() {
      if (value === undefined) return null;
      return JSON.parse(value);
    },
    write(next) {
      value = JSON.stringify(next);
    },
    clear() {
      value = undefined;
    },
    raw() {
      return value;
    },
  };
}

function demoTransport() {
  return {
    async login(email, password) {
      if (email !== 'local-dev@example.com' || password !== 'local-dev-password') {
        throw new Error('invalid credentials');
      }
      return {
        user: { id: 'local-dev', email, displayName: 'Local Developer' },
        accessToken: 'local-access-1',
        refreshToken: 'local-refresh-1',
        expiresAt: 2000,
      };
    },
    async refresh(refreshToken) {
      if (refreshToken !== 'local-refresh-1') throw new Error('invalid refresh token');
      return {
        user: { id: 'local-dev', email: 'local-dev@example.com', displayName: 'Local Developer' },
        accessToken: 'local-access-2',
        refreshToken: 'local-refresh-2',
        expiresAt: 3000,
      };
    },
  };
}

test('auth login persists a session without exposing password', async () => {
  const store = memoryStore();
  const service = createAuthService({ transport: demoTransport(), store, clock: () => 1000 });
  const session = await service.login('local-dev@example.com', 'local-dev-password');
  assert.equal(session.user.email, 'local-dev@example.com');
  assert.equal(service.getSession().accessToken.startsWith('local-access-'), true);
  assert.equal(JSON.stringify(service.getSession()).includes('password'), false);
  assert.equal(store.raw().includes('local-dev-password'), false);
});

test('refresh replaces the full persisted session and logout clears it', async () => {
  const store = memoryStore();
  const service = createAuthService({ transport: demoTransport(), store, clock: () => 1000 });
  await service.login('local-dev@example.com', 'local-dev-password');
  const refreshed = await service.refresh('local-refresh-1');
  assert.equal(refreshed.accessToken, 'local-access-2');
  assert.deepEqual(service.getSession(), refreshed);
  await service.logout();
  assert.equal(service.getSession(), null);
});

test('corrupt storage is reset to an empty session', () => {
  const store = {
    read: () => {
      throw new SyntaxError('bad json');
    },
    write: () => assert.fail('corrupt reads must not be rewritten'),
    clear: () => {},
  };
  const service = createAuthService({ transport: demoTransport(), store, clock: () => 1000 });
  assert.equal(service.getSession(), null);
});

test('json store writes versioned documents atomically and rejects unknown versions', () => {
  const files = new Map();
  const fs = {
    readFileSync: (path) => {
      if (!files.has(path)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(path);
    },
    writeFileSync: (path, value) => files.set(path, value),
    renameSync: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlinkSync: (path) => files.delete(path),
  };
  const store = createJsonStore('/tmp/session.json', { fs, version: 1 });
  store.write({ accessToken: 'a' });
  assert.deepEqual(JSON.parse(files.get('/tmp/session.json')), { version: 1, session: { accessToken: 'a' } });
  files.set('/tmp/session.json', JSON.stringify({ version: 2, session: { accessToken: 'old' } }));
  assert.equal(store.read(), null);
});
