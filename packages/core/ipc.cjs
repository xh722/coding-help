'use strict';

const COMMANDS = Object.freeze([
  'auth.login', 'auth.logout', 'auth.get-session',
  'session.start', 'session.pause', 'session.resume', 'session.stop', 'session.get-current',
  'capture.get-displays', 'capture.take-screenshot',
  'overlay.set-visible', 'overlay.set-bounds', 'app.get-version',
]);

const schemas = {
  'auth.login': { required: ['email', 'password'], fields: { email: 'string', password: 'string' } },
  'auth.logout': { required: [], fields: {} },
  'auth.get-session': { required: [], fields: {} },
  'session.start': { required: ['title'], fields: { title: 'string', language: 'string', notes: 'string' } },
  'session.pause': { required: [], fields: {} },
  'session.resume': { required: [], fields: {} },
  'session.stop': { required: [], fields: {} },
  'session.get-current': { required: [], fields: {} },
  'capture.get-displays': { required: [], fields: {} },
  'capture.take-screenshot': { required: [], fields: { displayId: 'string' } },
  'overlay.set-visible': { required: ['visible'], fields: { visible: 'boolean' } },
  'overlay.set-bounds': { required: ['x', 'y', 'width', 'height'], fields: { x: 'number', y: 'number', width: 'number', height: 'number' } },
  'app.get-version': { required: [], fields: {} },
};

function validateCommand(name, payload) {
  const schema = schemas[name];
  if (!schema) return { ok: false, error: `Unknown command: ${name}` };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Payload must be an object' };
  }
  for (const key of Object.keys(payload)) {
    if (!Object.prototype.hasOwnProperty.call(schema.fields, key)) return { ok: false, error: `Unknown payload field: ${key}` };
    const type = schema.fields[key];
    if (typeof payload[key] !== type || (type === 'number' && !Number.isFinite(payload[key]))) {
      return { ok: false, error: `${key} must be a ${type}` };
    }
  }
  for (const key of schema.required) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return { ok: false, error: `Missing required field: ${key}` };
  }
  return { ok: true, value: { ...payload } };
}

function createIpcRouter(handlers = {}) {
  return {
    async dispatch(name, payload = {}, context = {}) {
      if (!schemas[name]) throw new Error(`Unknown command: ${name}`);
      const validation = validateCommand(name, payload);
      if (!validation.ok) return { ok: false, error: { code: 'INVALID_PAYLOAD', message: validation.error } };
      const handler = handlers[name];
      if (typeof handler !== 'function') return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Command is unavailable' } };
      try {
        return await handler(validation.value, { source: context.source, windowId: context.windowId });
      } catch {
        return { ok: false, error: { code: 'HANDLER_ERROR', message: 'Request failed' } };
      }
    },
  };
}

module.exports = { COMMANDS, validateCommand, createIpcRouter };
