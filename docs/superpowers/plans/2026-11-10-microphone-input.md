# Standard microphone input stage

User authorization: continue the local rebuild without stopping after each subtask. Windows original-binary analysis remains deferred. Preserve previous WAV/demo input.

## Design

- Dashboard selects microphone mode and a device. Only Start requests microphone access. Device enumeration alone never opens capture.
- Renderer uses getUserMedia(audio only), AudioContext at preferred 16kHz (reports actual rate), and a local AudioWorklet. Worklet downmixes to mono signed16 little endian in 20ms blocks. Audio is not connected audibly to speakers.
- Main gives each acquisition an opaque captureId. Only Dashboard main-frame IPC can submit ready/chunk/failure for that ID. Binary packets are bounded to 16384 bytes, aligned, sequenced and checked against active state. Raw PCM never enters history or renderer events.
- Main sends microphone.start/stop controls only to Dashboard. Pause releases all MediaStream tracks and AudioContext; Resume uses a new acquisition ID. Stop, signout, window destruction/reload, errors and quit release capture. Late permission grants after cancellation must stop their returned tracks.
- Session permission request/check handlers deny camera and unrelated pages. Microphone is allowed only while an explicit capture request is outstanding/running for Dashboard.
- Audio remains an input stage; the current transcription sink is a labeled demo, not ASR. Do not claim live hardware tested from synthetic fixtures.

## Interfaces

Renderer `createMicrophoneCapture({bridge,mediaDevices,AudioContextClass,AudioWorkletNodeClass,workletUrl})`:
`start({captureId,deviceId})`, `pause()`, `resume({captureId,deviceId})`, `stop()`, `enumerateDevices()`, `getState()`.
The factory is on globalThis and exported via module.exports for Node tests. Production uses no Node APIs.

IPC via existing `bridge.invoke`:
- `audio.use-microphone`, `{}` selects mode.
- `audio.microphone-ready`, `{captureId,sampleRate,channels:1}` acknowledges acquired pipeline.
- `audio.microphone-chunk`, `{captureId,sequence,data:Uint8Array}` sends one block. Main returns `{ok:true,accepted:boolean}`; stale/paused streams return accepted:false.
- `audio.microphone-failed`, `{captureId,code}` reports one of PERMISSION_DENIED, DEVICE_NOT_FOUND, DEVICE_LOST, MICROPHONE_UNAVAILABLE, MICROPHONE_BACKPRESSURE; no arbitrary exception text.

Control events only to Dashboard:
- `microphone.start`, `{captureId}`
- `microphone.stop`, `{captureId}`

## Implementation and verification

1. Subagent: local PCM worklet + microphone controller and focused tests. Bounded queue (max4 waiting packets +1 in flight), generation cancellation, track ended errors, safe cleanup. No commits/push.
2. Primary: main-side microphone provider, schemas, permissions, lifecycle and UI controls with negative tests for stale IDs, invalid packet/state, source restrictions and resource release.
3. Integration: actual Electron with Chromium fake media device. Verify Start consumes PCM, Pause releases tracks and freezes counts, Resume reacquires, Stop releases, denied/camera/untrusted requests fail. Existing WAV smoke still passes.
4. Independent review; authoritative npm test/check/smoke; docs, commit and push to xh722/coding-help main with author email 19856850715@163.com. Check CI. Windows device-specific/native parity and ASR stay pending.
