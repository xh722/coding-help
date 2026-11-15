(function (root) {
  'use strict';

  function createSystemAudioCapture({
    bridge,
    mediaDevices = root.navigator?.mediaDevices,
    AudioContextClass = root.AudioContext || root.webkitAudioContext,
    AudioWorkletNodeClass = root.AudioWorkletNode,
    workletUrl = './pcm-worklet.js',
  } = {}) {
    let current = null;
    let state = 'idle';
    const quietly = (action) => { try { return action(); } catch { return undefined; } };
    const isCurrent = (run) => current === run;
    const stopTracks = (stream) => { for (const track of stream?.getTracks?.() || []) quietly(() => track.stop()); };

    function cleanup(run) {
      if (run.cleaned) return run.closed;
      run.cleaned = true; run.ready = false; run.queue.length = 0;
      for (const [track, listener] of run.trackListeners) quietly(() => track.removeEventListener('ended', listener));
      if (run.worklet) { quietly(() => run.worklet.removeEventListener('processorerror', run.processorError)); run.worklet.port.onmessage = null; quietly(() => run.worklet.port.close()); }
      for (const node of [run.source, run.worklet, run.gain]) quietly(() => node?.disconnect());
      stopTracks(run.stream);
      run.closed = Promise.resolve(quietly(() => run.context?.close())).catch(() => {});
      return run.closed;
    }

    function end(run, nextState) { if (isCurrent(run)) { current = null; state = nextState; } return cleanup(run); }
    function fail(run, code) {
      if (!isCurrent(run)) return;
      end(run, 'failed');
      Promise.resolve(quietly(() => bridge.invoke('audio.system-failed', { captureId: run.captureId, code }))).catch(() => {});
    }
    function browserErrorCode(error) {
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'PERMISSION_DENIED';
      if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) return 'DISPLAY_NOT_FOUND';
      return 'SYSTEM_AUDIO_UNAVAILABLE';
    }
    async function pump(run) {
      if (!isCurrent(run) || !run.ready || run.inFlight || !run.queue.length) return;
      run.inFlight = true; const data = run.queue.shift(); const sequence = run.sequence++;
      try {
        const result = await bridge.invoke('audio.system-chunk', { captureId: run.captureId, sequence, data });
        if (!isCurrent(run)) return;
        if (result?.ok === true && result.accepted === false) { end(run, 'stopped'); return; }
        if (result?.ok !== true || result.accepted !== true) { fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); return; }
      } catch { if (isCurrent(run)) fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); }
      finally { run.inFlight = false; }
      if (isCurrent(run)) pump(run);
    }
    function packet(run, data) {
      if (!isCurrent(run) || !run.ready) return;
      if (run.queue.length >= 4) { fail(run, 'SYSTEM_AUDIO_BACKPRESSURE'); return; }
      run.queue.push(new Uint8Array(data)); pump(run);
    }

    async function start({ captureId } = {}) {
      const old = current;
      const run = { captureId, queue: [], sequence: 0, inFlight: false, ready: false, cleaned: false, trackListeners: [] };
      current = run; state = 'starting'; if (old) cleanup(old);
      try {
        if (!captureId || !mediaDevices?.getDisplayMedia || !AudioContextClass || !AudioWorkletNodeClass) { fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); return getState(); }
        const stream = await mediaDevices.getDisplayMedia({
          video: true,
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (!isCurrent(run)) { stopTracks(stream); return getState(); }
        run.stream = stream;
        const tracks = stream.getTracks?.() || [];
        for (const track of tracks.filter((item) => item.kind === 'video')) quietly(() => track.stop());
        const audioTracks = stream.getAudioTracks?.() || tracks.filter((item) => item.kind === 'audio');
        if (!audioTracks.length) { fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); return getState(); }
        for (const track of audioTracks) {
          const listener = () => fail(run, 'SYSTEM_AUDIO_UNAVAILABLE');
          run.trackListeners.push([track, listener]); track.addEventListener?.('ended', listener);
        }
        run.context = new AudioContextClass({ sampleRate: 16000 });
        await run.context.audioWorklet.addModule(workletUrl);
        if (!isCurrent(run)) return getState();
        run.source = run.context.createMediaStreamSource(stream);
        run.worklet = new AudioWorkletNodeClass(run.context, 'pcm-capture');
        run.processorError = () => fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); run.worklet.addEventListener('processorerror', run.processorError);
        run.gain = run.context.createGain(); run.gain.gain.value = 0;
        run.worklet.port.onmessage = (event) => packet(run, event.data);
        run.source.connect(run.worklet); run.worklet.connect(run.gain); run.gain.connect(run.context.destination);
        await run.context.resume(); if (!isCurrent(run)) return getState();
        const result = await bridge.invoke('audio.system-ready', { captureId, sampleRate: run.context.sampleRate, channels: 1 });
        if (!isCurrent(run)) return getState();
        if (result?.ok === true && result.accepted === false) { await end(run, 'stopped'); return getState(); }
        if (result?.ok !== true || result.accepted !== true) { fail(run, 'SYSTEM_AUDIO_UNAVAILABLE'); return getState(); }
        run.ready = true; state = 'active';
      } catch (error) { if (isCurrent(run)) fail(run, browserErrorCode(error)); }
      return getState();
    }
    async function release(nextState) { const run = current; current = null; state = nextState; if (run) await cleanup(run); return getState(); }
    function getState() { return { state, captureId: current?.captureId || null }; }
    function dispose() { return release('stopped'); }
    return { start, pause: () => release('paused'), resume: start, stop: () => release('stopped'), dispose, getState };
  }

  root.createSystemAudioCapture = createSystemAudioCapture;
  if (typeof module === 'object' && module.exports) module.exports = { createSystemAudioCapture };
})(globalThis);
