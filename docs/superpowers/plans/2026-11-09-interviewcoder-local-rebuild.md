# InterviewCoder 本地重建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个无需网络即可运行的 Electron 本地重建版本，覆盖登录、会话、悬浮面板、截图/录音抽象、转写事件、建议事件和本地记录。

**Architecture:** 使用 Node 内置 HTTP server、Node 内置 test runner 和无打包器的 HTML/CSS/JS renderer。`packages/core` 保存可在 Node 测试的状态机、认证、存储和 IPC 合约；`packages/providers` 提供确定性的本地 capture/transcription/suggestion provider；Electron main/preload 只负责窗口、权限和经过校验的桥接。

**Tech Stack:** Node.js 24、CommonJS、Electron 约 39.x、`node:test`、Node `http`/`fs`/`crypto`，不引入运行时 Web 框架。

**Spec:** `docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md`

## Global Constraints

- 不运行 `/home/fddm/下载/interviewcoder-setup.exe`、原版 Electron PE、`agent-windows.exe` 或 native DLL。
- 本地默认账户只用于离线开发：`local-dev@example.com` / `local-dev-password`；不得写入真实 token。
- Electron renderer 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 本地 API 只绑定 `127.0.0.1`；外部网络 provider 默认关闭。
- Overlay 保留隐私状态指示器，不实现伪装进程、反检测或认证绕过。
- 每个新增行为先写一个会失败的测试，再写最小实现。
- 不提交原始安装包、完整 ASAR、native/GStreamer 二进制、`node_modules` 或测试输出。

## Task 1: Node/Electron 工程基线

**Files:**
- Create: `package.json`
- Create: `.npmrc`
- Modify: `.gitignore`
- Create: `tests/project-layout.test.cjs`
- Create: `apps/desktop/renderer/.gitkeep`
- Create: `packages/core/.gitkeep`
- Create: `packages/providers/.gitkeep`
- Create: `services/local-api/.gitkeep`

**Interfaces:**
- Produces `npm test`, `npm run check`, `npm run start` 三个入口。
- `npm test` 使用 `node --test tests/**/*.test.cjs`。
- `npm run check` 对 `apps`, `packages`, `services`, `tests` 下的 `.cjs` 和 `.js` 执行 `node --check`。

- [ ] **Step 1: Write the failing layout test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('repository exposes the local rebuild entry points', () => {
  for (const relative of [
    'apps/desktop/main/index.cjs',
    'apps/desktop/preload/index.cjs',
    'services/local-api/server.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', relative)), true, relative);
  }
});
```

- [ ] **Step 2: Run the test to verify the scaffold is missing**

Run: `node --test tests/project-layout.test.cjs`
Expected: FAIL because the three application entry files do not exist.

- [ ] **Step 3: Add package metadata and scripts**

Use a private package with `main: "apps/desktop/main/index.cjs"`, `scripts.test`, `scripts.check`, and `scripts.start` set to `electron .`. Add Electron as a dev dependency without adding a production runtime framework.

- [ ] **Step 4: Add the empty entry files and directories**

Create the three entry files with a single strict-mode comment, then create the package directories and `.gitkeep` files.

- [ ] **Step 5: Run the baseline checks**

Run: `node --test tests/project-layout.test.cjs` and `npm run check`
Expected: PASS with zero failures and zero syntax errors.

- [ ] **Step 6: Commit**

```bash
git add package.json .npmrc .gitignore tests apps packages services
git commit -m "chore: scaffold local desktop rebuild"
```

## Task 2: Session state machine

**Files:**
- Create: `packages/core/session.cjs`
- Create: `tests/session.test.cjs`

**Interfaces:**
- `createSessionMachine({ idFactory, clock })` returns `getSnapshot()`, `start(metadata)`, `pause()`, `resume()`, `stop()`, `subscribe(listener)`.
- Snapshot shape: `{ id, state, metadata, startedAt, stoppedAt, events }`.
- Events are `{ type, timestamp, ...payload }` and are immutable copies.

- [ ] **Step 1: Write failing tests for legal transitions and idempotent stop**

```js
test('session transitions idle to active to paused to active to stopped', () => {
  const machine = createSessionMachine({ idFactory: () => 's-1', clock: () => 100 });
  assert.equal(machine.getSnapshot().state, 'idle');
  machine.start({ title: 'demo' });
  assert.equal(machine.getSnapshot().state, 'active');
  machine.pause();
  assert.equal(machine.getSnapshot().state, 'paused');
  machine.resume();
  assert.equal(machine.getSnapshot().state, 'active');
  machine.stop();
  machine.stop();
  assert.equal(machine.getSnapshot().state, 'stopped');
});

