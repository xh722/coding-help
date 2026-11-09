# Task 5 report: Local API server

Status: complete

Implemented `services/local-api/server.cjs` with a loopback-only `http.createServer` API and in-memory state. It supports health, demo login, refresh, logout, bearer-protected user/session routes, session event append, structured JSON errors, opaque UUID tokens, and a 1 MiB JSON body limit. Authorization headers are only read for authentication and are never logged.

Added `tests/local-api.test.cjs`, an HTTP integration test using Node `fetch` against an ephemeral loopback port. The test covers rejected credentials, demo login, bearer enforcement, user lookup, session creation/listing, event append, refresh, and logout invalidation.

Validation:

- `node --test tests/local-api.test.cjs` passed.
- `npm test` passed: 17 tests.
- `npm run check` passed.

Concern: state is intentionally process-local and is lost when the server stops; this matches the local rebuild brief.

## Review fixes

Added regression coverage and fixes for oversized JSON bodies (structured 413 without destroying the request), malformed JSON, loopback host enforcement, access-token expiry based on the injected clock, refresh-token revocation on logout, and refresh-token replay rejection.

Validation after fixes:

- `node --test tests/local-api.test.cjs` passed: 3 tests.
- `npm test` passed: 19 tests.
- `npm run check` passed.
