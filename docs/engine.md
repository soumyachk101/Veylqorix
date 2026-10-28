# Veylqorix Security Engine (Rust)

The security-decision core of Veylqorix now has a Rust implementation:
`crates/veylqorix-engine`, a pure-Rust, dependency-light binary that speaks a
bounded JSON-over-stdio protocol. It is a standalone crate with its own test
suite. This page documents the crate, the protocol, and the security
properties, based on the committed source.

See also: the cross-cutting architecture and lifecycle diagrams live in
`Veylqorix_Diagrams/README.md` (the PNGs are the current record; the diagram
sources are not in the repo).

## Status (read this first)

- The engine crate, its protocol, and its CI steps **exist and are verified**
  (60/60 tests, `clippy -D warnings` clean, release binary at
  `crates/target/release/veylqorix-engine`).
- The engine is **wired into the application** through the TypeScript adapter
  `packages/core/src/engine/index.ts`. It is invoked by `runAudit`
  (`packages/core/src/audit.ts`), which the CLI, MCP server, and API all call.
  When the binary is available the engine is the authority for the secret
  scanner and the gate decision; when it is not (binary not built / not on
  `PATH`), `runAudit` degrades to the byte-compatible TypeScript secret
  scanner and policy engine and records an explicit
  "degraded compatibility mode" note on the secret scanner result so a full
  run is never impersonated. This degradation is honest and labeled, not a
  silent fallback.
