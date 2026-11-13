'use strict';

const { spawn } = require('node:child_process');
const { isLoopbackEndpoint } = require('./transcription-http.cjs');

const DEFAULT_STARTUP_TIMEOUT_MS = 15000;
const DEFAULT_HEALTH_INTERVAL_MS = 250;
const DEFAULT_TERMINATE_TIMEOUT_MS = 2000;
const MAX_RETRIES = 5;

class AsrSupervisorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AsrSupervisorError';
    this.code = code;
  }
}

function healthEndpoint(endpoint) {
  const url = new URL(endpoint);
  url.pathname = '/healthz';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function validateCommand(command) {
  if (command === undefined) return null;
  if (!Array.isArray(command) || command.length === 0) throw new TypeError('ASR command must be a non-empty array.');
  if (command.some((part) => typeof part !== 'string' || !part.trim())) throw new TypeError('ASR command entries must be non-empty strings.');
  return [...command];
}

function parseAsrCommand(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const command = JSON.parse(value);
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string' || !part.trim())) return null;
    return command;
  } catch {
    return null;
  }
}

function createAsrSupervisor({
  endpoint,
  command,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  terminateTimeoutMs = DEFAULT_TERMINATE_TIMEOUT_MS,
  maxRetries = 2,
} = {}) {
  const url = isLoopbackEndpoint(endpoint).toString();
  const healthUrl = healthEndpoint(url);
  const launchCommand = validateCommand(command);
  if (typeof spawnImpl !== 'function') throw new TypeError('A process spawn implementation is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120000) throw new TypeError('Invalid ASR startup timeout.');
  if (!Number.isInteger(healthIntervalMs) || healthIntervalMs < 1 || healthIntervalMs > 10000) throw new TypeError('Invalid ASR health interval.');
  if (!Number.isInteger(terminateTimeoutMs) || terminateTimeoutMs < 1 || terminateTimeoutMs > 30000) throw new TypeError('Invalid ASR terminate timeout.');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_RETRIES) throw new TypeError('Invalid ASR retry count.');

  let state = 'stopped';
  let child = null;
  let attempts = 0;
  let readyPromise = null;
  let pollTimer = null;
  let stopRequested = false;

  const staticError = (code, message) => new AsrSupervisorError(code, message);
  const snapshot = () => ({ state, pid: child?.pid || null, attempts });

  function clearPoll() {
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
  }

  async function healthCheck() {
    try {
      const response = await fetchImpl(healthUrl, { method: 'GET', redirect: 'error', headers: { accept: 'application/json' } });
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  function watchChild(process) {
    const onExit = () => {
      if (child !== process) return;
      child = null;
      if (stopRequested || state === 'stopped') return;
      if (state === 'ready' || state === 'starting') state = 'failed';
    };
    process.once?.('exit', onExit);
    process.once?.('error', onExit);
  }

  function launch() {
    if (!launchCommand) throw staticError('ASR_NOT_CONFIGURED', 'Local ASR service is not configured.');
    attempts += 1;
    try {
      child = spawnImpl(launchCommand[0], launchCommand.slice(1), {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      watchChild(child);
    } catch {
      child = null;
    }
  }

  async function waitUntilReady(deadline) {
    while (!stopRequested && Date.now() < deadline) {
      if (await healthCheck()) {
        state = 'ready';
        return snapshot();
      }
      if (child === null && attempts > 0) return null;
      await new Promise((resolve) => { pollTimer = setTimeout(() => { pollTimer = null; resolve(); }, healthIntervalMs); });
    }
    return null;
  }

  async function ensureReady() {
    if (state === 'ready' && await healthCheck()) return snapshot();
    if (readyPromise) return readyPromise;
    stopRequested = false;
    readyPromise = (async () => {
      state = 'starting';
      attempts = 0;
      if (!launchCommand) {
        if (await healthCheck()) { state = 'ready'; return snapshot(); }
        state = 'failed';
        throw staticError('ASR_NOT_CONFIGURED', 'Local ASR service is not configured.');
      }
      for (let retry = 0; retry <= maxRetries && !stopRequested; retry += 1) {
        launch();
        const ready = await waitUntilReady(Date.now() + startupTimeoutMs);
        if (ready) return ready;
        await terminateChild(false);
      }
      state = 'failed';
      throw staticError('ASR_START_FAILED', 'Local ASR service could not become ready.');
    })();
    try { return await readyPromise; } finally { readyPromise = null; }
  }

  async function terminateChild(force) {
    clearPoll();
    const process = child;
    if (!process) return;
    child = null;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      process.once?.('exit', done);
      try { process.kill?.(force ? 'SIGKILL' : 'SIGTERM'); } catch { done(); return; }
      if (force) { done(); return; }
      setTimeout(() => { if (!settled) { try { process.kill?.('SIGKILL'); } catch {} done(); } }, terminateTimeoutMs).unref?.();
    });
  }

  async function stop() {
    stopRequested = true;
    clearPoll();
    await terminateChild(false);
    state = 'stopped';
    attempts = 0;
    return snapshot();
  }

  return Object.freeze({ ensureReady, stop, getStatus: snapshot, getEndpoint: () => url });
}

module.exports = { createAsrSupervisor, AsrSupervisorError, healthEndpoint, parseAsrCommand };
