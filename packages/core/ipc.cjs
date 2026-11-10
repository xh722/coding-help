'use strict';

const COMMANDS = Object.freeze([
  'auth.login', 'auth.logout', 'auth.get-session',
  'session.start', 'session.pause', 'session.resume', 'session.stop', 'session.get-current', 'session.list', 'session.delete',
  'capture.get-displays', 'capture.take-screenshot',
  'audio.select-file', 'audio.use-demo', 'audio.get-status',
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
  'session.list': { required: [], fields: {} },
  'session.delete': { required: ['id'], fields: { id: 'string' } },
  'audio.select-file': { required: [], fields: {} },
  'audio.use-demo': { required: [], fields: {} },
  'audio.get-status': { required: [], fields: {} },
  'capture.get-displays': { required: [], fields: {} },
  'capture.take-screenshot': { required: [], fields: { displayId: 'string' } },
  'overlay.set-visible': { required: ['visible'], fields: { visible: 'boolean' } },
  'overlay.set-bounds': { required: ['x', 'y', 'width', 'height'], fields: { x: 'number', y: 'number', width: 'number', height: 'number' } },
  'app.get-version': { required: [], fields: {} },
};
const SCHEMAS = Object.freeze(Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [
  name, Object.freeze({ required: Object.freeze([...schema.required]), fields: Object.freeze({ ...schema.fields }) }),
])));

class IpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.error = { code, message };
  }
}

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
      if (!schemas[name]) throw new IpcError('UNKNOWN_COMMAND', 'Unknown command');
      const safeContext = context && typeof context === 'object' ? context : {};
      if (safeContext.source !== 'renderer' ||
          (typeof safeContext.windowId !== 'string' && typeof safeContext.windowId !== 'number') ||
          (typeof safeContext.windowId === 'string' && safeContext.windowId.trim() === '') ||
          (typeof safeContext.windowId === 'number' && !Number.isFinite(safeContext.windowId))) {
        return { ok: false, error: { code: 'INVALID_CONTEXT', message: 'Invalid renderer context' } };
      }
      const validation = validateCommand(name, payload);
      if (!validation.ok) return { ok: false, error: { code: 'INVALID_PAYLOAD', message: validation.error } };
      const handler = handlers[name];
      if (typeof handler !== 'function') return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Command is unavailable' } };
      try {
        const result = await handler(validation.value, { source: safeContext.source, windowId: safeContext.windowId });
        if (result && result.ok === false) {
          const code = typeof result.error?.code === 'string' ? result.error.code : 'HANDLER_ERROR';
          const rawMessage = typeof result.error?.message === 'string' ? result.error.message : '';
          const sensitive = /(token|password|secret|authorization|bearer|stack)/i.test(rawMessage) ||
            Object.keys(result.error || {}).some((key) => /token|password|secret|stack|authorization/i.test(key));
          return { ok: false, error: { code, message: sensitive ? 'Request failed' : (rawMessage || 'Request failed') } };
        }
        return result;
      } catch {
        return { ok: false, error: { code: 'HANDLER_ERROR', message: 'Request failed' } };
      }
    },
  };
}

module.exports = { COMMANDS, SCHEMAS, validateCommand, createIpcRouter };
