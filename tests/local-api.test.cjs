const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalApi } = require('../services/local-api/server.cjs');

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test('local API supports demo auth, protected sessions, events, refresh, and logout', async () => {
  const api = createLocalApi({ host: '127.0.0.1', port: 0, clock: () => 1700000000000 });
  await api.start();
  const base = `http://${api.address().host}:${api.address().port}`;

  try {
    const health = await request(base, '/health');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { ok: true });

    const rejected = await request(base, '/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'wrong@example.com', password: 'wrong' }),
    });
    assert.equal(rejected.response.status, 401);
    assert.equal(rejected.body.error.code, 'INVALID_CREDENTIALS');

    const login = await request(base, '/auth/login', {
      method: 'POST', body: JSON.stringify({ email: 'local-dev@example.com', password: 'local-dev-password' }),
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.user.email, 'local-dev@example.com');
    assert.match(login.body.accessToken, /^[0-9a-f-]{36}$/);
    assert.match(login.body.refreshToken, /^[0-9a-f-]{36}$/);

    const token = login.body.accessToken;
    const unauthorized = await request(base, '/user');
    assert.equal(unauthorized.response.status, 401);
    assert.deepEqual(unauthorized.body.error, { code: 'UNAUTHORIZED', message: 'Bearer token required' });

    const user = await request(base, '/user', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(user.response.status, 200);
    assert.deepEqual(user.body, login.body.user);

    const created = await request(base, '/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Demo interview', language: 'javascript' }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.metadata.title, 'Demo interview');
    assert.deepEqual(created.body.events, []);

    const event = await request(base, `/sessions/${created.body.id}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'question', payload: { text: 'Explain closures' } }),
    });
    assert.equal(event.response.status, 201);
    assert.equal(event.body.events.length, 1);
    assert.deepEqual(event.body.events[0].payload, { text: 'Explain closures' });

    const listed = await request(base, '/sessions', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.length, 1);

    const refreshed = await request(base, '/auth/refresh', {
      method: 'POST', body: JSON.stringify({ refreshToken: login.body.refreshToken }),
    });
    assert.equal(refreshed.response.status, 200);
    assert.notEqual(refreshed.body.accessToken, token);

    const logout = await request(base, '/auth/logout', {
      method: 'POST', headers: { authorization: `Bearer ${refreshed.body.accessToken}` },
    });
    assert.equal(logout.response.status, 204);

    const afterLogout = await request(base, '/user', { headers: { authorization: `Bearer ${refreshed.body.accessToken}` } });
    assert.equal(afterLogout.response.status, 401);
  } finally {
    await api.stop();
  }
});
