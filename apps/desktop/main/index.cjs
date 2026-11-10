'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAuthService } = require('../../../packages/core/auth.cjs');
const { createJsonStore } = require('../../../packages/core/storage.cjs');
const { createSessionMachine } = require('../../../packages/core/session.cjs');
const { createIpcRouter } = require('../../../packages/core/ipc.cjs');
const { createCaptureProvider } = require('../../../packages/providers/capture.cjs');
const { createLocalTranscriptionProvider } = require('../../../packages/providers/transcription.cjs');
const { createSuggestionProvider } = require('../../../packages/providers/suggestions.cjs');
const { createLocalApi } = require('../../../services/local-api/server.cjs');

const DEFAULT_VERSION = '0.1.0';
function memoryStore() { let value = null; return { read: () => value, write: (next) => { value = structuredClone(next); }, clear: () => { value = null; } }; }
function createDefaultAuthTransport({ clock }) {
  const refreshTokens = new Set();
  function issue() { const accessToken = randomUUID(); const refreshToken = randomUUID(); refreshTokens.add(refreshToken); return { user: { id: 'local-dev', email: 'local-dev@example.com', displayName: 'Local Developer' }, accessToken, refreshToken, expiresAt: clock() + 3600000 }; }
  return { async login(email, password) { if (email !== 'local-dev@example.com' || password !== 'local-dev-password') throw new Error('Invalid credentials'); return issue(); }, async refresh(token) { if (!refreshTokens.delete(token)) throw new Error('Invalid refresh token'); return issue(); } };
}
function createLocalApiAuthTransport({ localApi, ensureStarted, fallback, onUnavailable }) {
  async function request(pathname, body, fallbackMethod) {
    let address;
    try {
      address = await ensureStarted();
    } catch (error) {
      onUnavailable?.(error);
      return fallback[fallbackMethod](...Object.values(body));
    }
    let response;
    try {
      response = await fetch(`http://${address.host}:${address.port}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      onUnavailable?.(error);
      return fallback[fallbackMethod](...Object.values(body));
    }
    const value = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(value?.error?.message || 'Authentication failed');
    return value;
  }
  return { login: (email, password) => request('/auth/login', { email, password }, 'login'), refresh: (refreshToken) => request('/auth/refresh', { refreshToken }, 'refresh') };
}

function createAppDependencies(options = {}) {
  const clock = options.clock || (() => Date.now());
  const store = options.store || (options.storePath ? createJsonStore(options.storePath) : memoryStore());
  const localApi = options.localApi || createLocalApi({ host: '127.0.0.1', port: 0, clock, storagePath: options.sessionStorePath });
  let apiStarted = false;
  let apiStartPromise = null;
  let offline = false;
  async function ensureApiStarted() {
    if (apiStarted) return localApi.address();
    if (!apiStartPromise) {
      apiStartPromise = (async () => {
        await localApi.start();
        apiStarted = true;
        return localApi.address();
      })();
    }
    const pending = apiStartPromise;
    try { return await pending; } finally { if (apiStartPromise === pending) apiStartPromise = null; }
  }
  async function stopApi() {
    if (apiStartPromise) { try { await apiStartPromise; } catch {} }
    if (!apiStarted) return;
    await localApi.stop();
    apiStarted = false;
  }
  const fallbackAuth = createDefaultAuthTransport({ clock });
  const authTransport = options.authTransport || createLocalApiAuthTransport({ localApi, ensureStarted: ensureApiStarted, fallback: fallbackAuth, onUnavailable: () => { offline = true; } });
  const auth = options.auth || createAuthService({ transport: authTransport, store, clock });
  const session = options.session || createSessionMachine({ idFactory: options.idFactory || randomUUID, clock });
  const transcription = options.transcription || createLocalTranscriptionProvider({ clock: options.timer || globalThis });
  const suggestions = options.suggestions || createSuggestionProvider();
  const electron = options.electron || null;
  const desktopCapturer = options.desktopCapturer || electron?.desktopCapturer;
  const screen = options.screen || electron?.screen;
  const windows = { dashboard: null, overlay: null };
  const emit = (event) => { for (const window of Object.values(windows)) if (window && !window.isDestroyed?.() && window.webContents?.send) window.webContents.send('local-rebuild:event', event); if (event?.type === 'transcript.final') emit({ type: 'suggestion', text: suggestions.suggest(event.text).text, timestamp: event.timestamp }); };
  const capture = options.capture || createCaptureProvider({
    getDisplays: () => (typeof screen?.getAllDisplays === 'function' ? screen.getAllDisplays().map((display) => ({ id: String(display.id), bounds: { ...display.bounds } })) : []),
    screenshot: async (displayId) => {
      if (!desktopCapturer?.getSources) return { ok: false, error: { code: 'CAPTURE_UNAVAILABLE', message: 'Screen capture is unavailable' } };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      const source = sources.find((item) => String(item.display_id || item.id) === String(displayId));
      if (!source) return { ok: false, error: { code: 'DISPLAY_NOT_FOUND', message: 'Display not found' } };
      const dataUrl = source.thumbnail?.toDataURL?.();
      return dataUrl ? { ok: true, displayId: String(displayId), dataUrl } : { ok: false, error: { code: 'CAPTURE_UNAVAILABLE', message: 'Screen capture is unavailable' } };
    },
  });
  const handlers = {
    'auth.login': ({ email, password }) => auth.login(email, password), 'auth.logout': () => auth.logout().then(() => ({ ok: true })), 'auth.get-session': () => auth.getSession(),
    'session.start': ({ title, language, notes }) => { session.start({ title, language, notes }); transcription.start({ emit }); emit({ type: 'capture.started', source: 'local' }); return session.getSnapshot(); },
    'session.pause': () => { session.pause(); transcription.pause(); emit({ type: 'session.paused', source: 'local' }); return session.getSnapshot(); }, 'session.resume': () => { session.resume(); transcription.resume(); emit({ type: 'session.resumed', source: 'local' }); return session.getSnapshot(); },
    'session.stop': () => { session.stop(); transcription.stop(); emit({ type: 'session.stopped', source: 'local' }); emit({ type: 'capture.stopped', source: 'local' }); return session.getSnapshot(); }, 'session.get-current': () => session.getSnapshot(),
    'capture.get-displays': () => capture.getDisplays(), 'capture.take-screenshot': ({ displayId }) => capture.takeScreenshot(displayId),
    'overlay.set-visible': ({ visible }) => { const overlay = windows.overlay; if (!overlay || overlay.isDestroyed?.()) return { ok: false, error: { code: 'OVERLAY_UNAVAILABLE', message: 'Overlay is unavailable' } }; visible ? overlay.show() : overlay.hide(); return { ok: true, visible }; },
    'overlay.set-bounds': (bounds) => { const overlay = windows.overlay; if (!overlay || overlay.isDestroyed?.()) return { ok: false, error: { code: 'OVERLAY_UNAVAILABLE', message: 'Overlay is unavailable' } }; if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return { ok: false, error: { code: 'INVALID_BOUNDS', message: 'Invalid overlay bounds' } }; overlay.setBounds(bounds); return { ok: true, bounds: { ...bounds } }; },
    'app.get-version': () => electron?.app?.getVersion?.() || options.version || DEFAULT_VERSION,
  };
  const router = createIpcRouter(handlers);
  function createWindow(kind, windowOptions = {}) {
    if (!electron?.BrowserWindow) return null;
    const isOverlay = kind === 'overlay';
    const win = new electron.BrowserWindow({ width: isOverlay ? 420 : 1120, height: isOverlay ? 240 : 760, ...windowOptions, webPreferences: { ...(windowOptions.webPreferences || {}), contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, '../preload/index.cjs') }, show: !isOverlay, transparent: isOverlay, frame: !isOverlay, alwaysOnTop: isOverlay });
    win.webContents?.on?.('will-navigate', (event) => event.preventDefault()); win.webContents?.on?.('will-redirect', (event) => event.preventDefault()); win.webContents?.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    win.on?.('closed', () => { if (windows[kind] === win) windows[kind] = null; });
    const loaded = win.loadFile?.(path.join(__dirname, '../renderer', `${kind}.html`)); loaded?.catch?.(() => {}); windows[kind] = win; return win;
  }
  function createWindows() { if (!windows.dashboard || windows.dashboard.isDestroyed?.()) createWindow('dashboard'); if (!windows.overlay || windows.overlay.isDestroyed?.()) createWindow('overlay'); return { ...windows }; }
  function registerIpc(ipcMain) { if (ipcMain?.handle) ipcMain.handle('local-rebuild:invoke', (event, command, payload) => router.dispatch(command, payload, { source: 'renderer', windowId: event?.sender?.id })); }
  return { localApi, ensureApiStarted, getApiAddress: () => localApi.address(), stopApi, get offline() { return offline; }, setOfflineMode: () => { offline = true; }, auth, session, capture, transcription, suggestions, router, handlers, windows, createWindow, createWindows, registerIpc, emit };
}

function runElectronApp(electron) { const { app, ipcMain, screen, desktopCapturer } = electron; const userData = app.getPath('userData'); const deps = createAppDependencies({ electron, screen, desktopCapturer, localApi: electron.__localApi, storePath: path.join(userData, 'local-rebuild-auth.json'), sessionStorePath: path.join(userData, 'local-rebuild-sessions.json') }); deps.registerIpc(ipcMain); app.whenReady().then(async () => { try { await deps.ensureApiStarted(); } catch { deps.setOfflineMode(); } deps.createWindows(); }); app.on('before-quit', () => { deps.stopApi(); }); app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); }); app.on('activate', () => deps.createWindows()); return deps; }
if (process.versions?.electron) { try { runElectronApp(require('electron')); } catch (error) { console.error('Unable to start local rebuild:', error.message); } }
module.exports = { createAppDependencies, runElectronApp };
