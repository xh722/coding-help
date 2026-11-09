'use strict';

const nodeFs = require('node:fs');

function withoutPasswords(value) {
  if (Array.isArray(value)) return value.map(withoutPasswords);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase().includes('password')) continue;
    result[key] = withoutPasswords(child);
  }
  return result;
}

function createJsonStore(filePath, { fs = nodeFs, version = 1 } = {}) {
  const empty = () => ({ version, session: null });

  function read() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      return null;
    }
    try {
      const document = JSON.parse(raw);
      if (!document || document.version !== version || !Object.prototype.hasOwnProperty.call(document, 'session')) return null;
      return document.session == null ? null : withoutPasswords(document.session);
    } catch {
      return null;
    }
  }

  function write(session) {
    const temporaryPath = `${filePath}.tmp`;
    const document = JSON.stringify({ version, session: withoutPasswords(session) });
    fs.writeFileSync(temporaryPath, document, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }

  function clear() {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }

  return { read, write, clear };
}

module.exports = { createJsonStore };
