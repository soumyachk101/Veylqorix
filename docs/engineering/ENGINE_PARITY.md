# Veylqorix Engine Parity

The security decision core has two implementations that must behave
equivalently:

- **Rust engine** — `crates/veylqorix-engine` (authoritative when available).
- **TypeScript core** — `packages/core` (`resolvePolicy` + `evaluateGate` +
  exit-code mapping; also the labeled fallback when the engine binary is
  unavailable).

The shared contract is pinned by one source of truth: the fixture files under
`tests/fixtures/*/fixture.json`, driven by:

- `tests/engine-differential.test.ts` — the TypeScript side runs
  **unconditionally**; the engine side runs through the real binary and is
  skipped (explicitly labeled) when the binary is not built.
- `crates/veylqorix-engine/tests/parity-fixtures.rs` — the same fixtures fed
  through `parse_request` + `execute` in-process; binary-level error-frame
  behavior is pinned separately in `protocol-e2e.rs`.
- `tests/engine-adapter.test.ts` — adapter behavior: binary discovery,
  error-frame parsing (stdout only, never stderr), degraded-run semantics.

## Behavior table

| Behavior | Rust (file:line) | TypeScript (file:line) | Covering tests | Status |
|---|---|---|---|---|
| Protocol versioning (reject versions not spoken) | `crates/veylqorix-engine/src/protocol.rs` `parse_request` + `exit::MALFORMED` (protocol.rs:175) | `PROTOCOL_VERSION` checked both directions — `packages/core/src/engine/index.ts:71` | `invalid-protocol-version` fixture: `engine-differential.test.ts` (protocol group), `parity-fixtures.rs::invalid_protocol_version_is_rejected_as_malformed`, `protocol-e2e.rs` | COVERED |
| Structured error frames on stdout (exit 64/65/70, `ok:false`, no gate) | `error_frame` (protocol.rs:663), `ErrorKind` (protocol.rs:184), codes 64/65/70 (protocol.rs:175–179) | Adapter reads frames from stdout only, raises `EngineProtocolError` with `exitCode` — `engine/index.ts:157` | `protocol-e2e.rs` (binary-level), `parity-fixtures.rs` (unit-level frame fields), `engine-differential.test.ts` malformed-findings / invalid-protocol-version / root-confinement (engine group) | COVERED |
| Soft exit-code mapping 0=PASS / 1=FAIL / 2=INCOMPLETE | `crates/veylqorix-engine/src/gate.rs` (`gate.rs:245` mapping, `gate.rs:261` coverage downgrade) | `exitCodeFor` — `packages/core/src/gate/index.ts:182` | `verdict-pass/fail/incomplete` fixtures in both test files; `gate.test.ts` | COVERED |
| Strict exit mapping (any blocking reason → 1; any completeness gap → 2) | `gate.rs:28` strict rules | `strictExitCode` — `packages/core/src/gate/index.ts:163` (mirrored locally in `engine-differential.test.ts` because the root barrel re-exports only `exitCodeFor`) | `verdict-incomplete` fixture (`strict: true` → soft 2 / strict 1) in both test files | COVERED |
| Degraded engine-absent run: labeled PASS for a clean repo (exit 0 + "Rust engine unavailable" note), INCOMPLETE for coverage-degrading gaps | n/a (engine is the authority) | `TS_COMPAT_NOTE` — `packages/core/src/audit.ts:77`, applied at `audit.ts:293` | `tests/engine-adapter.test.ts` ("degraded clean repo passes with the same exit-code semantics"), `tests/integration/audit.test.ts` | COVERED (TS-only by nature) |
| Unselected mandatory scanner → SKIPPED in gate input → INCOMPLETE, never PASS | `crates/veylqorix-engine/src/gate.rs` skipped-mandatory handling | `packages/core/src/audit.ts:165` mandatory-unselected SKIPPED recording | `tests/integration/audit.test.ts` (both engine and TS paths); `verdict-incomplete` fixture | COVERED |
| Malformed/shape-invalid scanner findings: TS downgrades/rejects per item; Rust rejects the whole request (exit 64) | strict serde enums + required `ruleId` in `protocol.rs` request model | `normalizeFindings` — `packages/core/src/scanners/registry.ts:97` (invalid severity downgraded to MEDIUM, missing ruleId rejected) | `malformed-findings` fixture in both test files (different tolerated shapes, same never-pass guarantee) | COVERED |
| Policy exceptions: expired / undocumented dropped with derivation note | `crates/veylqorix-engine/src/policy.rs:34` drop rules, `:84` notes | `resolvePolicy` — `packages/core/src/policy.ts:49` (same drop rules + notes) | `policy-with-expired-exception` fixture in both test files | COVERED |
| Secret redaction byte-compatibility | `crates/veylqorix-engine/src/redact.rs:15` `redact_secret` | `redactSecret` — `packages/core/src/scanners/secrets.ts:135` | `redaction-values` fixture (golden vectors) in both test files | COVERED |
| Scanner error / timeout / missing binary / unexpected exit | `crates/veylqorix-engine/src/exec.rs` process-group kill + bounded drain; scanner results carry `ERROR`/`SKIPPED` | `runScannerSafely` + `withTimeout` — `packages/core/src/scanners/registry.ts` | `scanner-missing-binary`, `scanner-timeout`, `scanner-unexpected-exit` fixtures (diff group, both sides) | COVERED |
| Root confinement on `scan` (missing root → exit 65, no gate) | `execute` in `protocol.rs` returns `RootNotFound` | Adapter surfaces `EngineProtocolError` (exit 65) — `engine/index.ts` | `root-confinement` fixture in both test files; `protocol-e2e.rs` binary-level | COVERED |
| Engine binary discovery (env → PATH → install locations → repo walk) | n/a | `resolveEngineBinary` — `packages/core/src/engine/index.ts:533` | `tests/engine-adapter.test.ts` discovery cases | TS-only |

## Honest statement

Parity claims in this repository are **only as strong as the tests listed
above**. The fixture-driven tests pin the shared decision core (verdicts,
exit codes, coverage, exception handling, redaction, malformed-input
rejection). Engine-side assertions run only when the engine binary is built
(`cargo build --manifest-path crates/Cargo.toml --workspace --release`);
when it is absent those tests are skipped with explicit labels and the
TypeScript side remains pinned on its own. Binary-absent / degraded behavior
is a TypeScript-only property and is tested as such. Cross-platform path
handling (Windows path names, `%LOCALAPPDATA%` install location) is by
construction but not exercised in CI here and is therefore marked UNVERIFIED.
Nothing in this document claims the two engines are byte-identical in
behavior beyond the listed behaviors.
