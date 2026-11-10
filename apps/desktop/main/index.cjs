'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAuthService } = require('../../../packages/core/auth.cjs');
const { createJsonStore } = require('../../../packages/core/storage.cjs');
const { createSessionMachine } = require('../../../packages/core/session.cjs');
const { createIpcRouter } = require('../../../packages/core/ipc.cjs');
const { createCaptureProvider } = require('../../../packages/providers/capture.cjs');
const { createAudioCaptureProvider, readWavFile, validateWavCapture } = require('../../../packages/providers/audio.cjs');
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

function createLocalSessionApiTransport({ ensureStarted }) {
  async function request(method, pathname, token, body) {
    const address = await ensureStarted();
    const options = { method, headers: { authorization: `Bearer ${token}` } };
    if (body !== undefined) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
    const response = await fetch(`http://${address.host}:${address.port}${pathname}`, options);
    const value = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(value?.error?.message || 'Session API request failed');
    return value;
  }
  return {
    create: (token, metadata) => request('POST', '/sessions', token, metadata),
    append: (token, id, event) => request('POST', `/sessions/${encodeURIComponent(id)}/events`, token, event),
    list: (token) => request('GET', '/sessions', token),
    delete: (token, id) => request('DELETE', `/sessions/${encodeURIComponent(id)}`, token),
  };
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
  const sessionApi = options.sessionApi || createLocalSessionApiTransport({ ensureStarted: ensureApiStarted });
  let apiSessionId = null;
  let persistenceQueue = Promise.resolve();
  function persistEvent(event) {
    const token = auth.getSession?.()?.accessToken;
    if (!apiSessionId || !token || typeof sessionApi.append !== 'function') return;
    const id = apiSessionId;
    const copy = structuredClone(event);
    persistenceQueue = persistenceQueue.then(() => sessionApi.append(token, id, copy)).catch(() => {
      broadcast({ type: 'session.persistence-error', message: 'Session history could not be saved.' });
    });
  }
  async function createPersistedSession(metadata) {
    const token = auth.getSession?.()?.accessToken;
    if (!token || typeof sessionApi.create !== 'function') return;
    try { apiSessionId = (await sessionApi.create(token, metadata))?.id || null; } catch { apiSessionId = null; }
  }
  const session = options.session || createSessionMachine({ idFactory: options.idFactory || randomUUID, clock });
  const transcription = options.transcription || createLocalTranscriptionProvider({ clock: options.timer || globalThis, mode: 'audio' });
  let selectedAudio = { source: 'deterministic', label: 'Demo PCM (no microphone)' };
  function makeAudio() {
    if (options.audio) return options.audio;
    if (selectedAudio.source === 'file') return createAudioCaptureProvider({ source: 'file', filePath: selectedAudio.path, clock: options.timer || globalThis });
    // Three seconds of generated silence. This is a pipeline demonstration, not recorded speech.
    return createAudioCaptureProvider({ clock: options.timer || globalThis, chunks: Array.from({ length: 150 }, () => Buffer.alloc(640)) });
  }
  let audio = makeAudio();
  let audioState = 'idle';
  let audioFailure = null;
  let startingSession = false;
  let selectingAudio = false;
  let stoppingSession = false;
  let lastProgressAt = 0;
  let operationQueue = Promise.resolve();
  const serialize = (operation) => {
    const next = operationQueue.then(operation);
    operationQueue = next.catch(() => {});
    return next;
  };
  const suggestions = options.suggestions || createSuggestionProvider();
  const electron = options.electron || null;
  const desktopCapturer = options.desktopCapturer || electron?.desktopCapturer;
  const screen = options.screen || electron?.screen;
  const windows = { dashboard: null, overlay: null };
  function broadcast(event) {
    for (const window of Object.values(windows)) {
      if (window && !window.isDestroyed?.() && window.webContents?.send) window.webContents.send('local-rebuild:event', event);
    }
  }
  const emit = (event) => {
    broadcast(event); persistEvent(event);
    if (event?.type === 'transcript.final') emit({ type: 'suggestion', text: suggestions.suggest(event.text).text, timestamp: event.timestamp, ...(event.demo ? { demo: true } : {}) });
  };
  const audioMessages = {
    PERMISSION_DENIED: 'Permission to read the audio input was denied.',
    FILE_NOT_FOUND: 'The selected audio file is no longer available.',
    FILE_READ_ERROR: 'The audio file could not be read.',
    MALFORMED_WAV: 'The selected file is not a valid PCM WAV file.',
    UNSUPPORTED_FORMAT: 'Choose an integer PCM WAV file (8, 16, 24 or 32 bit).',
    UNSUPPORTED_SOURCE: 'This audio source is not available.',
    AUDIO_TOO_LARGE: 'Audio input exceeds the supported size limit.',
    AUDIO_TOO_LONG: 'This audio file is too long. Split it into shorter clips (about 21 minutes each).',
    INVALID_CONFIGURATION: 'Audio configuration is invalid.',
    INVALID_CHUNK: 'Audio data is not aligned to sample frames.',
    AUDIO_CONSUMER_ERROR: 'The audio consumer could not process the input.',
    AUDIO_ERROR: 'Audio input failed.',
  };
  const audioBusy = () => startingSession || ['active', 'paused'].includes(session.getSnapshot().state);
  const audioStatus = () => ({
    source: selectedAudio.source, label: selectedAudio.label, state: audioState,
    sampleRate: selectedAudio.sampleRate || 16000, channels: selectedAudio.channels || 1,
    bitsPerSample: selectedAudio.bitsPerSample || 16,
    ...(transcription.getAudioStats?.() || { bytes: 0, chunks: 0 }),
  });
  function handleAudioEvent(event) {
    if (!['audio.started', 'audio.paused', 'audio.resumed', 'audio.stopped', 'audio.error'].includes(event?.type)) return;
    const safe = { type: event.type, source: selectedAudio.source, timestamp: clock() };
    for (const key of ['sampleRate', 'channels', 'bitsPerSample']) {
      if (Number.isFinite(event[key]) && event[key] > 0) safe[key] = event[key];
    }
    if (['pcm_u8', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'].includes(event.format)) safe.format = event.format;
    audioState = event.type.slice(6);
    if (event.type === 'audio.error') {
      safe.code = Object.hasOwn(audioMessages, event.code) ? event.code : 'AUDIO_ERROR';
      safe.message = audioMessages[safe.code];
      audioFailure = { code: safe.code, message: safe.message };
      transcription.stop(); audio.stop();
      if (['active', 'paused'].includes(session.getSnapshot().state)) session.stop();
      audioState = 'error'; emit(safe);
      emit({ type: 'session.error', ...audioFailure, timestamp: clock() });
      emit({ type: 'session.stopped', source: 'local', timestamp: clock() });
      return;
    }
    if (event.type === 'audio.stopped' && !stoppingSession && !audioFailure) transcription.finishAudio?.();
    emit(safe); broadcast({ type: 'audio.status', ...audioStatus() });
  }
  async function chooseAudioFile() {
    if (audioBusy() || selectingAudio) return { ok: false, error: { code: 'AUDIO_BUSY', message: 'Stop the session before changing its audio input.' } };
    if (!electron?.dialog?.showOpenDialog) return { ok: false, error: { code: 'DIALOG_UNAVAILABLE', message: 'File selection requires the desktop app.' } };
    selectingAudio = true;
    try {
      const result = await electron.dialog.showOpenDialog({ title: 'Choose a local PCM WAV file', properties: ['openFile'], filters: [{ name: 'PCM WAV audio', extensions: ['wav'] }] });
      if (result.canceled || !result.filePaths?.[0]) return { ...audioStatus(), canceled: true };
      if (audioBusy()) return { ok: false, error: { code: 'AUDIO_BUSY', message: 'Stop the session before changing its audio input.' } };
      const file = result.filePaths[0];
      const wav = readWavFile(file);
      validateWavCapture(wav);
      const { sampleRate, channels, bitsPerSample } = wav;
      selectedAudio = { source: 'file', label: path.basename(file), path: file, sampleRate, channels, bitsPerSample };
      audioState = 'idle'; return audioStatus();
    } catch (error) {
      const code = Object.hasOwn(audioMessages, error.code) ? error.code : 'FILE_READ_ERROR';
      return { ok: false, error: { code, message: audioMessages[code] } };
    } finally { selectingAudio = false; }
  }
  async function startSession(metadata) {
    if (selectingAudio) return { ok: false, error: { code: 'AUDIO_BUSY', message: 'Finish choosing the audio input first.' } };
    if (!['idle', 'stopped'].includes(session.getSnapshot().state)) return { ok: false, error: { code: 'INVALID_STATE', message: 'A session is already running.' } };
    startingSession = true; audioFailure = null;
    try {
      session.start(metadata); await persistenceQueue;
      apiSessionId = null; await createPersistedSession(metadata);
      audio = makeAudio(); lastProgressAt = clock();
      transcription.start({ emit });
      const started = audio.start({
        onEvent: handleAudioEvent,
        onChunk(chunk) {
          const accepted = transcription.pushAudio?.(chunk);
          if (accepted === false) throw new Error('Audio consumer rejected a chunk');
          if (clock() - lastProgressAt >= 200) { lastProgressAt = clock(); broadcast({ type: 'audio.status', ...audioStatus() }); }
        },
      });
      if (started === false && !audioFailure) handleAudioEvent({ type: 'audio.error' });
      if (audioFailure) return { ok: false, error: audioFailure };
      emit({ type: 'capture.started', source: 'local' });
      return session.getSnapshot();
    } catch (error) {
      handleAudioEvent({ type: 'audio.error', code: error.code });
      return { ok: false, error: audioFailure };
    } finally { startingSession = false; }
  }
  async function stopSession() {
    if (!['active', 'paused'].includes(session.getSnapshot().state)) { await persistenceQueue; return session.getSnapshot(); }
    stoppingSession = true;
    try {
      audio.stop();
      if (session.getSnapshot().state === 'paused') transcription.resume();
      transcription.finishAudio?.(); transcription.stop();
      session.stop();
      emit({ type: 'session.stopped', source: 'local' }); emit({ type: 'capture.stopped', source: 'local' });
      await persistenceQueue; return session.getSnapshot();
    } finally { stoppingSession = false; }
  }
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
    'auth.login': ({ email, password }) => auth.login(email, password),
    'auth.logout': () => serialize(async () => { await stopSession(); await auth.logout(); return { ok: true }; }),
    'auth.get-session': () => auth.getSession(),
    'session.start': ({ title, language, notes }) => serialize(() => startSession({ title, language, notes })),
    'session.pause': () => serialize(() => {
      if (session.getSnapshot().state !== 'active') return session.getSnapshot();
      session.pause(); audio.pause(); transcription.pause();
      emit({ type: 'session.paused', source: 'local' }); return session.getSnapshot();
    }),
    'session.resume': () => serialize(() => {
      if (session.getSnapshot().state !== 'paused') return session.getSnapshot();
      session.resume(); transcription.resume(); audio.resume();
      emit({ type: 'session.resumed', source: 'local' }); return session.getSnapshot();
    }),
    'session.stop': () => serialize(stopSession),
    'session.get-current': () => session.getSnapshot(),
    'audio.select-file': chooseAudioFile,
    'audio.use-demo': () => {
      if (audioBusy() || selectingAudio) return { ok: false, error: { code: 'AUDIO_BUSY', message: 'Stop the session before changing its audio input.' } };
      selectedAudio = { source: 'deterministic', label: 'Demo PCM (no microphone)' }; audioState = 'idle'; return audioStatus();
    },
    'audio.get-status': audioStatus,
    'session.list': async () => { await persistenceQueue; const token = auth.getSession?.()?.accessToken; if (!token || typeof sessionApi.list !== 'function') return []; try { return await sessionApi.list(token); } catch { return []; } },
    'session.delete': async ({ id }) => {
      if (id === apiSessionId && audioBusy()) return { ok: false, error: { code: 'SESSION_ACTIVE', message: 'Stop the session before deleting it.' } };
      await persistenceQueue;
      const token = auth.getSession?.()?.accessToken;
      if (!token || typeof sessionApi.delete !== 'function') return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in required' } };
      try { await sessionApi.delete(token, id); return { ok: true }; } catch { return { ok: false, error: { code: 'SESSION_DELETE_FAILED', message: 'Unable to delete session' } }; }
    },
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
    const loaded = win.loadFile?.(path.join(__dirname, '../renderer', isOverlay ? 'overlay.html' : 'index.html'));
    loaded?.catch?.(() => { broadcast({ type: 'app.error', message: 'A desktop page could not be loaded.' }); });
    windows[kind] = win; return win;
  }
  function createWindows() { if (!windows.dashboard || windows.dashboard.isDestroyed?.()) createWindow('dashboard'); if (!windows.overlay || windows.overlay.isDestroyed?.()) createWindow('overlay'); return { ...windows }; }
  function registerIpc(ipcMain) {
    ipcMain?.handle?.('local-rebuild:invoke', (event, command, payload) => {
      const trusted = Object.values(windows).some((win) => win && win.webContents === event?.sender);
      if (!trusted || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: { code: 'INVALID_CONTEXT', message: 'Invalid renderer context' } };
      return router.dispatch(command, payload, { source: 'renderer', windowId: event.sender.id });
    });
  }
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ||= serialize(async () => { await stopSession(); audio.stop(); transcription.stop(); await persistenceQueue; await stopApi(); });
    return shutdownPromise;
  };
  return { localApi, sessionApi, ensureApiStarted, getApiAddress: () => localApi.address(), stopApi, shutdown, flushSessionEvents: () => persistenceQueue, get offline() { return offline; }, setOfflineMode: () => { offline = true; }, auth, session, get audio() { return audio; }, capture, transcription, suggestions, router, handlers, windows, createWindow, createWindows, registerIpc, emit };
}

function runElectronApp(electron) {
  const { app, ipcMain, screen, desktopCapturer } = electron;
  const userData = app.getPath('userData');
  const deps = createAppDependencies({ electron, screen, desktopCapturer, localApi: electron.__localApi, storePath: path.join(userData, 'local-rebuild-auth.json'), sessionStorePath: path.join(userData, 'local-rebuild-sessions.json') });
  deps.registerIpc(ipcMain);
  app.whenReady().then(async () => { try { await deps.ensureApiStarted(); } catch { deps.setOfflineMode(); } deps.createWindows(); });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    deps.shutdown().finally(() => app.quit());
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => deps.createWindows());
  return deps;
}
if (process.versions?.electron && process.type === 'browser') { try { runElectronApp(require('electron')); } catch (error) { console.error('Unable to start local rebuild:', error.message); } }
module.exports = { createAppDependencies, runElectronApp };
