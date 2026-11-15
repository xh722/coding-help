# System Audio and Screen OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit shortcut-triggered full-screen OCR path and a user-started system-audio PCM path while preserving the repository's local-only, allowlisted IPC and bounded-resource guarantees.

**Architecture:** Reuse the existing Electron `desktopCapturer` screenshot source, AudioWorklet PCM framing, transcription provider, and loopback ASR lifecycle. Add independent screen-OCR and system-audio providers with injected process/media dependencies so contract tests do not require Tesseract, PipeWire, Windows, or physical devices. Register `CommandOrControl+Shift+O` at the main process, capture the primary display only, keep the PNG in memory, and emit only bounded OCR status/text.

**Tech Stack:** Electron 39, Node.js 24, CommonJS, Node built-in test runner, Web `getDisplayMedia`, AudioWorklet, optional local `tesseract` executable, existing Python loopback ASR.

**Spec:** `docs/superpowers/specs/2026-11-15-system-audio-screen-ocr-design.md`

## Global Constraints

- System audio starts only after an explicit Dashboard action and a trusted Dashboard main-frame permission request.
- The global OCR shortcut is `CommandOrControl+Shift+O`; it captures the primary display, never shows the PNG, and never persists it.
- OCR uses a fixed no-shell `tesseract` argv; renderer input cannot select executables, arguments, display crops, or file paths.
- Audio and OCR payloads are bounded; lifecycle events never contain raw PCM, PNG bytes, device names, commands, paths, or ASR response bodies.
- Missing platform capability, permission, OCR binary, or language pack returns a fixed unavailable result and never fabricated text.
- Do not run original binaries, add cloud APIs, add native agent files, or commit user audio/screenshots.
- Keep author identity `liuxu <19856850715@163.com>` and update README, audio guide, roadmap, and verification evidence.

### Task 1: Screen OCR provider contract

**Files:**
- Create: `packages/providers/screen-ocr.cjs`
- Test: `tests/screen-ocr.test.cjs`
- Modify: `package.json` only if a focused `test:screen-ocr` script is needed

**Interfaces:**
- `createScreenOcrProvider({ spawnImpl, timeoutMs = 3000, maxInputBytes = 8 * 1024 * 1024, maxOutputChars = 32768 })` returns `recognize({ png, language = 'chi_sim+eng' })`.
- `recognize()` resolves `{ ok: true, text, language, chars }` or `{ ok: false, code }` with codes `OCR_UNAVAILABLE`, `OCR_TIMEOUT`, and `OCR_INVALID_RESULT`.
- `spawnImpl` receives `('tesseract', ['stdin', 'stdout', '--psm', '6', '-l', language], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })` and is the only process boundary.

- [ ] **Step 1: Write failing provider tests** for successful bounded stdout, fixed argv/no shell, missing executable, non-zero exit, timeout, invalid language, empty PNG, input limit, output limit, and no stderr/path leakage.
- [ ] **Step 2: Run the focused test** with `node --test tests/screen-ocr.test.cjs`; verify it fails because the provider is absent.
- [ ] **Step 3: Implement the provider** with a single child process, bounded stdout accumulation, timeout cleanup, `stdin.end(png)`, and static error mapping. Trim text, count characters, and never expose stderr.
- [ ] **Step 4: Run `node --test tests/screen-ocr.test.cjs`** and verify all provider cases pass.
- [ ] **Step 5: Commit** with `git add packages/providers/screen-ocr.cjs tests/screen-ocr.test.cjs package.json && git commit -m "feat: add bounded screen OCR provider"`.

### Task 2: Screen OCR main handler and shortcut

**Files:**
- Modify: `apps/desktop/main/index.cjs`
- Modify: `apps/desktop/preload/index.cjs`
- Modify: `packages/core/ipc.cjs`
- Modify: `packages/providers/capture.cjs`
- Test: `tests/screen-ocr-electron.test.cjs`
- Test: `tests/ipc.test.cjs` or the existing Electron contract test file

**Interfaces:**
- Add the no-payload allowlisted command `capture.ocr-screen`.
- Add `runPrimaryScreenOcr()` to the main dependency wiring; it selects `screen.getPrimaryDisplay().id`, finds the matching `desktopCapturer` screen source, calls `source.thumbnail.toPNG()`, and passes the PNG to `screenOcr.recognize()`.
- Add `screen.ocr-status` events with `{ state: 'started'|'completed'|'unavailable'|'failed', chars?, language?, code? }`; never include PNG, screenshot data URLs, command paths, or stderr.

