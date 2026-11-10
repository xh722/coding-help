(() => {
  'use strict';
  const bridge = window.localRebuild;
  const $ = (id) => document.getElementById(id);
  const state = { auth: null, session: null, overlayVisible: false };
  const error = (message) => { const box = $('error'); box.textContent = message; box.hidden = !message; };
  const call = async (name, payload = {}) => {
    try { const result = await window.localRebuild.invoke(name, payload); if (result?.ok === false) throw new Error(result.error?.message || 'Request failed'); return result; }
    catch (cause) { error(cause.message || 'Request failed'); return null; }
  };
  const addEvent = (list, text, timestamp) => { const empty = list.querySelector('.empty'); if (empty) empty.remove(); const item = document.createElement('li'); item.textContent = text; if (timestamp) { const time = document.createElement('time'); time.textContent = new Date(timestamp).toLocaleTimeString(); item.append(time); } list.prepend(item); };
  function renderAuth() { const signedIn = Boolean(state.auth); $('auth-badge').textContent = signedIn ? `Signed in: ${state.auth.user?.email || 'local user'}` : 'Signed out'; $('logout').disabled = !signedIn; $('login-form').querySelector('button[type="submit"]').disabled = signedIn; }
  function renderSession() { const session = state.session || { state: 'idle' }; const current = session.state; const badge = $('session-state'); badge.textContent = current[0].toUpperCase() + current.slice(1); badge.className = `badge ${current}`; $('start').disabled = !state.auth || current !== 'idle'; $('pause').disabled = current !== 'active'; $('resume').disabled = current !== 'paused'; $('stop').disabled = !['active', 'paused'].includes(current); $('screenshot').disabled = !state.auth; $('overlay-recording')?.classList.toggle('active', current === 'active'); }
  async function refresh() { state.auth = await call('auth.get-session'); state.session = await call('session.get-current'); const version = await call('app.get-version'); if (version) $('version').textContent = `v${version}`; renderAuth(); renderSession(); }
  $('login-form').addEventListener('submit', async (event) => { event.preventDefault(); const result = await call('auth.login', { email: $('email').value.trim(), password: $('password').value }); if (result) { state.auth = result; error(''); renderAuth(); renderSession(); } });
  $('logout').addEventListener('click', async () => { if (await call('auth.logout')) { state.auth = null; renderAuth(); renderSession(); } });
  $('session-form').addEventListener('submit', async (event) => { event.preventDefault(); const result = await call('session.start', { title: $('title').value.trim(), language: $('language').value.trim(), notes: $('notes').value.trim() }); if (result) { state.session = result; renderSession(); } });
  for (const [id, command] of [['pause', 'session.pause'], ['resume', 'session.resume'], ['stop', 'session.stop']]) $(id).addEventListener('click', async () => { const result = await call(command); if (result) { state.session = result; renderSession(); } });
  $('screenshot').addEventListener('click', async () => { const displays = await call('capture.get-displays'); const displayId = displays?.[0]?.id; if (!displayId) { error('No display is available for capture.'); return; } const result = await call('capture.take-screenshot', { displayId: String(displayId) }); if (result?.dataUrl) { $('screenshot-image').src = result.dataUrl; $('screenshot-preview').hidden = false; error(''); } });
  $('overlay').addEventListener('click', async () => { state.overlayVisible = !state.overlayVisible; const result = await call('overlay.set-visible', { visible: state.overlayVisible }); if (result) $('overlay').textContent = state.overlayVisible ? 'Hide overlay' : 'Show overlay'; });
  window.localRebuild.onEvent((event) => { if (!event) return; if (event.type === 'transcript.partial' || event.type === 'transcript.final') addEvent($('transcript'), event.text || 'Transcript received', event.timestamp); if (event.type === 'suggestion') addEvent($('suggestions'), event.text || 'Suggestion received', event.timestamp); if (event.type === 'capture.started' || event.type === 'session.resumed') { state.session = state.session || {}; state.session.state = 'active'; renderSession(); } if (event.type === 'session.paused') { state.session = state.session || {}; state.session.state = 'paused'; renderSession(); } if (event.type === 'capture.stopped' || event.type === 'session.stopped') { state.session = state.session || {}; state.session.state = 'stopped'; renderSession(); } });
  refresh();
})();