test('invalid transition reports a structured error and preserves state', () => {
  const machine = createSessionMachine({ idFactory: () => 's-1', clock: () => 100 });
  assert.throws(() => machine.pause(), /invalid transition/i);
  assert.equal(machine.getSnapshot().state, 'idle');
});
```

- [ ] **Step 2: Run the tests and confirm the expected missing-module failure**

Run: `node --test tests/session.test.cjs`
Expected: FAIL because `packages/core/session.cjs` is absent.

- [ ] **Step 3: Implement the transition table and event log**

Implement only the states from the spec. `stop()` from `stopped` is a no-op; all other invalid transitions throw `Error` with the current and requested operation. Copy metadata and event arrays on reads so callers cannot mutate internal state.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/session.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/session.cjs tests/session.test.cjs
git commit -m "feat: add session state machine"
```

## Task 3: Versioned storage and local auth

**Files:**
- Create: `packages/core/storage.cjs`
- Create: `packages/core/auth.cjs`
- Create: `tests/auth-storage.test.cjs`

**Interfaces:**
- `createJsonStore(filePath, { fs, version })` exposes `read()`, `write(value)`, `clear()`.
- `createAuthService({ transport, store, clock })` exposes `login`, `refresh`, `getSession`, `logout`.
- Stored document shape: `{ version: 1, session: LocalSession | null }`.

- [ ] **Step 1: Write failing tests for login, refresh and corrupt storage**

```js
test('auth login persists a session without exposing password', async () => {
  const service = createAuthService({ transport: demoTransport(), store: memoryStore(), clock: () => 1000 });
  const session = await service.login('local-dev@example.com', 'local-dev-password');
  assert.equal(session.user.email, 'local-dev@example.com');
  assert.equal(service.getSession().accessToken.startsWith('local-access-'), true);
  assert.equal(JSON.stringify(service.getSession()).includes('password'), false);
});

test('corrupt storage is reset to an empty session', () => {
  const store = memoryStore('{bad json');
  const service = createAuthService({ transport: demoTransport(), store, clock: () => 1000 });
  assert.equal(service.getSession(), null);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/auth-storage.test.cjs`
Expected: FAIL because storage/auth modules are absent.

- [ ] **Step 3: Implement atomic JSON storage**

Write to `<file>.tmp`, rename into place, enforce `version === 1`, and treat malformed/unknown versions as empty read-only state. Never serialize password fields.

- [ ] **Step 4: Implement demo auth transport and refresh handling**

The auth service delegates credential checks and token generation to `transport`; it only stores the returned session. `logout()` clears storage. `refresh()` replaces the full session and propagates transport errors.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/auth-storage.test.cjs`
Expected: PASS.

```bash
git add packages/core/storage.cjs packages/core/auth.cjs tests/auth-storage.test.cjs
git commit -m "feat: add versioned local auth storage"
```

## Task 4: IPC contract and validation

**Files:**
- Create: `packages/core/ipc.cjs`
- Create: `tests/ipc.test.cjs`

**Interfaces:**
- `COMMANDS` contains the twelve commands from the spec.
- `validateCommand(name, payload)` returns `{ ok: true, value }` or `{ ok: false, error }`.
- `createIpcRouter(handlers)` returns `dispatch(name, payload, context)` and rejects unknown commands.

- [ ] **Step 1: Write failing tests for allowlist and payload rejection**

```js
test('unknown commands are rejected', async () => {
  const router = createIpcRouter({});
  await assert.rejects(router.dispatch('shell.exec', {}), /unknown command/i);
});

test('session.start rejects missing metadata title', () => {
  assert.equal(validateCommand('session.start', {}).ok, false);
  assert.equal(validateCommand('session.start', { title: 'demo' }).ok, true);
});
```

- [ ] **Step 2: Run the tests and observe the missing-module failure**

Run: `node --test tests/ipc.test.cjs`
Expected: FAIL because `packages/core/ipc.cjs` is absent.

- [ ] **Step 3: Implement explicit schemas without external dependencies**

Validate primitive types and reject unknown top-level keys. Keep command schemas as data so the preload bridge and main handlers can share them.

- [ ] **Step 4: Implement dispatch with handler context**

`dispatch` validates before invoking a handler and passes `{ source, windowId }`. A handler error is returned as a structured error object; it must not expose token values or stack traces to renderer.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/ipc.test.cjs`
Expected: PASS.

```bash
git add packages/core/ipc.cjs tests/ipc.test.cjs
git commit -m "feat: add allowlisted IPC contract"
```

## Task 5: Local API server

**Files:**
- Create: `services/local-api/server.cjs`
- Create: `tests/local-api.test.cjs`

