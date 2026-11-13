'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAsrSupervisor, parseAsrCommand } = require('../packages/providers/asr-supervisor.cjs');

function childProcess() {
  const child = new EventEmitter();
  child.pid = 9001;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killSignals = [];
  child.kill = (signal) => { child.killSignals.push(signal); queueMicrotask(() => child.emit('exit', 0, signal)); return true; };
  return child;
}

test('supervisor starts a configured loopback process and reports ready after health check', async () => {
  const child = childProcess();
  const calls = [];
  const supervisor = createAsrSupervisor({
    endpoint: 'http://127.0.0.1:43123/transcribe',
    command: ['python3', 'services/local-asr/faster_whisper_server.py'],
    spawnImpl: (command, args, options) => { calls.push({ command, args, options }); return child; },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); },
    healthIntervalMs: 1,
    startupTimeoutMs: 100,
  });

  const status = await supervisor.ensureReady();
  assert.equal(status.state, 'ready');
  assert.equal(status.pid, 9001);
  assert.equal(calls[0].command, 'python3');
  assert.deepEqual(calls[0].args, ['services/local-asr/faster_whisper_server.py']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls.at(-1).url, 'http://127.0.0.1:43123/healthz');
  await supervisor.stop();
  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(supervisor.getStatus().state, 'stopped');
});

test('supervisor retries a crashed child and exposes only a static failure', async () => {
  const children = [];
  let launches = 0;
  const supervisor = createAsrSupervisor({
    endpoint: 'http://localhost:43123/transcribe',
    command: ['python3', 'server.py', '--model', '/private/secret'],
    spawnImpl: () => {
      const child = childProcess(); child.pid = 9100 + launches++; children.push(child);
      queueMicrotask(() => child.emit('exit', 1, null));
      return child;
    },
    fetchImpl: async () => { throw new Error('private token=secret'); },
    maxRetries: 2,
    healthIntervalMs: 1,
    startupTimeoutMs: 20,
  });

  await assert.rejects(() => supervisor.ensureReady(), (error) => error.code === 'ASR_START_FAILED' && error.message === 'Local ASR service could not become ready.');
  assert.equal(children.length, 3);
  assert.equal(supervisor.getStatus().state, 'failed');
  assert.doesNotMatch(JSON.stringify(supervisor.getStatus()), /private|secret|token/);
});

test('supervisor can verify an already running service without spawning', async () => {
  let spawned = false;
  const supervisor = createAsrSupervisor({
    endpoint: 'https://[::1]:43123/transcribe',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://[::1]:43123/healthz');
      assert.equal(options.redirect, 'error');
      return new Response('{}', { status: 200 });
    },
    spawnImpl: () => { spawned = true; throw new Error('must not spawn'); },
  });
  assert.equal((await supervisor.ensureReady()).state, 'ready');
  assert.equal(spawned, false);
  await supervisor.stop();
  assert.equal(supervisor.getStatus().state, 'stopped');
});

test('supervisor rejects non-loopback endpoints and unsafe commands', () => {
  assert.throws(() => createAsrSupervisor({ endpoint: 'https://example.com/transcribe', command: ['python3'] }), /loopback/i);
  assert.throws(() => createAsrSupervisor({ endpoint: 'http://127.0.0.1/transcribe', command: 'python3 server.py' }), /array/i);
  assert.throws(() => createAsrSupervisor({ endpoint: 'http://127.0.0.1/transcribe', command: ['python3', ''] }), /command/i);
});

test('environment command parser accepts only a JSON argv array', () => {
  assert.deepEqual(parseAsrCommand('["python3","server.py","--model","models/base"]'), ['python3', 'server.py', '--model', 'models/base']);
  assert.equal(parseAsrCommand('python3 server.py'), null);
  assert.equal(parseAsrCommand('{"file":"python3"}'), null);
  assert.equal(parseAsrCommand('["python3",""]'), null);
});
