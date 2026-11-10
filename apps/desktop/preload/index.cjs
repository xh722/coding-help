// strict mode entry point
'use strict';

const SCHEMAS = Object.freeze({
  'auth.login': { required: ['email', 'password'], fields: { email: 'string', password: 'string' } },
  'auth.logout': { required: [], fields: {} }, 'auth.get-session': { required: [], fields: {} },
  'session.start': { required: ['title'], fields: { title: 'string', language: 'string', notes: 'string' } },
  'session.pause': { required: [], fields: {} }, 'session.resume': { required: [], fields: {} }, 'session.stop': { required: [], fields: {} }, 'session.get-current': { required: [], fields: {} }, 'session.list': { required: [], fields: {} }, 'session.delete': { required: ['id'], fields: { id: 'string' } },
  'capture.get-displays': { required: [], fields: {} }, 'capture.take-screenshot': { required: [], fields: { displayId: 'string' } },
  'audio.select-file': { required: [], fields: {} }, 'audio.use-demo': { required: [], fields: {} }, 'audio.get-status': { required: [], fields: {} },
  'audio.use-microphone': { required: [], fields: {} },
  'audio.microphone-ready': { required: ['captureId', 'sampleRate', 'channels'], fields: { captureId: 'string', sampleRate: 'number', channels: 'number' } },
  'audio.microphone-chunk': { required: ['captureId', 'sequence', 'data'], fields: { captureId: 'string', sequence: 'number', data: 'pcm' } },
  'audio.microphone-failed': { required: ['captureId', 'code'], fields: { captureId: 'string', code: 'string' } },
  'overlay.set-visible': { required: ['visible'], fields: { visible: 'boolean' } }, 'overlay.set-bounds': { required: ['x', 'y', 'width', 'height'], fields: { x: 'number', y: 'number', width: 'number', height: 'number' } }, 'app.get-version': { required: [], fields: {} },
});
function validateCommand(name, payload) {
  const schema = Object.hasOwn(SCHEMAS, name) ? SCHEMAS[name] : null; if (!schema) return { ok: false, error: `Unknown command: ${name}` };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Payload must be an object' };
  for (const key of Object.keys(payload)) {
    if (!Object.hasOwn(schema.fields, key)) return { ok: false, error: `Unknown payload field: ${key}` };
    const type = schema.fields[key]; const value = payload[key];
    const valid = type === 'pcm' ? value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 16384 && value.byteLength % 2 === 0 : typeof value === type && (type !== 'number' || Number.isFinite(value));
    if (!valid) return { ok: false, error: `${key} must be a ${type}` };
  }
  for (const key of schema.required) if (!Object.prototype.hasOwnProperty.call(payload, key)) return { ok: false, error: `Missing required field: ${key}` };
  return { ok: true, value: { ...payload } };
}

function installBridge({ contextBridge, ipcRenderer }) {
  if (!contextBridge || typeof contextBridge.exposeInMainWorld !== 'function') throw new TypeError('contextBridge is required');
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function' || typeof ipcRenderer.on !== 'function') throw new TypeError('ipcRenderer is required');

  const callbacks = new Map();
  const eventChannel = 'local-rebuild:event';

  function invoke(command, payload = {}) {
    const validation = validateCommand(command, payload);
    if (!validation.ok) return Promise.reject(new Error(validation.error));
    return ipcRenderer.invoke('local-rebuild:invoke', command, validation.value);
  }

  function onEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (callbacks.has(listener)) throw new Error('listener already registered');
    const wrapped = (_event, payload) => listener(payload);
    callbacks.set(listener, wrapped);
    ipcRenderer.on(eventChannel, wrapped);
    return () => removeEventListener(listener);
  }

  function removeEventListener(listener) {
    const wrapped = callbacks.get(listener);
    if (!wrapped) return;
    ipcRenderer.removeListener?.(eventChannel, wrapped);
    callbacks.delete(listener);
  }

  const api = Object.freeze({ invoke, onEvent, removeEventListener });
  contextBridge.exposeInMainWorld('localRebuild', api);
  return api;
}

try {
  // Electron supplies this module; Node tests use installBridge with fakes.
  const electron = require('electron');
  if (electron?.contextBridge && electron?.ipcRenderer) installBridge(electron);
} catch {
  // Electron is an optional dev dependency for Node-only tests.
}

module.exports = { installBridge };
