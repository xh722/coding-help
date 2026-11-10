# Audio Capture Provider Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD.

**Goal:** Add a platform-neutral audio capture provider with deterministic PCM/WAV inputs and wire its lifecycle into the local session/transcription flow.

**Architecture:** `packages/providers/audio.cjs` owns audio source lifecycle and emits metadata/chunks without touching Electron. The transcription provider accepts PCM chunks through `pushAudio`; Electron main starts/pauses/resumes/stops the audio provider alongside sessions. Windows device capture remains an injectable provider and is not implemented in Linux.

**Constraints:** Do not run original binaries; do not persist raw PCM chunks; do not add network calls or real credentials; keep source/device errors structured; use author `19856850715@163.com`.

## Task 1: Audio provider contract

**Files:**
- Create: `packages/providers/audio.cjs`
- Create: `tests/audio.test.cjs`

**Interfaces:**
- `createAudioCaptureProvider({ source, chunks, filePath, fs, clock, sampleRate, channels, chunkDurationMs })` returns `start({ onEvent, onChunk })`, `pause()`, `resume()`, `stop()`, `getState()`.
- Events: `audio.started`, `audio.paused`, `audio.resumed`, `audio.stopped`, `audio.error`.
- Chunks are `Buffer`/`Uint8Array` passed only to `onChunk`; metadata includes source, sample rate, channels and format.
- `readWavFile(filePath, fs)` parses RIFF/WAVE PCM data and returns `{ sampleRate, channels, bitsPerSample, data }`.

Required tests: deterministic chunk order and timing, pause/resume, idempotent stop, missing file, malformed WAV, unsupported source/device error, and no raw chunk in event payload.

## Task 2: Transcription PCM input

**Files:**
- Modify: `packages/providers/transcription.cjs`
- Modify: `tests/providers.test.cjs`

Add `pushAudio(chunk)` and `getAudioStats()` to the provider. `pushAudio` accepts only Buffer/Uint8Array while active/paused, counts bytes/chunks, and never emits raw audio. Stop clears input state. Add tests for active/paused acceptance and invalid input rejection.

## Task 3: Main session wiring and documentation

**Files:**
- Modify: `apps/desktop/main/index.cjs`
- Modify: `tests/electron-contract.test.cjs`
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`

Create the audio provider in dependencies (injectable as `options.audio`), start it with the session, pass chunks to transcription, and forward only lifecycle events to the existing `emit`. Pause/resume/stop must call both providers and remain idempotent. Add a contract test with a fake audio provider. Update the roadmap to mark the platform-neutral audio layer complete while leaving Windows real-device capture pending. Update the README completion table and test count.
