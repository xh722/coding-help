# Task 4 Report: IPC contract and validation

Implemented the allowlisted IPC contract in `packages/core/ipc.cjs` and added focused tests in `tests/ipc.test.cjs`.

The contract exposes all commands listed in the design, validates object payloads with explicit primitive schemas, rejects unknown top-level fields, and returns cloned validated values. `createIpcRouter` rejects unknown commands, validates before invoking handlers, passes `{ source, windowId }`, and converts handler exceptions into a generic structured error without stack traces or exception text.

Verification:

```text
node --test tests/ipc.test.cjs
1 test file passed; 5 assertions/tests passed; 0 failed
git diff --check
passed
```

Concerns: command payload schemas are intentionally minimal and should be extended only when downstream handler contracts are finalized. The design lists thirteen command names although the brief calls them twelve; all thirteen listed names are included.

## Review fix

Added the frozen `SCHEMAS` export, renderer context validation, structured `UNKNOWN_COMMAND` errors, and sanitization for handler-returned failures. Sensitive fields and messages containing token, password, secret, authorization, bearer, or stack data are replaced with the generic `Request failed` message.

Verification:

```text
node --test tests/ipc.test.cjs       passed
npm test                             4 test files passed
npm run check                        passed
```
