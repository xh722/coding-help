'use strict';

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function createAuthService({ transport, store, clock = () => Date.now() }) {
  if (!transport || typeof transport.login !== 'function' || typeof transport.refresh !== 'function') {
    throw new TypeError('transport must provide login and refresh');
  }
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function' || typeof store.clear !== 'function') {
    throw new TypeError('store must provide read, write and clear');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  let session;
  try {
    session = store.read();
  } catch {
    session = null;
  }

  function persist(next) {
    session = copy(next);
    store.write(session);
    return copy(session);
  }

  return {
    async login(email, password) {
      const next = await transport.login(email, password);
      return persist(next);
    },
    async refresh(refreshToken) {
      const next = await transport.refresh(refreshToken);
      return persist(next);
    },
    getSession() {
      return copy(session);
    },
    async logout() {
      session = null;
      store.clear();
    },
  };
}

module.exports = { createAuthService };
