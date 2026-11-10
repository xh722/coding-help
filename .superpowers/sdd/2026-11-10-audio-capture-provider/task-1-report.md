# Task 1 report: audio provider contract

Status: complete.

Implemented `packages/providers/audio.cjs` with deterministic PCM chunk capture, WAV PCM parsing, lifecycle state/events, pause/resume/stop handling, structured source/file errors, and chunk metadata. Raw chunks are delivered only through `onChunk` and never included in lifecycle event payloads.

Added focused contract coverage in `tests/audio.test.cjs` for chunk order/timing, pause/resume, idempotent stop, WAV metadata/data parsing, missing and malformed files, unsupported sources, and event payload privacy.

Verification:

- `node --test tests/audio.test.cjs`: 8/8 subtests passed.
- `npm run check`: passed.
- `npm test`: the new audio suite and 7 other suites pass; existing `tests/local-api.test.cjs` and `tests/local-flow.test.cjs` fail during their existing top-level setup before registering subtests.

Concern: real Windows device capture remains intentionally unsupported and reports `UNSUPPORTED_SOURCE`, per the plan.

Review follow-up: timer fallback now safely uses global timers when an injected clock only supplies `now`; WAV-derived metadata now preserves bit depth (`pcm_s8`, `pcm_s16le`, `pcm_s24le`, or `pcm_s32le`). Regression coverage was added for both cases.