**Interfaces:**
- `createLocalApi({ host, port, clock })` returns `{ start(), stop(), address() }`.
- Routes: `GET /health`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /user`, `GET /sessions`, `POST /sessions`, `POST /sessions/:id/events`.
- JSON errors use `{ error: { code, message } }`.

- [ ] **Step 1: Write failing HTTP integration tests**

Test the demo login, bearer-protected `/user`, session creation, event append, and logout. Use Node `fetch` against the server's random loopback port.

- [ ] **Step 2: Run the tests and verify the absent server failure**

Run: `node --test tests/local-api.test.cjs`
Expected: FAIL because `services/local-api/server.cjs` is absent.

- [ ] **Step 3: Implement loopback HTTP server**

Use `http.createServer`, parse JSON bodies with a bounded size, generate opaque local tokens with `crypto.randomUUID()`, and keep data in memory for the process lifetime. Accept only the demo credentials and return 401 for all other credentials.

- [ ] **Step 4: Add bearer checks and session event storage**

Require `Authorization: Bearer <token>` on `/user`, `/sessions`, and event routes. Store only session metadata and events; never log authorization headers.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/local-api.test.cjs`
Expected: PASS.

```bash
git add services/local-api/server.cjs tests/local-api.test.cjs
git commit -m "feat: add loopback local API"
```

## Task 6: Deterministic providers

**Files:**
- Create: `packages/providers/transcription.cjs`
- Create: `packages/providers/suggestions.cjs`
- Create: `packages/providers/capture.cjs`
- Create: `tests/providers.test.cjs`

**Interfaces:**
- `createLocalTranscriptionProvider({ clock })` exposes `start({ emit })`, `pause()`, `resume()`, `stop()`.
- `createSuggestionProvider()` exposes `suggest(text)` and returns `{ text, source: 'local' }`.
- `createCaptureProvider({ screenshot })` exposes `getDisplays()` and `takeScreenshot(displayId)`.

- [ ] **Step 1: Write failing provider contract tests**

Assert that start emits a partial transcript followed by a final transcript, pause suppresses emissions, resume continues, stop is idempotent, and screenshot output is a PNG data URL from the injected function.

- [ ] **Step 2: Run the focused tests and confirm missing modules**

Run: `node --test tests/providers.test.cjs`
Expected: FAIL because provider modules are absent.

- [ ] **Step 3: Implement deterministic local providers**

Use a fixed sequence such as `"Local capture started"` and `"This is a deterministic transcript."`; schedule events with injected clock/timer functions so tests do not sleep. Suggestions should derive from the last final transcript and never call a network.

- [ ] **Step 4: Implement capture interface**

Keep display enumeration and screenshot acquisition injected. The test provider returns a 1x1 transparent PNG data URL; Electron main later supplies real `desktopCapturer` data.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/providers.test.cjs`
Expected: PASS.

```bash
git add packages/providers tests/providers.test.cjs
git commit -m "feat: add deterministic local providers"
```

## Task 7: Electron main process and preload bridge

**Files:**
- Modify: `apps/desktop/main/index.cjs`
- Modify: `apps/desktop/preload/index.cjs`
- Create: `tests/electron-contract.test.cjs`

**Interfaces:**
- `apps/desktop/main/index.cjs` exports `createAppDependencies` for Node tests and runs Electron only when executed by Electron.
- Preload exposes `window.localRebuild.invoke(command, payload)` and `window.localRebuild.onEvent(listener)`; it does not expose raw Electron objects.

- [ ] **Step 1: Write failing bridge contract tests**

Load the preload module with a fake `contextBridge`/`ipcRenderer` and assert only `invoke`, `onEvent`, and `removeEventListener` are exposed. Assert that a raw `send`, `require`, or `process` property is absent.

- [ ] **Step 2: Run tests and observe the expected bridge failure**

Run: `node --test tests/electron-contract.test.cjs`
Expected: FAIL because the preload bridge is still only the scaffold.

- [ ] **Step 3: Implement secure preload**

Use `contextBridge.exposeInMainWorld('localRebuild', { invoke, onEvent, removeEventListener })`; validate command names before `ipcRenderer.invoke` and strip event sender metadata before callbacks.

- [ ] **Step 4: Implement main dependencies and handlers**

Create the local API, auth service, session machine, providers, and IPC router. Create a Dashboard window and an Overlay window with `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, navigation blocking, and explicit close cleanup.

- [ ] **Step 5: Implement capture and overlay handlers**

`capture.get-displays` returns display ids/bounds. `capture.take-screenshot` uses `desktopCapturer` only when Electron is available and returns a structured unavailable error in headless tests. Overlay visibility and bounds are validated before mutation.

- [ ] **Step 6: Run contract and syntax checks**

