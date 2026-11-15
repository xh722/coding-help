'use strict';

const PRODUCT = 'interviewcoder-local-rebuild';
const FORMAT = 'coding-help-session-backup';
const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 10000;
const SENSITIVE_KEY = /(password|token|secret|authorization|cookie|credential|private[_-]?key|api[_-]?key)/i;

function fail(message) { throw new TypeError(message); }

function sanitize(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitize(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [childKey, child] of Object.entries(value)) {
    const sanitized = sanitize(child, childKey);
    if (sanitized !== undefined) result[childKey] = sanitized;
  }
  return result;
}

function normalizeTimestamp(value) {
  const timestamp = value === undefined ? new Date().toISOString() : (typeof value === 'number' ? new Date(value).toISOString() : value);
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) fail('Backup timestamp is invalid.');
  return new Date(timestamp).toISOString();
}

function validateSessions(value) {
  if (!Array.isArray(value) || value.length > MAX_SESSIONS) fail('Backup sessions are invalid.');
  const seen = new Set();
  const sessions = value.map((session) => {
    if (!session || typeof session !== 'object' || Array.isArray(session) || typeof session.id !== 'string' || !session.id || session.id.length > 200) fail('Backup session is invalid.');
    if (seen.has(session.id)) fail('Backup contains duplicate session ids.');
    seen.add(session.id);
    if (session.events !== undefined && !Array.isArray(session.events)) fail('Backup session events are invalid.');
    return sanitize(session);
  });
  return sessions;
}

function createBackupDocument(sessions, { exportedAt, product = PRODUCT } = {}) {
  if (product !== PRODUCT) fail('Backup product is invalid.');
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    product,
    exportedAt: normalizeTimestamp(exportedAt),
    sessions: validateSessions(sessions),
  };
}

function parseBackupDocument(value, { product = PRODUCT } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== FORMAT || value.schemaVersion !== SCHEMA_VERSION || value.product !== product) fail('Backup document is invalid.');
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))) fail('Backup timestamp is invalid.');
  const sessions = validateSessions(value.sessions);
  return { format: FORMAT, schemaVersion: SCHEMA_VERSION, product, exportedAt: new Date(value.exportedAt).toISOString(), sessions };
}

module.exports = { PRODUCT, FORMAT, SCHEMA_VERSION, createBackupDocument, parseBackupDocument, sanitize };
