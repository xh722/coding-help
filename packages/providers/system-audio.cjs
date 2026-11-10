'use strict';

const PLATFORM_NOTES = Object.freeze({
  win32: 'Electron loopback desktop audio is a Windows-only path; a future capture flow must request display permission first.',
  darwin: 'macOS desktop audio requires the platform System Audio Recording permission and may expose an ended track when permission is missing.',
  linux: 'Linux desktop audio depends on PipeWire and the user display picker; this probe does not start a capture.',
});

function createSystemAudioCapabilityProvider({ platform = process.platform, desktopCapturer, getSources } = {}) {
  const sourceReader = getSources || (typeof desktopCapturer?.getSources === 'function'
    ? () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    : null);
  return {
    async probe() {
      if (typeof sourceReader !== 'function') return { capability: 'unavailable', captureStarted: false, code: 'CAPTURE_API_UNAVAILABLE', message: 'Desktop audio capture is unavailable in this build.' };
      let sources;
      try { sources = await sourceReader(); } catch { return { capability: 'unavailable', captureStarted: false, code: 'CAPTURE_SOURCE_ERROR', message: 'Desktop audio sources could not be inspected.' }; }
      if (!Array.isArray(sources) || sources.length === 0) return { capability: 'unavailable', captureStarted: false, code: 'NO_DESKTOP_SOURCE', message: 'No desktop source is available for system audio.' };
      if (!PLATFORM_NOTES[platform]) return { capability: 'unknown', captureStarted: false, code: 'PLATFORM_UNSUPPORTED', message: 'System audio capture is not implemented for this platform.' };
      return { capability: 'potential', captureStarted: false, platform, sourceCount: sources.length, method: 'display-media', message: PLATFORM_NOTES[platform] };
    },
  };
}

module.exports = { createSystemAudioCapabilityProvider, PLATFORM_NOTES };
