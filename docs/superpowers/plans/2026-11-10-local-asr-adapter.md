# Optional local ASR adapter stage

The standard microphone and WAV paths remain the default input. The current transcription sink is a demo, so this stage adds an opt-in local HTTP adapter without sending audio to a remote service by accident.

## Contract

- `createLocalHttpTranscriptionProvider({ endpoint, fetchImpl, clock, requestTimeoutMs })` accepts only `http:`/`https:` loopback URLs (`localhost`, `127.0.0.1`, `::1`) with no URL credentials. Invalid endpoints fail closed.
- `start({ emit })`, `pause()`, `resume()`, `stop()`, `pushAudio(chunk)`, `finishAudio()`, `setAudioFormat(format)`, `getAudioStats()`, and `getMode()` match the current transcription provider shape.
- PCM remains in bounded memory and is posted once at session finish as a RIFF PCM WAV. The response must be JSON `{ text: string }`; text is trimmed and capped. Static error codes cover timeout, unavailable endpoint, bad response and payload limits. Raw response bodies, URLs with secrets and audio bytes never enter events/history.
- `CODING_HELP_TRANSCRIPTION_URL` opts the desktop app into the adapter. Without it, the existing demo provider remains selected. Invalid configuration falls back to demo with a visible status error. The app never chooses a remote endpoint implicitly.
- Main updates the adapter with negotiated sample rate/channels/bit depth, awaits finalization before stopping, and displays `LOCAL ASR · loopback endpoint` when configured. Transcript remains clearly labeled as demo when no endpoint is configured.

## Verification

Red-first provider tests cover loopback validation, WAV framing, response validation, bounded response parsing, timeout/error sanitization, pause/resume, bounded payload, and cleanup. Main integration tests cover configured mode and awaiting async finish. Existing WAV/microphone Electron smoke remains unchanged and passes. Documentation records the local-server protocol, configuration, privacy boundary, and absence of a bundled model.
