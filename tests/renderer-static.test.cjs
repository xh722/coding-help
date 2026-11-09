const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDir = path.join(__dirname, '..', 'apps', 'desktop', 'renderer');

function read(name) {
  return fs.readFileSync(path.join(rendererDir, name), 'utf8');
}

test('dashboard and overlay HTML use a local CSP and local scripts', () => {
  for (const file of ['index.html', 'overlay.html']) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/i, file);
    assert.match(html, /script[^>]+src=["'](?:\.\/)?[^"']+\.js["']/i, file);
    assert.doesNotMatch(html, /https?:\/\//i, file);
  }
});

test('dashboard renderer uses only the narrow local bridge', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /\brequire\s*\(/, 'app.js');
  assert.doesNotMatch(app, /ipcRenderer|child_process/, 'app.js');
  assert.match(app, /window\.localRebuild\.invoke/);
  assert.match(app, /window\.localRebuild\.onEvent/);
});

test('overlay renderer uses only the narrow local bridge', () => {
  const overlay = read('overlay.js');
  assert.doesNotMatch(overlay, /\brequire\s*\(/, 'overlay.js');
  assert.doesNotMatch(overlay, /ipcRenderer|child_process/, 'overlay.js');
  assert.match(overlay, /window\.localRebuild\.onEvent/);
});