- The adapter resolves the binary in this order: the `VEYLQORIX_ENGINE`
  environment variable (when set to an existing file), then
  `veylqorix-engine` on `PATH`, then documented install locations, then
  an upward walk from the working directory to a directory containing
  `crates/Cargo.toml` and the `crates/target/{release,debug}`
  `veylqorix-engine` binary (a fresh adapter is constructed per `runAudit`
  call so the environment variable is honored without any cross-call
  caching). See [Binary resolution order](#binary-resolution-order).
- Results the engine produces are **byte-compatible** with the TypeScript
  core: same stable finding ids (e.g. `SECRETS-8C5562BA` on
  `tests/fixtures/secret-repo/config.js`), same redaction format
  (`AKIA…CDEF (20 chars, redacted)`), and the same gate/exit-code mapping as
  `packages/core/src/gate/index.ts` and `packages/core/src/policy.ts` —
  cross-verified by the differential and parity test suites.

## Crate layout

`crates/veylqorix-engine/src/`:

| Module | Responsibility |
|---|---|
| `model.rs` | Normalized schema types (`Finding`, `ScannerResult`, `GateDecision`, `Policy`, …), `SCHEMA_VERSION = 1`. Shapes mirror `packages/core/src/types.ts` so findings from either side are interchangeable. |
| `policy.rs` | Deterministic policy resolution: defaults, field-level overrides, expiring/document-required exceptions, `maxExceptions` cap, derivation notes. Byte-compatible with `resolvePolicy` in `packages/core/src/policy.ts`. |
| `gate.rs` | Gate evaluation (`PASS`/`FAIL`/`INCOMPLETE`), blocking/incomplete reasons, coverage level, `exit_code_for` (0/1/2) and `strict_exit_code`. Byte-compatible with `packages/core/src/gate/index.ts`. |
| `secrets.rs` | Offline secret scanner: 9 rule families over 18 default extensions, tree walk (max depth 8, ignore set `node_modules`, `.git`, `__pycache__`, `venv`, `.venv`), binary/oversize file skip. Byte-compatible with `packages/core/src/scanners/secrets.ts`. |
| `redact.rs` | Single masking function `redact_secret`: values ≤ 8 chars become `****`; longer values keep first/last 4 characters plus a length annotation. Golden vectors match the TypeScript `redactSecret`. |
| `finding.rs` | `make_finding` + deterministic ids: SHA-1 over `scanner\|ruleId\|location\|dependencyName\|version`, first 8 hex chars uppercased, prefixed by the scanner name (uppercased, non-alphanumeric collapsed to `-`, truncated to 12 chars) — e.g. `SECRETS-8C5562BA`. Byte-compatible with `packages/core/src/finding.ts`. |
| `exec.rs` | Safe, shell-free subprocess execution: explicit argument arrays (never a shell), `which` pre-check, timeout with kill, bounded trailing output window (default 256 KB per stream, with a truncation marker). |
| `dependencies.rs` | `cargo audit -f <root>/Cargo.lock --json` for Rust ecosystems; normalized findings with advisory/affected/patched fields. |
| `protocol.rs` | The JSON-over-stdio protocol: request/response types, size caps, gitleaks delegation, command dispatch, `serve()` entry point. |
| `lib.rs` / `main.rs` | Crate facade (`PROTOCOL_VERSION = 1`, `ENGINE_VERSION`, `EngineError`) and the binary (one request line in, one response line out, `--version`/`-V` banner, `--help`). |

## What the engine owns vs. what the TypeScript core still owns

The engine owns:

- the offline **secret scan** (incl. optional delegation to `gitleaks` behind
  `preferGitleaks` — the built-in offline rule-set always runs as the
  authoritative, reproducible default),
- **`cargo audit`** for Rust projects behind `runCargoAudit`,
- **policy resolution** (defaults, overrides, expiring exceptions, caps),
- **gate evaluation** and the **exit-code mapping** (default 0/1/2 and the
  strict variant).

The TypeScript core (`packages/core`) still owns, today:

- the npm/pip **dependency subprocess** (`npm audit`, `pip-audit` via
  `util/exec.ts`), license scanning, and quality checks,
- reporting (JSON/Markdown/SARIF) and the API/MCP plumbing and dashboard,
- the **labeled fallback path**: when the engine binary cannot be resolved,
  `runAudit` degrades to the byte-compatible TypeScript secret scanner and
  policy engine and records an explicit "degraded compatibility mode" note on
  the secret scanner result (never a silent fallback).

The engine is invoked **per scan** by the TypeScript adapter in
`packages/core/src/engine/index.ts`: `runAudit`
(`packages/core/src/audit.ts`) hands the engine its own evidence
(dependency findings, license results, quality checks), the engine merges in
its own scanner results, evaluates the gate over the union, and returns the
decision. That keeps one gate authority per run.

## Policy resolution

Deterministic resolution is byte-compatible with `resolvePolicy` in
`packages/core/src/policy.ts`: defaults, field-level overrides,
expiring/document-required exceptions, and the `maxExceptions` cap. The
shipped sample default — `veylqorix-policy.json` at the repo root — blocks on
`CRITICAL`/`HIGH` severity, secrets, test failure, scanner error, and skipped
checks, and reports on `MEDIUM`/`LOW`, with `maxExceptions` 5. In a developer
checkout that file also doubles as Veylqorix's own repo policy: it is first in
the `POLICY_FILE_NAMES` auto-discovery order, so scanning the repo root applies
it.

## JSON-over-stdio protocol

One JSON document per message, one logical line each direction.
`PROTOCOL_VERSION = 1`, `SCHEMA_VERSION = 1`. Input is capped at 8 MiB
(`MAX_INPUT_BYTES`), output at 16 MiB (`MAX_OUTPUT_BYTES`); oversized or
malformed payloads are rejected, not processed.

### Request

```json
{"protocolVersion":1,"command":"ping"|"scan"|"evaluate","args":{ ... }}
```

`protocolVersion` is required and must equal `1` (unknown fields are
rejected). `scan` args are camelCase:

| Arg | Type | Notes |
|---|---|---|
| `root` | string | Audit root; required for `scan`. |
| `detection` | object | Orchestrator-side project detection, so the engine picks scanners without re-walking. |
| `policy` | object | Partial overrides on top of the engine defaults. |
| `stagedFiles` | string[] | Restrict the secret scan to exactly these root-relative files. |
| `strict` | boolean | When true, also return the strict exit-code mapping. |
| `findings` | Finding[] | Orchestrator findings (e.g. `npm audit`, licenses), merged into the gate. |
| `scannerResults` | ScannerResult[] | Completed orchestrator scanner results, merged into the gate. |
| `checks` | CheckResult[] | Completed quality-check results, merged into the gate. |
| `runSecrets` | boolean | Run the built-in secret scanner. |
| `preferGitleaks` | boolean | Delegate to `gitleaks` when installed (offline rules remain the fallback). |
| `runCargoAudit` | boolean | Run `cargo audit` for Rust projects. |
| `timeoutMs` | number | Per-tool timeout (default 120000). |
| `scanId` | string | Stable scan identifier stamped onto engine findings. |

### Response

```json
{"protocolVersion":1,"engineVersion":"0.1.0","schemaVersion":1,"ok":true,
 "gate":{...},"exitCode":0,"strictExitCode":null,
 "findings":[...],"engineScannerResults":[...],"notes":[...]}
```

`gate`, `exitCode`, `strictExitCode`, `findings`, and
`engineScannerResults` are present for `scan`/`evaluate` (omitted on
`ping`). The gate decision is **in the response**; the process exit code only
signals out-of-band protocol errors.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | A response document was written (the gate decision is in the response, not the exit code). |
| `64` | Malformed request / unsupported protocol version (incl. missing `root` on `scan`, oversize input). |
| `65` | Audit root missing / not a directory. |
| `70` | Engine internal error (incl. output exceeding the cap). |

A scanner being unavailable **inside** a `scan` never produces 64/65/70: it is
a `SKIPPED`/`ERROR` entry in `engineScannerResults` with an explanatory note,
so a failure can never be read as a pass. On a protocol error the engine
exits with that class's code, writes a short human-readable reason to stderr,
**and** writes a structured error frame to stdout (a response document with
`ok: false` and an `error` object) so the machine-readable reason does not
depend on parsing stderr.

## Binary resolution order

The adapter (`packages/core/src/engine/index.ts`, `resolveEngineBinary`)
locates the binary in this order:

1. `VEYLQORIX_ENGINE` — an explicit path from the environment, when it
   points at an existing file;
2. `veylqorix-engine` on `PATH` (platform-correct name);
3. documented install locations (per-user `~/.local/bin`,
   `~/.veylqorix/bin`, `/usr/local/bin`, `/usr/bin`; Windows
   equivalents);
4. an upward walk from the working directory (and from the package
   location, so the adapter also works when consumed from `dist/`) to a
   directory containing `crates/Cargo.toml`, then
   `crates/target/release/veylqorix-engine`, then
   `crates/target/debug/veylqorix-engine`.

Every candidate is stat-checked before it is used; no developer-local
path is ever assumed. When none exists, the adapter runs in a **labeled
degraded compatibility mode**: the in-process TypeScript secret scanner,
policy engine, and gate remain the fallback, and the secret scanner
result carries an explicit "degraded compatibility mode, engine binary
unavailable" note — never a silent pass. This keeps every outcome
attributable and audit-stable: a scan whose coverage degrades still
evaluates to `INCOMPLETE` (exit 2) rather than a clean pass.

Because the engine's findings, gate decisions, and exit codes are
byte-compatible with `packages/core` (see **Status** above), running the
labeled TypeScript fallback while the binary is missing is a genuine
compatibility guarantee, not a reduced-coverage shortcut: the same inputs
produce the same ids, redaction, and gate verdict in either
implementation.

The binary is also invoked directly by the Rust integration tests (via
`CARGO_BIN_EXE`) and by CI, which builds
`crates/target/release/veylqorix-engine` before the TypeScript suite
runs.

## Security properties

- **No shell.** Every subprocess (gitleaks, cargo) is spawned with an explicit
  argument array; untrusted data never reaches a command line. Missing tools
  are pre-checked and reported, not guessed.
- **Bounded I/O.** Request ≤ 8 MiB, response ≤ 16 MiB; child output retained
  as a trailing 256 KB window with a truncation marker; secret scans skip
  binary files and files over 2 million characters, and the tree walk is
  depth-capped at 8 with an ignore set.
- **Timeouts with SIGKILL.** Every external-tool run carries a timeout
  (default 120000 ms); on deadline the child is killed, the result carries
  `timed_out`, and the scanner is classified as an error state, never a pass.
- **Unavailable scanner is never a pass.** A missing tool, missing lockfile,
  or timed-out run becomes a `SKIPPED`/`ERROR` scanner result; the gate then
  degrades coverage to `INCOMPLETE` (exit 2) rather than reporting a clean
  pass.
- **Redaction.** Secret values are masked before they enter a finding:
  `≤8` chars → `****`; longer → `first4…last4 (N chars, redacted)`.
  Findings from delegated tools (gitleaks) are re-redacted on the way in.
- **Deterministic ids.** Finding ids derive only from stable inputs
  (scanner, rule, location, dependency, version) so identical findings across
  two runs produce the same id and reports diff cleanly.
- **Honest degraded compatibility mode.** When the engine binary is missing,
  the fallback is the TypeScript policy engine with a labeled note (above);
  the engine never reports a result it did not compute, and an `evaluate`
  command performs no filesystem access.

## External tools: gitleaks and cargo-audit

`gitleaks` and `cargo audit` are **external** binaries, not part of the
engine. The built-in **offline rule-set is the default** so results are
reproducible on any machine without network or extra tools. Gitleaks
delegation is **opt-in** via `preferGitleaks` and only adds findings on top of
the offline rules when the binary is on `PATH`; `cargo audit` is requested via
`runCargoAudit` for Rust ecosystems. Missing tools are reported `SKIPPED`
(with an install hint) and timeouts are reported `ERROR` — in both cases the
gate degrades coverage; it never silently passes.

## Build and test

All cargo commands target the workspace manifest at `crates/Cargo.toml`:

```
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

The suite is 60 tests: 31 unit tests across the source modules (gate, policy,
exec, redaction, dependencies, glob) and 29 integration tests — TypeScript
golden vectors, differential gate tests, secret-redaction parity tests,
protocol end-to-end tests that spawn the real binary over stdio, and
gated live-tool tests for the `cargo-audit` and `gitleaks` delegation
paths (they skip honestly when the tool is not installed). The release
build is `opt-level 3` with thin LTO, keeping the binary small enough for
per-scan spawning.

To sanity-check the binary:

```
./crates/target/release/veylqorix-engine -V
echo '{"protocolVersion":1,"command":"ping","args":{}}' | ./crates/target/release/veylqorix-engine
```

`-V` prints `veylqorix-engine 0.1.0 (protocol 1, schema 1)`.
