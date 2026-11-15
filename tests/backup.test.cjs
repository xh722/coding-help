'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackupDocument, parseBackupDocument } = require('../packages/core/backup.cjs');

test('backup documents are versioned and remove sensitive fields recursively', () => {
  const document = createBackupDocument([
    {
      id: 'session-1',
      metadata: { title: 'Local interview', token: 'private-token' },
      events: [{ type: 'transcript.final', text: 'answer', nested: { password: 'secret', keep: true } }],
    },
  ], { exportedAt: '2026-11-15T00:00:00.000Z' });
  assert.deepEqual(document, {
    format: 'coding-help-session-backup',
    schemaVersion: 1,
    product: 'interviewcoder-local-rebuild',
    exportedAt: '2026-11-15T00:00:00.000Z',
    sessions: [{ id: 'session-1', metadata: { title: 'Local interview' }, events: [{ type: 'transcript.final', text: 'answer', nested: { keep: true } }] }],
  });
  assert.deepEqual(parseBackupDocument(document), document);
});

test('backup parser rejects malformed documents and duplicate session ids', () => {
  assert.throws(() => parseBackupDocument({}), /backup document/i);
  assert.throws(() => parseBackupDocument({ format: 'coding-help-session-backup', schemaVersion: 1, product: 'interviewcoder-local-rebuild', exportedAt: '2026-11-15T00:00:00.000Z', sessions: [{ id: 'same' }, { id: 'same' }] }), /duplicate/i);
  assert.throws(() => parseBackupDocument({ format: 'coding-help-session-backup', schemaVersion: 1, product: 'interviewcoder-local-rebuild', exportedAt: 'not-a-date', sessions: [] }), /timestamp/i);
});
