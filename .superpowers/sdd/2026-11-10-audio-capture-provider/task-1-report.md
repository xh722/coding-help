# Task 1 report: audio provider contract

Status: complete.

Implemented `packages/providers/audio.cjs` with deterministic PCM chunk capture, WAV PCM parsing, lifecycle state/events, pause/resume/stop handling, structured source/file errors, and chunk metadata. Raw chunks are delivered only through `onChunk` and never included in lifecycle event payloads.

Added focused contract coverage in `tests/audio.test.cjs` for chunk order/timing, pause/resume, idempotent stop, WAV metadata/data parsing, missing and malformed files, unsupported sources, and event payload privacy.

Verification:

- `node --test tests/audio.test.cjs`: 10/10 subtests passed.
- `npm run check`: passed.
- `npm test`: the new audio suite and 7 other suites pass; existing `tests/local-api.test.cjs` and `tests/local-flow.test.cjs` fail during their existing top-level setup before registering subtests.

Concern: real Windows device capture remains intentionally unsupported and reports `UNSUPPORTED_SOURCE`, per the plan.

Review follow-up: timer fallback now safely uses global timers when an injected clock only supplies `now`; WAV-derived metadata now preserves bit depth (`pcm_s8`, `pcm_s16le`, `pcm_s24le`, or `pcm_s32le`). Regression coverage was added for both cases.

## Integration hardening follow-up (uncommitted, shared worktree)

Supersedes the earlier 8-bit naming: WAV PCM 8-bit is unsigned, so metadata now reports `pcm_u8`, consistent with [Microsoft PCM waveform documentation](https://learn.microsoft.com/en-us/windows/win32/multimedia/devices-and-data-types).

Modified only `packages/providers/audio.cjs`, `tests/audio.test.cjs`, and this scratch report. No commit, push, stash, original binary execution, or external application writes were performed.

Added strict RIFF declared-size/chunk bounds/padding checks; PCM-only format validation; byteRate/blockAlign/frame consistency checks; a 64 MiB file/aggregate chunk limit; 65,536 chunk count limit; sample rate 1–384,000 Hz, channel count 1–32, and chunk duration 0.1–60,000 ms validation. File playback splits only whole sample frames and uses actual frame duration for playback timing. Metadata includes bit depth, format, zero-based sequence, sampleOffset, durationMs, and timestamps. All lifecycle events contain timestamped metadata only. Preparation/source errors use fixed messages without file paths. Consumer exceptions terminate capture with AUDIO_CONSUMER_ERROR and a fixed safe message; even an exception in the error consumer cannot escape. Stop and completion cancel timers and clear prepared data, source chunks/file/fs, and callback references; reentrant stop and pause/resume avoid duplicate stops/timers. Start returns a boolean.

TDD evidence: the expanded tests first reported 7 expected behavioral failures; two additional reentrancy/privacy tests then each failed before their fixes. Final focused verification: `node tests/audio.test.cjs` passes 18/18 subtests; `node --test tests/audio.test.cjs` passes; `npm run check` passes. Real temporary WAV files cover 8/16/24/32-bit PCM; the 44.1kHz stereo 24-bit 1ms fixture splits 100 frames into 44/44/12 frames with exact byte reconstruction and metadata.

`npm test` at this shared-worktree snapshot reports 9/12 file suites passing. Direct diagnostic runs (`node tests/local-api.test.cjs`, `node tests/local-flow.test.cjs`) show loopback `listen EPERM 127.0.0.1`, an environment restriction. `node tests/electron-contract.test.cjs` shows 12/13 subtests passing; its remaining event expectation omits the newly required timestamps/full lifecycle metadata. Parent owns that integration test and was notified; it was not edited here.

Final integration acceptance: the earlier sandbox-only EPERM observations are superseded by the authoritative loopback-enabled 80/80 test run and real Electron/Xvfb smoke. See reports/audio-input-verification-2026-11-10.md. PCM8 is unsigned pcm_u8; the desktop now selects WAV via a native dialog and uses sustained audio-input mode.
