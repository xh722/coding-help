const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionMachine } = require('../packages/core/session.cjs');

test('session transitions idle to active to paused to active to stopped', () => {
  const machine = createSessionMachine({ idFactory: () => 's-1', clock: () => 100 });
  assert.equal(machine.getSnapshot().state, 'idle');
  machine.start({ title: 'demo' });
  assert.equal(machine.getSnapshot().state, 'active');
  machine.pause();
  assert.equal(machine.getSnapshot().state, 'paused');
  machine.resume();
  assert.equal(machine.getSnapshot().state, 'active');
  machine.stop();
  machine.stop();
  assert.equal(machine.getSnapshot().state, 'stopped');
});

test('invalid transition reports a structured error and preserves state', () => {
  const machine = createSessionMachine({ idFactory: () => 's-1', clock: () => 100 });
  assert.throws(() => machine.pause(), /invalid transition/i);
  assert.equal(machine.getSnapshot().state, 'idle');
});

test('snapshot metadata and events are immutable copies and subscribers receive updates', () => {
  let now = 100;
  const machine = createSessionMachine({ idFactory: () => 's-1', clock: () => now++ });
  const metadata = { title: 'demo' };
  const snapshots = [];
  const unsubscribe = machine.subscribe((snapshot) => snapshots.push(snapshot));

  machine.start(metadata);
  const snapshot = machine.getSnapshot();
  metadata.title = 'changed';
  snapshot.metadata.title = 'mutated';
  snapshot.events.push({ type: 'fake', timestamp: 999 });

  assert.equal(machine.getSnapshot().metadata.title, 'demo');
  assert.equal(machine.getSnapshot().events.length, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].events[0].type, 'start');

  unsubscribe();
  machine.pause();
  assert.equal(snapshots.length, 1);
});
