# Task 3 Report: Versioned storage and local auth

Status: complete

Implemented `packages/core/storage.cjs` with versioned JSON documents, atomic temporary-file writes followed by rename, password-field filtering, tolerant handling of missing/corrupt/unknown-version data, and clear support.

Implemented `packages/core/auth.cjs` with transport-delegated login and refresh, in-memory session snapshots, persistence, logout clearing, and transport error propagation.

Added focused tests covering login persistence and password exclusion, refresh replacement, logout, corrupt storage, version enforcement, and atomic storage shape.

Validation:

- `node --test tests/auth-storage.test.cjs` passed.
- `npm test` passed: 3 suites, 3 tests files, 0 failures.
- `npm run check` passed.

Commit: `bff9958cdb5b728333e4ac096475968bc4ce2e44` (`feat: add versioned local auth storage`)

Concerns: `clock` is accepted by the auth service for the planned interface but is not currently needed because token expiry is supplied by the transport. Unknown or malformed storage is treated as an empty session without rewriting the file.
