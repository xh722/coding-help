// strict mode entry point
'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');

const DEMO_EMAIL = 'local-dev@example.com';
const DEMO_PASSWORD = 'local-dev-password';
const MAX_BODY_BYTES = 1024 * 1024;

function json(res, status, value) {
  const body = value === undefined ? '' : JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function error(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function createLocalApi({ host = '127.0.0.1', port = 0, clock = () => Date.now() } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const sessions = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();
  let server;

  const user = { id: 'local-dev', email: DEMO_EMAIL, displayName: 'Local Developer' };
  function issueTokens() {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    accessTokens.set(accessToken, user.id);
    refreshTokens.set(refreshToken, user.id);
    return { accessToken, refreshToken, expiresAt: clock() + 3600000 };
  }
  function bearer(req) {
    const value = req.headers.authorization;
    if (!value || !/^Bearer\s+\S+$/.test(value)) return null;
    const token = value.slice(7).trim();
    return accessTokens.has(token) ? token : null;
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Object.assign(new Error('Invalid JSON body'), { code: 'INVALID_JSON' })); }
      });
      req.on('error', reject);
    });
  }
  function requireAuth(req, res) {
    const token = bearer(req);
    if (!token) {
      error(res, 401, 'UNAUTHORIZED', 'Bearer token required');
      return null;
    }
    return token;
  }
  async function handle(req, res) {
    const url = new URL(req.url, `http://${host}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    let body;
    if (req.method === 'POST') {
      try { body = await readBody(req); }
      catch (err) { return error(res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, err.code || 'INVALID_JSON', err.message); }
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      if (!body || body.email !== DEMO_EMAIL || body.password !== DEMO_PASSWORD) return error(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
      return json(res, 200, { user, ...issueTokens() });
    }
    if (req.method === 'POST' && url.pathname === '/auth/refresh') {
      const old = body && body.refreshToken;
      if (!old || !refreshTokens.has(old)) return error(res, 401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
      refreshTokens.delete(old);
      return json(res, 200, { user, ...issueTokens() });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const token = requireAuth(req, res);
      if (!token) return;
      accessTokens.delete(token);
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/user') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, user);
    }
    if (req.method === 'GET' && url.pathname === '/sessions') {
      if (!requireAuth(req, res)) return;
      return json(res, 200, [...sessions.values()].map((session) => structuredClone(session)));
    }
    if (req.method === 'POST' && url.pathname === '/sessions') {
      if (!requireAuth(req, res)) return;
      const session = { id: randomUUID(), metadata: structuredClone(body || {}), createdAt: clock(), events: [] };
      sessions.set(session.id, session);
      return json(res, 201, structuredClone(session));
    }
    if (req.method === 'POST' && parts.length === 3 && parts[0] === 'sessions' && parts[2] === 'events') {
      if (!requireAuth(req, res)) return;
      const session = sessions.get(parts[1]);
      if (!session) return error(res, 404, 'SESSION_NOT_FOUND', 'Session not found');
      session.events.push({ ...(structuredClone(body || {})), timestamp: clock() });
      return json(res, 201, structuredClone(session));
    }
    return error(res, 404, 'NOT_FOUND', 'Route not found');
  }
  return {
    start() {
      if (!server) server = http.createServer((req, res) => { handle(req, res).catch(() => error(res, 500, 'INTERNAL_ERROR', 'Internal server error')); });
      return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    },
    stop() {
      if (!server || !server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    },
    address() {
      const value = server && server.address();
      return typeof value === 'object' && value ? { host: value.address, port: value.port } : { host, port };
    },
  };
}

module.exports = { createLocalApi };