- [ ] **Step 1: Add failing IPC and main contract tests** for the no-payload schema, primary-display selection, missing source, missing `toPNG`, provider success, provider unavailable, and no `capture.ocr-status` payload leakage.
- [ ] **Step 2: Run the focused tests** and verify the new command/handler are missing.
- [ ] **Step 3: Implement `runPrimaryScreenOcr()`** using injected `screen`, `desktopCapturer`, and `screenOcr` dependencies. Keep the existing `capture.take-screenshot` preview path unchanged.
- [ ] **Step 4: Register `globalShortcut.register('CommandOrControl+Shift+O', handler)`** after the app is ready, have the handler check for an authenticated trusted Dashboard, invoke `runPrimaryScreenOcr()`, and emit a fixed `SCREEN_OCR_SHORTCUT_UNAVAILABLE` status when registration fails. Unregister on `will-quit` and window shutdown.
- [ ] **Step 5: Run the focused contract tests plus `npm run check`** and verify the shortcut lifecycle and IPC allowlist pass.
- [ ] **Step 6: Commit** with `git add apps/desktop/main/index.cjs apps/desktop/preload/index.cjs packages/core/ipc.cjs packages/providers/capture.cjs tests/screen-ocr-electron.test.cjs tests/ipc.test.cjs && git commit -m "feat: add primary screen OCR shortcut"`.

### Task 3: Screen OCR Dashboard surface

**Files:**
- Modify: `apps/desktop/renderer/index.html`
- Modify: `apps/desktop/renderer/app.js`
- Modify: `apps/desktop/renderer/styles.css`
- Test: `tests/renderer-static.test.cjs`

**Interfaces:**
- The Dashboard invokes `capture.ocr-screen` with `{}` and listens for `screen.ocr-status`.
- The UI shows shortcut registration state, OCR running/unavailable/error state, and returned text in a bounded text region; it never assigns a screenshot data URL for the OCR path.

- [ ] **Step 1: Add failing static renderer tests** for the `Recognize screen` button, shortcut status, OCR result region, and absence of an OCR screenshot image assignment.
- [ ] **Step 2: Run `node --test tests/renderer-static.test.cjs`** and verify the elements and handlers are absent.
- [ ] **Step 3: Add the button/status/result markup and restrained styles** without nesting a screenshot preview in the OCR result. Keep the existing `Take screenshot` preview separate.
- [ ] **Step 4: Wire the button and events** to the new no-payload IPC command, clear stale status on a new request, and display only the returned OCR text/status.
- [ ] **Step 5: Run the renderer static test and `npm run check`**.
- [ ] **Step 6: Commit** with `git add apps/desktop/renderer/index.html apps/desktop/renderer/app.js apps/desktop/renderer/styles.css tests/renderer-static.test.cjs && git commit -m "feat: add screen OCR dashboard action"`.

### Task 4: System audio provider and renderer capture

**Files:**
- Create: `packages/providers/system-audio.cjs`
- Test: `tests/system-audio.test.cjs`
- Create: `apps/desktop/renderer/system-audio.js`
- Test: `tests/system-audio-renderer.test.cjs`
- Reuse: `apps/desktop/renderer/pcm-worklet.js`

