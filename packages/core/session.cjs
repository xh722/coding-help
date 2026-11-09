'use strict';

const transitions = {
  idle: { start: 'active' },
  active: { pause: 'paused', stop: 'stopped' },
  paused: { resume: 'active', stop: 'stopped' },
  stopped: {},
};

function copy(value) {
  return structuredClone(value);
}

function createSessionMachine({ idFactory, clock }) {
  if (typeof idFactory !== 'function' || typeof clock !== 'function') {
    throw new TypeError('idFactory and clock must be functions');
  }

  const session = {
    id: idFactory(),
    state: 'idle',
    metadata: {},
    startedAt: null,
    stoppedAt: null,
    events: [],
  };
  const listeners = new Set();

  function getSnapshot() {
    return copy(session);
  }

  function notify() {
    const snapshot = getSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  function transition(operation, payload) {
    if (session.state === 'stopped' && operation === 'stop') return;
    const nextState = transitions[session.state][operation];
    if (!nextState) {
      throw new Error(`Invalid transition from ${session.state} via ${operation}`);
    }
    const timestamp = clock();
    session.state = nextState;
    if (operation === 'start') {
      session.metadata = copy(payload || {});
      session.startedAt = timestamp;
    }
    if (operation === 'stop') session.stoppedAt = timestamp;
    session.events.push(copy({ type: operation, timestamp, ...(payload || {}) }));
    notify();
  }

  return {
    getSnapshot,
    start(metadata) {
      transition('start', metadata);
    },
    pause() {
      transition('pause');
    },
    resume() {
      transition('resume');
    },
    stop() {
      transition('stop');
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createSessionMachine };
