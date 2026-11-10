(function (root) {
  'use strict';

  function createMicrophoneCapture({
    bridge,
    mediaDevices = root.navigator?.mediaDevices,
    AudioContextClass = root.AudioContext || root.webkitAudioContext,
    AudioWorkletNodeClass = root.AudioWorkletNode,
    workletUrl = './pcm-worklet.js'
  } = {}) {
    let current = null;
    let state = 'idle';
    const deviceListeners = new Set();
    let deviceChangeHandler = null;
    const getState = () => ({ state, captureId: current?.captureId || null });
    const isCurrent = (run) => current === run;
    const quietly = (action) => { try { return action(); } catch { return undefined; } };
    const stopTracks = (stream) => {
      for (const track of stream?.getTracks() || []) quietly(() => track.stop());
    };

    function cleanup(run) {
      if (run.cleaned) return run.closed;
      run.cleaned = true;
      run.ready = false;
      run.queue.length = 0;
      for (const [track, listener] of run.trackListeners) quietly(() => track.removeEventListener('ended', listener));
      if (run.worklet) {
        quietly(() => run.worklet.removeEventListener('processorerror', run.processorError));
        run.worklet.port.onmessage = null;
        quietly(() => run.worklet.port.close());
      }
      for (const node of [run.source, run.worklet, run.gain]) quietly(() => node?.disconnect());
      stopTracks(run.stream);
      // A close failure must never prevent track and node cleanup or leak a rejection.
      run.closed = Promise.resolve(quietly(() => run.context?.close())).catch(() => {});
      return run.closed;
    }

    function end(run, nextState) {
      if (isCurrent(run)) { current = null; state = nextState; }
      return cleanup(run);
    }

    function fail(run, code) {
      if (!isCurrent(run)) return;
      end(run, 'failed');
      // Only static, allowlisted codes cross this boundary; browser error text stays local.
      Promise.resolve(quietly(() => bridge.invoke('audio.microphone-failed', { captureId: run.captureId, code }))).catch(() => {});
    }

    function browserErrorCode(error) {
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) return 'PERMISSION_DENIED';
      if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) return 'DEVICE_NOT_FOUND';
      return 'MICROPHONE_UNAVAILABLE';
    }

    async function pump(run) {
      if (!isCurrent(run) || !run.ready || run.inFlight || !run.queue.length) return;
      run.inFlight = true;
      const data = run.queue.shift();
      const sequence = run.sequence++;
      try {
        const result = await bridge.invoke('audio.microphone-chunk', { captureId: run.captureId, sequence, data });
        if (!isCurrent(run)) return;
        if (result?.ok === true && result.accepted === false) { end(run, 'stopped'); return; }
        if (result?.ok !== true || result.accepted !== true) { fail(run, 'MICROPHONE_UNAVAILABLE'); return; }
      } catch {
        if (isCurrent(run)) fail(run, 'MICROPHONE_UNAVAILABLE');
      } finally {
        run.inFlight = false;
      }
      if (isCurrent(run)) pump(run);
    }

    function packet(run, data) {
      if (!isCurrent(run) || !run.ready) return;
      if (run.queue.length >= 4) { fail(run, 'MICROPHONE_BACKPRESSURE'); return; }
      run.queue.push(new Uint8Array(data));
      pump(run);
    }

    async function start({ captureId, deviceId } = {}) {
      const old = current;
      const run = { captureId, queue: [], sequence: 0, inFlight: false, ready: false, cleaned: false, trackListeners: [] };
      // Replace the generation synchronously so no old async completion can affect it.
      current = run;
      state = 'starting';
      if (old) cleanup(old);
      try {
        if (!captureId || !mediaDevices?.getUserMedia || !AudioContextClass || !AudioWorkletNodeClass) {
          fail(run, 'MICROPHONE_UNAVAILABLE'); return getState();
        }
        const audio = { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        if (deviceId) audio.deviceId = { exact: deviceId };
        const stream = await mediaDevices.getUserMedia({ audio, video: false });
        // Permission prompts cannot be aborted. A late grant is still ours to release.
        if (!isCurrent(run)) { stopTracks(stream); return getState(); }
        run.stream = stream;
        for (const track of stream.getTracks()) {
          const listener = () => fail(run, 'DEVICE_LOST');
          run.trackListeners.push([track, listener]);
          track.addEventListener('ended', listener);
        }
        run.context = new AudioContextClass({ sampleRate: 16000 });
        await run.context.audioWorklet.addModule(workletUrl);
        if (!isCurrent(run)) return getState();
        run.source = run.context.createMediaStreamSource(stream);
        run.worklet = new AudioWorkletNodeClass(run.context, 'pcm-capture');
        run.processorError = () => fail(run, 'MICROPHONE_UNAVAILABLE');
        run.worklet.addEventListener('processorerror', run.processorError);
        run.gain = run.context.createGain();
        run.gain.gain.value = 0;
        run.worklet.port.onmessage = (event) => packet(run, event.data);
        run.source.connect(run.worklet);
        run.worklet.connect(run.gain);
        run.gain.connect(run.context.destination);
        await run.context.resume();
        if (!isCurrent(run)) return getState();
        const result = await bridge.invoke('audio.microphone-ready', { captureId, sampleRate: run.context.sampleRate, channels: 1 });
        if (!isCurrent(run)) return getState();
        if (result?.ok === true && result.accepted === false) { await end(run, 'stopped'); return getState(); }
        if (result?.ok !== true || result.accepted !== true) { fail(run, 'MICROPHONE_UNAVAILABLE'); return getState(); }
        run.ready = true;
        state = 'active';
      } catch (error) {
        if (isCurrent(run)) fail(run, browserErrorCode(error));
      }
      return getState();
    }

    async function release(nextState) {
      const run = current;
      current = null;
      state = nextState;
      if (run) await cleanup(run);
      return getState();
    }

    async function enumerateDevices() {
      if (!mediaDevices?.enumerateDevices) return [];
      try { return (await mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput'); }
      catch { return []; }
    }

    function attachDeviceChange() {
      if (deviceChangeHandler || typeof mediaDevices?.addEventListener !== 'function') return;
      deviceChangeHandler = () => {
        enumerateDevices().then((devices) => {
          for (const listener of [...deviceListeners]) {
            try { listener(devices); } catch { /* Device notifications must not break capture. */ }
          }
        }).catch(() => {});
      };
      quietly(() => mediaDevices.addEventListener('devicechange', deviceChangeHandler));
    }

    function detachDeviceChange() {
      if (!deviceChangeHandler || deviceListeners.size) return;
      quietly(() => mediaDevices?.removeEventListener?.('devicechange', deviceChangeHandler));
      deviceChangeHandler = null;
    }

    function onDeviceChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('device listener must be a function');
      deviceListeners.add(listener); attachDeviceChange();
      return () => { deviceListeners.delete(listener); detachDeviceChange(); };
    }

    function dispose() {
      deviceListeners.clear(); detachDeviceChange();
      return release('stopped');
    }

    return { start, pause: () => release('paused'), resume: start, stop: () => release('stopped'), enumerateDevices, onDeviceChange, dispose, getState };
  }

  root.createMicrophoneCapture = createMicrophoneCapture;
  if (typeof module === 'object' && module.exports) module.exports = { createMicrophoneCapture };
})(globalThis);
