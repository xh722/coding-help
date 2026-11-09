const test = require('node:test');
const assert = require('node:assert/strict');

const { createLocalApi } = require('../services/local-api/server.cjs');
const { createAuthService } = require('../packages/core/auth.cjs');
const { createSessionMachine } = require('../packages/core/session.cjs');
const { createLocalTranscriptionProvider } = require('../packages/providers/transcription.cjs');
const { createSuggestionProvider } = require('../packages/providers/suggestions.cjs');

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

function createMemoryStore() {
  let value = null;
  return {
    read: () => value,
    write: (next) => { value = structuredClone(next); },
    clear: () => { value = null; },
  };
}

function createFakeClock() {
  let current = 1700000000000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    runNext() {
      const next = timers.entries().next().value;
      if (!next) return false;
      const [id, timer] = next;
      timers.delete(id);
      current += timer.delay;
      timer.callback();
      return true;
    },
    runAll() {
      while (this.runNext()) {}
    },
  };
}

test('local API, auth, session machine, and deterministic providers compose end to end', async () => {
  const clock = createFakeClock();
  const api = createLocalApi({ host: '127.0.0.1', port: 0, clock: clock.now });
  await api.start();
  const base = `http://${api.address().host}:${api.address().port}`;

  try {
    const transport = {
      async login(email, password) {
        const result = await request(base, '/auth/login', {
          method: 'POST', body: JSON.stringify({ email, password }),
        });
        if (!result.response.ok) throw new Error(result.body.error.message);
        return result.body;
      },
      async refresh(refreshToken) {
        const result = await request(base, '/auth/refresh', {
          method: 'POST', body: JSON.stringify({ refreshToken }),
        });
        if (!result.response.ok) throw new Error(result.body.error.message);
        return result.body;
      },
    };
    const auth = createAuthService({ transport, store: createMemoryStore(), clock: clock.now });
    const localSession = await auth.login('local-dev@example.com', 'local-dev-password');
    const authHeaders = { authorization: `Bearer ${localSession.accessToken}` };

    const created = await request(base, '/sessions', {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ title: 'Deterministic interview', language: 'javascript' }),
    });
    assert.equal(created.response.status, 201);
    const persistedId = created.body.id;

    const events = [];
    const machine = createSessionMachine({ idFactory: () => persistedId, clock: clock.now });
    const suggestionProvider = createSuggestionProvider();
    const transcriptionProvider = createLocalTranscriptionProvider({ clock });
    machine.subscribe((snapshot) => {
      const event = snapshot.events.at(-1);
      events.push({ type: `session.${event.type}`, payload: event });
    });
    transcriptionProvider.start({
      emit: (event) => {
        events.push(event);
        if (event.type === 'transcript.final') events.push({ type: 'suggestion', ...suggestionProvider.suggest(event.text) });
      },
    });

    machine.start({ title: 'Deterministic interview', language: 'javascript' });
    clock.runNext();
    transcriptionProvider.pause();
    machine.pause();
    machine.resume();
    transcriptionProvider.resume();
    clock.runAll();
    machine.stop();
    machine.stop();
    transcriptionProvider.stop();
    transcriptionProvider.stop();

    for (const event of events) {
      const result = await request(base, `/sessions/${persistedId}/events`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify(event),
      });
      assert.equal(result.response.status, 201);
    }

    const listed = await request(base, '/sessions', { headers: authHeaders });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, persistedId);
    assert.deepEqual(listed.body[0].events.map((event) => event.type), [
      'session.start',
      'transcript.partial',
      'session.pause',
      'session.resume',
      'transcript.final',
      'suggestion',
      'session.stop',
    ]);
    assert.equal(machine.getSnapshot().state, 'stopped');
    assert.equal(listed.body[0].events.at(-1).type, 'session.stop');
  } finally {
    await api.stop();
    await api.stop();
  }
});
