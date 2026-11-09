const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('repository exposes the local rebuild entry points', () => {
  for (const relative of [
    'apps/desktop/main/index.cjs',
    'apps/desktop/preload/index.cjs',
    'services/local-api/server.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', relative)), true, relative);
  }
});
