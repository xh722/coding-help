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
  window.localRebuild.onEvent((event) => {
    if (!event) return;
    if (event.type === 'transcript.final') transcriptNode.textContent = event.text || 'Transcript received';
    if (event.type === 'suggestion') suggestionNode.textContent = event.text || 'Suggestion received';
    if (event.type === 'capture.started') { stateNode.textContent = 'Recording'; dot.classList.add('active'); }
    if (event.type === 'capture.stopped') { stateNode.textContent = 'Stopped'; dot.classList.remove('active'); }
  });
})();
