// strict mode entry point
'use strict';

const { validateCommand } = require('../../../packages/core/ipc.cjs');

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
