'use strict';

// Uses the real desktop entry/preload/renderer with a synthetic WAV and temporary user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

async function main() {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    console.error('NOT VERIFIED: run with a display, for example xvfb-run -a npm run smoke');
    process.exitCode = 2;
    return;
  }
  const repo = path.resolve(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-help-smoke-'));
  for (const name of ['config', 'cache', 'data']) fs.mkdirSync(path.join(root, name));
  const data = Buffer.alloc(64000); // Two seconds, 16kHz, mono, signed 16-bit silence.
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const wav = path.join(root, 'smoke.wav'); fs.writeFileSync(wav, Buffer.concat([header, data]));
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [repo, `--user-data-dir=${path.join(root, 'profile')}`, '--disable-gpu'];
  // Restricted Linux CI containers may explicitly opt into this test-only switch.
  if (process.env.CODING_HELP_SMOKE_NO_SANDBOX === '1') args.push('--no-sandbox');
  let desktop;
  try {
    desktop = await _electron.launch({ executablePath: require('electron'), args, env, timeout: 20000 });
    // Overlay and dashboard can finish loading in either order; select by actual page URL.
    let page;
    const deadline = Date.now() + 15000;
    while (!page && Date.now() < deadline) {
      page = desktop.windows().find((window) => window.url().endsWith('/index.html'));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(page, 'Dashboard did not load');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('#login-form').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => Object.keys(window.localRebuild).sort()), ['invoke', 'onEvent', 'removeEventListener']);
    await page.locator('#password').fill('local-dev-password');
    await page.locator('#login-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('auth-badge').textContent.startsWith('Signed in:'));
    // Mock only OS file selection; file parsing, chunk scheduling, IPC and UI remain real.
    await desktop.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, wav);
    await page.locator('#audio-file').click();
    await page.waitForFunction(() => document.getElementById('audio-source').textContent.includes('smoke.wav'));
    await page.locator('#title').fill('Missing input');
    fs.renameSync(wav, `${wav}.held`);
    await page.locator('#start').click();
    await page.waitForFunction(() => !document.getElementById('error').hidden);
    fs.renameSync(`${wav}.held`, wav);
    await page.locator('#title').fill('WAV smoke');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('transcript').textContent.includes('receiving local PCM'));
    assert.equal(await page.locator('#error').isVisible(), false, 'successful input retry must clear the previous error');
    await page.locator('#pause').click();
    await page.waitForFunction(() => document.getElementById('session-state').textContent === 'Paused');
    assert.equal(await page.locator('#session-state').textContent(), 'Paused');
    await page.locator('#resume').click();
    await page.waitForFunction(() => document.getElementById('transcript').textContent.includes('64000 bytes'));
    const status = await page.evaluate(() => window.localRebuild.invoke('audio.get-status', {}));
    assert.equal(status.bytes, 64000); assert.equal(status.chunks, 100);
    await page.waitForFunction(() => document.getElementById('audio-status').textContent.includes('64000 bytes'));
    assert.equal(status.source, 'file');
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.getElementById('session-state').textContent === 'Stopped');
    await page.locator('#history-list li').filter({ hasText: 'WAV smoke' }).click();
    const history = JSON.parse(await page.locator('#history-detail').textContent());
    assert.ok(history.events.some((event) => event.type === 'audio.started'));
    assert.ok(history.events.some((event) => event.type === 'transcript.final' && event.demo));
    assert.ok(history.events.every((event) => !('chunk' in event) && !('data' in event)));
    assert.ok(!JSON.stringify(history).includes(root));
    await page.locator('#audio-demo').click(); await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('session-state').textContent === 'Active');
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.querySelectorAll('#history-list li').length === 3);
    const screenshot = process.env.CODING_HELP_SMOKE_SCREENSHOT;
    if (screenshot) await page.screenshot({ path: path.resolve(screenshot), fullPage: true });
    assert.deepEqual(errors, []);
    const prefs = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()));
    assert.ok(prefs.every((p) => p.contextIsolation && p.sandbox && !p.nodeIntegration));
    console.log('Electron smoke PASS: real preload/login/WAV input/pause/resume/64000-byte delivery/history/second session.');
  } finally {
    if (desktop) await desktop.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