Run: `node --test tests/electron-contract.test.cjs` and `npm run check`
Expected: PASS with no syntax errors.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/main/index.cjs apps/desktop/preload/index.cjs tests/electron-contract.test.cjs
 git commit -m "feat: add secure Electron main and preload"
```

## Task 8: Dashboard and Overlay renderer

**Files:**
- Create: `apps/desktop/renderer/index.html`
- Create: `apps/desktop/renderer/styles.css`
- Create: `apps/desktop/renderer/app.js`
- Create: `apps/desktop/renderer/overlay.html`
- Create: `apps/desktop/renderer/overlay.js`
- Create: `tests/renderer-static.test.cjs`

**Interfaces:**
- Renderer calls only `window.localRebuild.invoke` and subscribes to `window.localRebuild.onEvent`.
- Dashboard supports login, current session state, start/pause/resume/stop, screenshot, overlay toggle, transcript list and suggestion list.
- Overlay displays `LOCAL MODE`, recording state, latest transcript and latest suggestion.

- [ ] **Step 1: Write failing static renderer tests**

Assert both HTML files contain a CSP, load local scripts only, and `app.js` contains no `require(`, `ipcRenderer`, or `child_process` strings.

- [ ] **Step 2: Run tests and confirm missing renderer files**

Run: `node --test tests/renderer-static.test.cjs`
Expected: FAIL because renderer files are absent.

- [ ] **Step 3: Implement the dashboard layout and styles**

Use plain HTML/CSS with clear login, session controls, status badges, event list and error banner. Keep all copy local and label the app as `Local Rebuild`.

- [ ] **Step 4: Implement dashboard event wiring**

Call the allowlisted bridge methods, render returned snapshots, append transcript/suggestion events, and disable invalid controls based on the session state.

- [ ] **Step 5: Implement overlay view**

Read only serialized query data and bridge events. Show a visible privacy indicator and a close/hide button; do not implement transparent stealth or taskbar suppression.

- [ ] **Step 6: Run static renderer tests and commit**

Run: `node --test tests/renderer-static.test.cjs`
Expected: PASS.

```bash
git add apps/desktop/renderer tests/renderer-static.test.cjs
 git commit -m "feat: add dashboard and privacy overlay"
```

## Task 9: End-to-end local flow and documentation

**Files:**
- Create: `tests/local-flow.test.cjs`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md`
- Create: `docs/local-rebuild-usage.md`

**Interfaces:**
- End-to-end test starts the local API, logs in with the demo account, starts the session machine, consumes provider events, pauses/resumes, stops, and verifies persisted event order.
- Documentation lists install/start/test commands and the exact local account.

- [ ] **Step 1: Write the failing end-to-end test**

Compose the real local API, auth service, session machine and deterministic providers; assert the event sequence and final `stopped` snapshot.

- [ ] **Step 2: Run the end-to-end test and verify any integration gaps**

Run: `node --test tests/local-flow.test.cjs`
Expected: FAIL until all previous modules are wired together.

- [ ] **Step 3: Wire missing adapters without changing test expectations**

Use the public interfaces from Tasks 2–6; do not reach into private fields. Ensure provider stop and session stop can be called more than once.

- [ ] **Step 4: Add usage documentation**

Document `npm install`, `npm test`, `npm run check`, `npm run start`, the local credentials, offline behavior, and the fact that the original installer is never executed.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
npm test
npm run check
git diff --check
find . -type f -size +20M -not -path './node_modules/*' -not -path './.git/*' -print
```

Expected: all tests pass, syntax checks pass, diff check is clean, and the large-file command prints no paths.

- [ ] **Step 6: Commit**

```bash
git add tests/local-flow.test.cjs README.md docs/local-rebuild-usage.md docs/superpowers/specs/2026-11-09-interviewcoder-local-rebuild-design.md
git commit -m "test: verify local rebuild flow"
```

## Task 10: Final package verification and push

**Files:**
- Modify: `README.md` with final verification output summary.

- [ ] **Step 1: Run the complete test and syntax suite again on the final tree**

Run: `npm test && npm run check && git diff --check`
Expected: exit code 0.

- [ ] **Step 2: Inspect the final tracked file list**

Run: `git status --short --branch` and `git ls-files`
Expected: only source, tests, docs, evidence and small configuration files are tracked.

- [ ] **Step 3: Commit final verification notes**

```bash
git add README.md
git commit -m "docs: record local rebuild verification"
```

- [ ] **Step 4: Push and verify remote parity**

```bash
git push origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin refs/heads/main | awk '{print $1}')
test "$LOCAL" = "$REMOTE"
```

Expected: push succeeds and local/remote commit ids match.
