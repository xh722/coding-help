(() => {
  'use strict';
  const bridge = window.localRebuild;
  const query = new URLSearchParams(window.location.search);
  const stateNode = document.getElementById('overlay-state');
  const transcriptNode = document.getElementById('overlay-transcript');
  const suggestionNode = document.getElementById('overlay-suggestion');
  const dot = document.getElementById('overlay-recording');
  const initialState = query.get('state');
  if (initialState) stateNode.textContent = initialState;
  document.getElementById('hide-overlay').addEventListener('click', () => bridge.invoke('overlay.set-visible', { visible: false }));
  const setSessionState = (value) => { stateNode.textContent = value; dot.classList.toggle('active', value === 'Recording'); };
  const refreshSession = async () => { const snapshot = await window.localRebuild.invoke('session.get-current', {}); if (snapshot?.state) setSessionState(snapshot.state === 'active' ? 'Recording' : snapshot.state[0].toUpperCase() + snapshot.state.slice(1)); };
  window.localRebuild.onEvent((event) => {
    if (!event) return;
    if (event.type === 'transcript.partial' || event.type === 'transcript.final') transcriptNode.textContent = event.text || 'Transcript received';
    if (event.type === 'suggestion') suggestionNode.textContent = event.text || 'Suggestion received';
    if (event.type === 'capture.started' || event.type === 'session.resumed') setSessionState('Recording');
    if (event.type === 'session.paused') setSessionState('Paused');
    if (event.type === 'capture.stopped' || event.type === 'session.stopped') setSessionState('Stopped');
    if (event.type === 'session.paused' || event.type === 'session.resumed' || event.type === 'session.stopped') refreshSession();
  });
  refreshSession();
})();