**Interfaces:**
- `createSystemAudioProvider({ sendControl, idFactory, clock })` returns `start({ onEvent, onChunk })`, `ready({ captureId, sampleRate, channels })`, `push({ captureId, sequence, data })`, `fail({ captureId, code })`, `pause()`, `resume()`, `stop()`, and `getState()`.
- `createSystemAudioCapture({ bridge, mediaDevices, AudioContextClass, AudioWorkletNodeClass, workletUrl })` calls `getDisplayMedia({ video: true, audio: { channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, stops every video track immediately, and sends only audio PCM through `audio.system-ready`, `audio.system-chunk`, and `audio.system-failed`.

- [ ] **Step 1: Add failing provider tests** for lifecycle, sequence validation, bounded queue, old capture IDs, track loss, idempotent stop, no raw PCM events, and pause/resume ID replacement.
- [ ] **Step 2: Run `node --test tests/system-audio.test.cjs`** and verify it fails before the provider exists.
- [ ] **Step 3: Implement the provider** by mirroring microphone state guarantees but using system-audio-specific IDs and static error codes.
- [ ] **Step 4: Add failing renderer tests** for `getDisplayMedia` constraints, immediate video-track stop, audio-only worklet flow, permission rejection, processor errors, track `ended`, queue overflow, pause, resume, and cleanup.
- [ ] **Step 5: Implement `system-audio.js`** by reusing the existing worklet and bounded pump logic; never expose the MediaStream or raw chunks to renderer events.
- [ ] **Step 6: Run both focused suites** and verify all system-audio lifecycle cases pass.
- [ ] **Step 7: Commit** with `git add packages/providers/system-audio.cjs tests/system-audio.test.cjs apps/desktop/renderer/system-audio.js tests/system-audio-renderer.test.cjs && git commit -m "feat: add system audio capture provider"`.

### Task 5: Main IPC wiring and permission boundary

**Files:**
- Modify: `packages/core/ipc.cjs`
- Modify: `apps/desktop/preload/index.cjs`
- Modify: `apps/desktop/main/media-permissions.cjs`
- Modify: `apps/desktop/main/index.cjs`
- Modify: `apps/desktop/renderer/app.js`
- Modify: `apps/desktop/renderer/index.html`
- Test: `tests/media-permissions.test.cjs`
- Test: `tests/desktop-system-audio.test.cjs`
- Test: `tests/ipc.test.cjs`

**Interfaces:**
- Add allowlisted commands `audio.use-system`, `audio.system-ready`, `audio.system-chunk`, and `audio.system-failed`; `audio.system-ready` accepts `captureId`, `sampleRate`, `channels`, `audio.system-chunk` accepts `captureId`, `sequence`, and bounded even-length PCM, and `audio.system-failed` accepts `captureId` and a static code.
- Main emits `system-audio.start` and `system-audio.stop` control events to Dashboard; renderer owns the actual `getDisplayMedia` call.
- Main forwards accepted system-audio chunks to `transcription.pushAudio`, shares session pause/resume/stop cleanup, and reports `source: 'system-audio'` through `audio.get-status`.

- [ ] **Step 1: Add failing IPC schema and permission tests** for valid/invalid payloads, Dashboard main-frame-only display capture permission, denied Overlay/subframe/foreign URL requests, and display-capture absence when no pending system-audio action exists.
- [ ] **Step 2: Run `node --test tests/ipc.test.cjs tests/media-permissions.test.cjs`** and verify the new commands and permission behavior fail.
- [ ] **Step 3: Implement schemas, preload validation, and a pending system-audio permission flag** that is set only by `audio.use-system` and cleared after grant, denial, timeout, or cleanup.
- [ ] **Step 4: Wire main session lifecycle** so start/pause/resume/stop are idempotent across microphone, file, demo, and system-audio sources; stale system capture IDs are ignored.
- [ ] **Step 5: Wire Dashboard controls** so `Use system audio` is disabled during active/paused sessions, starts the renderer capture only after `system-audio.start`, and renders fixed failure messages.
- [ ] **Step 6: Run the focused IPC, permission, and desktop tests plus `npm run check`**.
- [ ] **Step 7: Commit** with `git add packages/core/ipc.cjs apps/desktop/preload/index.cjs apps/desktop/main/media-permissions.cjs apps/desktop/main/index.cjs apps/desktop/renderer/app.js apps/desktop/renderer/index.html tests/media-permissions.test.cjs tests/desktop-system-audio.test.cjs tests/ipc.test.cjs && git commit -m "feat: wire system audio through trusted IPC"`.

### Task 6: Documentation, reports, and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/audio-input.md`
- Modify: `docs/ROADMAP.md`
- Create: `reports/system-audio-screen-ocr-verification-2026-11-15.md`
- Modify: `package.json` for focused scripts if needed

**Interfaces:**
- Documentation must state that the shortcut captures the primary display invisibly, OCR is local and on demand, system audio is user-triggered, and platform hardware support remains environment-dependent.
- The report records automated test counts, OCR unavailable behavior in this host, system-audio preflight result, and any real-platform result without storing screenshots/audio.

- [ ] **Step 1: Add documentation assertions or focused static checks** for the shortcut, invisible full-screen capture, system-audio permission boundary, and unavailable statuses.
- [ ] **Step 2: Update README, audio guide, and roadmap** with the actual commands and explicit platform limits; do not mark hardware or Windows dynamic behavior complete without evidence.
- [ ] **Step 3: Run the complete verification set:**
  ```bash
  npm test
  npm run check
  python3 -m unittest tests/local_asr_server_test.py tests/asr_runtime_preflight_test.py tests/asr_runtime_doctor_test.py tests/asr_runtime_smoke_test.py tests/asr_quality_test.py tests/audio_hardware_preflight_test.py
  git diff --check
  npm run build:linux
  npm run check:linux-bundle
  npm run sbom
  npm run build:deb
  npm run check:deb
  ```
- [ ] **Step 4: Run `audio:preflight` and the screen-OCR local preflight**; record fixed `OCR_UNAVAILABLE`/`SYSTEM_AUDIO_UNAVAILABLE` if this host lacks the optional engines/devices.
- [ ] **Step 5: Commit** with `git add README.md docs/audio-input.md docs/ROADMAP.md reports/system-audio-screen-ocr-verification-2026-11-15.md package.json && git commit -m "docs: record system audio and screen OCR verification"`.
- [ ] **Step 6: Push `main`, verify `git ls-remote`, and wait for the GitHub Actions run to complete successfully.**

## Self-Review Checklist

- The shortcut path and Dashboard button share one primary-display OCR handler, so the screenshot cannot be shown accidentally.
- OCR and system-audio providers are independently injectable and testable without optional binaries or hardware.
- All new renderer-to-main inputs have explicit schemas and bounded PCM/text/image limits.
- Permission checks distinguish screenshot preview from display-media audio capture and require a user action.
- The plan leaves real PipeWire/Windows/macOS capture and OCR accuracy as evidence-gated validation rather than claiming them from fakes.
