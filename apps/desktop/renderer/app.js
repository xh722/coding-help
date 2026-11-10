(() => {
  'use strict';
  const bridge = window.localRebuild;
  const microphone = window.createMicrophoneCapture({ bridge, mediaDevices: navigator.mediaDevices, AudioContextClass: window.AudioContext, AudioWorkletNodeClass: window.AudioWorkletNode, workletUrl: './pcm-worklet.js' });
  const $ = (id) => document.getElementById(id);
  const state = { auth: null, session: null, history: [], selectedHistoryId: null, overlayVisible: false };
  const error = (message) => { const box = $('error'); box.textContent = message; box.hidden = !message; };
  const call = async (name, payload = {}) => {
    try { const result = await window.localRebuild.invoke(name, payload); if (result?.ok === false) throw new Error(result.error?.message || 'Request failed'); return result; }
    catch (cause) { error(cause.message || 'Request failed'); return null; }
  };
  const addEvent = (list, text, timestamp) => { const empty = list.querySelector('.empty'); if (empty) empty.remove(); const item = document.createElement('li'); item.textContent = text; if (timestamp) { const time = document.createElement('time'); time.textContent = new Date(timestamp).toLocaleTimeString(); item.append(time); } list.prepend(item); };
  function renderAuth() { const signedIn = Boolean(state.auth); $('auth-badge').textContent = signedIn ? `Signed in: ${state.auth.user?.email || 'local user'}` : 'Signed out'; $('logout').disabled = !signedIn; $('login-form').querySelector('button[type="submit"]').disabled = signedIn; }
  function renderSession() { const session = state.session || { state: 'idle' }; const current = session.state; const badge = $('session-state'); badge.textContent = current[0].toUpperCase() + current.slice(1); badge.className = `badge ${current}`; $('start').disabled = !state.auth || !['idle', 'stopped'].includes(current); $('pause').disabled = current !== 'active'; $('resume').disabled = current !== 'paused'; $('stop').disabled = !['active', 'paused'].includes(current); $('screenshot').disabled = !state.auth; for (const id of ['audio-file', 'audio-demo', 'audio-microphone', 'microphone-device', 'microphone-refresh']) $(id).disabled = ['active', 'paused'].includes(current); $('overlay-recording')?.classList.toggle('active', current === 'active'); }
  function renderHistory() { const list = $('history-list'); list.replaceChildren(); const selected = state.history.find((session) => session.id === state.selectedHistoryId) || null; $('history-export').disabled = !selected; $('history-delete').disabled = !selected; $('history-detail').hidden = !selected; $('history-detail').textContent = selected ? JSON.stringify(selected, null, 2) : ''; if (!state.history.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No saved sessions yet.'; list.append(empty); return; } for (const session of state.history) { const item = document.createElement('li'); item.tabIndex = 0; item.classList.toggle('selected', session.id === state.selectedHistoryId); const title = document.createElement('strong'); title.textContent = session.metadata?.title || session.id; const details = document.createElement('span'); details.textContent = ` · ${session.events?.length || 0} events`; item.append(title, details); item.addEventListener('click', () => { state.selectedHistoryId = session.id; renderHistory(); }); list.append(item); } }
  async function refreshHistory() { const history = await call('session.list'); if (Array.isArray(history)) { state.history = history; renderHistory(); } }
  function renderAudio(status) {
    if (!status) return;
    const isMicrophone = status.source === 'microphone'; $('microphone-controls').hidden = !isMicrophone;
    $('audio-source').textContent = `${status.label} · ${status.sampleRate} Hz · ${status.channels} channel(s) · ${status.bitsPerSample} bit`;
    const labels = { requesting: 'Requesting microphone access', started: 'Microphone active', resumed: 'Microphone active', paused: 'Paused — microphone released', stopped: 'Stopped — microphone released', idle: 'Microphone ready — click Start', error: 'Microphone stopped after an error' };
    const mode = status.transcriptionMode === 'local-http' ? 'LOCAL ASR · loopback' : 'DEMO · no speech recognition';
    $('transcription-label').textContent = mode;
    $('audio-status').textContent = `${isMicrophone ? (labels[status.state] || status.state) : status.state} · ${status.chunks || 0} chunks · ${status.bytes || 0} bytes · ${mode}`;
  }
  async function refreshDevices() {
    try {
      const devices = await microphone.enumerateDevices(); const select = $('microphone-device'); const selected = select.value;
      select.replaceChildren(new Option('Default microphone', ''));
      for (const [index, device] of devices.entries()) if (device.deviceId) select.add(new Option(device.label || `Microphone ${index + 1}`, device.deviceId));
      if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    } catch { error('Microphone devices could not be listed. Check system permissions.'); }
  }
  async function refreshAudio() { renderAudio(await call('audio.get-status')); }
  async function refresh() { state.auth = await call('auth.get-session'); state.session = await call('session.get-current'); const version = await call('app.get-version'); if (version) $('version').textContent = `v${version}`; renderAuth(); renderSession(); if (state.auth) await refreshHistory(); await refreshAudio(); }
  $('login-form').addEventListener('submit', async (event) => { event.preventDefault(); const result = await call('auth.login', { email: $('email').value.trim(), password: $('password').value }); if (result) { state.auth = result; error(''); renderAuth(); renderSession(); await refreshHistory(); } });
  $('logout').addEventListener('click', async () => { if (await call('auth.logout')) { state.auth = null; state.history = []; state.selectedHistoryId = null; renderHistory(); renderAuth(); renderSession(); } });
  $('session-form').addEventListener('submit', async (event) => { event.preventDefault(); error(''); const result = await call('session.start', { title: $('title').value.trim(), language: $('language').value.trim(), notes: $('notes').value.trim() }); if (result) { state.session = await call('session.get-current'); renderSession(); await refreshHistory(); await refreshAudio(); } });
  for (const [id, command] of [['pause', 'session.pause'], ['resume', 'session.resume'], ['stop', 'session.stop']]) $(id).addEventListener('click', async () => { const result = await call(command); if (result) { state.session = result; renderSession(); await refreshHistory(); await refreshAudio(); } });
  $('screenshot').addEventListener('click', async () => { const displays = await call('capture.get-displays'); const displayId = displays?.[0]?.id; if (!displayId) { error('No display is available for capture.'); return; } const result = await call('capture.take-screenshot', { displayId: String(displayId) }); if (result?.dataUrl) { $('screenshot-image').src = result.dataUrl; $('screenshot-preview').hidden = false; error(''); } });
  $('overlay').addEventListener('click', async () => { state.overlayVisible = !state.overlayVisible; const result = await call('overlay.set-visible', { visible: state.overlayVisible }); if (result) $('overlay').textContent = state.overlayVisible ? 'Hide overlay' : 'Show overlay'; });
  $('audio-file').addEventListener('click', async () => { const status = await call('audio.select-file'); if (status) { renderAudio(status); error(''); } });
  $('audio-demo').addEventListener('click', async () => { const status = await call('audio.use-demo'); if (status) { renderAudio(status); error(''); } });
  $('audio-microphone').addEventListener('click', async () => { const status = await call('audio.use-microphone'); if (status) { renderAudio(status); error(''); await refreshDevices(); } });
  $('microphone-refresh').addEventListener('click', refreshDevices);
  window.addEventListener('pagehide', () => { microphone.stop(); });
  window.addEventListener('beforeunload', () => { microphone.stop(); });
  bridge.onEvent((event) => {
    if (event?.type === 'microphone.start') microphone.start({ captureId: event.captureId, deviceId: $('microphone-device').value }).then(refreshDevices).catch(() => error('Microphone could not start.'));
    if (event?.type === 'microphone.stop' && microphone.getState().captureId === event.captureId) microphone.stop();
  });
  $('history-refresh').addEventListener('click', refreshHistory);
  $('history-export').addEventListener('click', () => { const selected = state.history.find((session) => session.id === state.selectedHistoryId); if (!selected) return; const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${selected.metadata?.title || selected.id}.json`; link.click(); URL.revokeObjectURL(link.href); });
  $('history-delete').addEventListener('click', async () => { if (!state.selectedHistoryId || !confirm('Delete this saved session?')) return; const result = await call('session.delete', { id: state.selectedHistoryId }); if (result) { state.selectedHistoryId = null; await refreshHistory(); } });
  window.localRebuild.onEvent((event) => { if (!event) return; if (event.type === 'audio.status') renderAudio(event); if (event.type === 'audio.error' || event.type === 'session.error' || event.type === 'session.persistence-error' || event.type === 'transcription.error' || event.type === 'transcription.config-error') error(event.message || 'Input failed'); if (event.type?.startsWith('audio.')) refreshAudio(); if (event.type === 'transcript.partial' || event.type === 'transcript.final') addEvent($('transcript'), event.text || 'Transcript received', event.timestamp); if (event.type === 'suggestion') addEvent($('suggestions'), event.text || 'Suggestion received', event.timestamp); if (event.type === 'capture.started' || event.type === 'session.resumed') { state.session = state.session || {}; state.session.state = 'active'; renderSession(); } if (event.type === 'session.paused') { state.session = state.session || {}; state.session.state = 'paused'; renderSession(); } if (event.type === 'capture.stopped' || event.type === 'session.stopped') { state.session = state.session || {}; state.session.state = 'stopped'; renderSession(); } });
  refresh();
})();
