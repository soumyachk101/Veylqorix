---
title: "Veylqorix — Master Technical Document"
subtitle: "Architecture, internals, security model, developer workflow, operations, and release guide"
author: "Veylqorix Engineering Documentation"
date: "2026-10-29"
---

# Veylqorix — Master Technical Document

**Tagline:** *No Unsafe Code Gets Through.*  
**Repository:** <https://github.com/soumyachk101/Veylqorix>  
**License:** MIT (as declared by the root README and package manifests)  
**Documentation snapshot:** 29 October 2026, based on the public repository files and available GitHub Actions history checked while preparing this document.

> **Purpose.** This is the source-oriented master guide for understanding how Veylqorix is structured, how a scan becomes a gate decision, how each integration surface reaches the shared engine, how to run and debug the project, and what still needs owner action before production use or npm publication. It explains both implementation and operational boundaries. It is not a claim that the system detects every vulnerability.

## How to use this guide

- Start with **System overview** and **End-to-end scan lifecycle** to understand the whole system.
- Use **Repository map** and **Component deep dives** when reading code.
- Use **Policy and gate semantics** when changing thresholds or interpreting exit codes.
- Use **Integration surfaces** for CLI, MCP, plugin, API/dashboard, GitHub Actions, and agent skills.
- Use **Operations, validation, and release** before deploying, debugging, or publishing.
- Complete the checklists at the end before calling a deployment or release ready.

## Accuracy and evidence labels

- **Implemented in source:** described by current repository code/docs inspected for this guide.
- **Verified in recorded CI:** explicitly reported by a GitHub Actions run or engineering report; this is not the same as a fresh local execution performed during this document's creation.
- **Owner action:** requires access to npm/GitHub settings or a deliberate external action.
- **Limitation / not implemented:** documented constraint or capability not confirmed in current source.
- **Recommendation:** an improvement suggested for future work, not represented as already shipped.

---

# Contents

1. [Executive overview](#1-executive-overview)
2. [System architecture](#2-system-architecture)
3. [End-to-end scan lifecycle](#3-end-to-end-scan-lifecycle)
4. [Repository map and key files](#4-repository-map-and-key-files)
5. [Shared data model](#5-shared-data-model-how-the-evidence-is-represented)
6. [Core orchestrator and scanner subsystem](#6-core-orchestrator-and-scanner-subsystem)
7. [Rust engine and TypeScript adapter](#7-rust-engine-and-typescript-adapter)
8. [Policy, exceptions, and gate semantics](#8-policy-exceptions-and-gate-semantics)
9. [Reports and finding presentation](#9-reports-and-finding-presentation)
10. [CLI and local developer workflow](#10-cli-and-local-developer-workflow)
11. [MCP server and agent integration](#11-mcp-server-and-agent-integration)
12. [Plugin SDK](#12-plugin-sdk)
13. [REST API, persistence, and dashboard](#13-rest-api-persistence-and-dashboard)
14. [GitHub Actions and CI enforcement](#14-github-actions-and-ci-enforcement)
15. [npm packages and release process](#15-npm-packages-and-release-process)
16. [Security model and trust boundaries](#16-security-model-and-trust-boundaries)
17. [Testing strategy and recommended regression matrix](#17-testing-strategy-and-recommended-regression-matrix)
18. [Development setup and common workflows](#18-development-setup-and-common-workflows)
19. [Operational troubleshooting](#19-operational-troubleshooting)
20. [Architecture figures](#20-architecture-figures-and-their-interpretation)
21. [Source-of-truth links](#21-source-of-truth-links)
22. [Final readiness checklists](#22-final-readiness-checklists)
23. [Glossary](#glossary)

---

# 1. Executive overview

Veylqorix is a code-security and quality-gate platform built as a TypeScript/pnpm monorepo with a standalone Rust security engine. It coordinates real scanner tools, converts their results into a consistent finding model, applies a deterministic policy, and exposes the outcome through several surfaces: a command-line interface, Model Context Protocol (MCP) server, REST API and dashboard, reusable GitHub Actions gate, plugin SDK, and portable agent skills.

The central design choice is **deterministic-first security enforcement**. Scanners provide evidence; policy code decides whether evidence blocks the gate. The gate must distinguish a clean and complete scan from a scan that did not finish. A skipped or failed mandatory scanner is a coverage gap, not proof of safety.

The documented gate results are:

| Result | Meaning | Normal scan exit code |
|---|---|---:|
| `PASS` | Required checks completed, and no applicable blocking rule fired. | `0` |
| `FAIL` | Blocking finding or configured hard-failure condition exists. | `1` |
| `INCOMPLETE` | The run cannot support a full-confidence verdict because required evidence is missing or degraded. | `2` |

Other command/engine errors may use `64` for usage or malformed input, `65` for an invalid/missing root or input path, and `70` for an unexpected/internal error. Those are not normal gate verdicts.

## What the system currently claims—and does not claim

**It does:** detect project metadata; run configured dependency, secret, license, and quality checks; normalize findings; redact known secret patterns; evaluate documented policies and expiring exceptions; create JSON/Markdown/SARIF reports; return stable gate and exit-code semantics; and expose scan results to supported integrations.

**It does not:** prove that a repository contains no vulnerabilities; guarantee that regex-based secret detection has no false positives or false negatives; perform a full transitive license analysis merely because manifest-level license checks exist; automatically bundle or download the Rust native engine in the npm CLI package; automatically enforce GitHub merge protection just because a workflow exists; or make the API's JSON file store multi-process safe.

## The core mental model

1. **Inputs are scoped.** The caller selects a repository root or staged-file subset; the MCP/API surfaces add their own path-confinement controls.
2. **Project detection informs scanner selection.** Manifests, lockfiles, languages, and Git context determine which tools apply.
3. **Scanners return evidence and status.** Each result includes a scanner identity, status, findings, duration, and notes/errors as applicable.
4. **Evidence is normalized.** Findings get a predictable schema and stable identifiers.
5. **Policy resolves deterministically.** Defaults are combined with caller overrides; expired or undocumented exceptions are not active.
6. **The gate evaluates the whole run.** A blocking result and a coverage gap are treated differently.
7. **Every surface renders or transports the same decision.** CLI, API, MCP, SARIF, and GitHub gate should not each invent their own security rules.
8. **Fixes are verified by rescanning.** A proposal is not proof of remediation; the next scan determines whether the finding persists.

---

# 2. System architecture

![veylqorix system architecture](veylqorix_doc_assets/01_system_architecture.png)

*Figure 1. System architecture. The diagram is a high-level conceptual map; module-level behavior is described below from the repository sources.*

## 2.1 Architectural layers

### A. Entry points

Entry points are the ways a human, CI system, or coding agent starts work:

- **CLI** — commands such as `scan`, `check`, `report`, `config validate`, and `hooks`.
- **Git hooks** — optional pre-commit/pre-push local convenience for faster feedback.
- **Reusable GitHub Actions gate** — invoked from a calling repository's workflow.
- **MCP server** — makes scan capabilities available as validated structured tools to MCP-compatible agents.
- **REST API and dashboard** — registers repositories, starts scans, polls results, and presents scan history.
- **Agent skills** — portable instructions and ready-to-use MCP configuration examples.
- **Plugin SDK** — supplies additional scanners and quality checks to the same audit pipeline where a host uses the SDK.

These are adapters, not independent policy engines. Their purpose is to translate entry-point-specific inputs and outputs into the common core.

### B. Integration layer

The integration layer handles transport and safety at boundaries:

- CLI argument parsing and exit codes.
- MCP input schemas, configured workspace roots, response caps, and response redaction.
- API routing, authentication, request limits, root allowlists, and persistence.
- GitHub Actions artifact and SARIF upload steps.
- Plugin definition validation and safe subprocess execution context.

This layer should validate caller input and enforce the controls appropriate to its transport, but it should not duplicate policy semantics.

### C. Shared TypeScript core

The core is under `packages/core/src/`. Important responsibilities include:

- `detect.ts` — project/ecosystem detection.
- `audit.ts` — scan orchestration and result assembly.
- `scanners/registry.ts` — safe scanner wrappers, timeouts, and finding normalization.
- `scanners/dependencies.ts` — dependency tool adapters.
- `scanners/secrets.ts` — built-in secret-pattern detection.
- `scanners/licenses.ts` — manifest-level license checks.
- `scanners/quality.ts` — applicable lint, type, build, or test checks.
- `policy.ts` — defaults, override merge, exception validation and ordering helpers.
- `gate/index.ts` — deterministic decision and exit-code mapping.
- `finding.ts` — normalized stable finding construction.
- `report/` — output rendering, including SARIF.
- `engine/index.ts` — process adapter for the Rust engine.
- `util/` — path handling, subprocess helpers, Git helpers, hooks, and support types.

The core is the primary TypeScript orchestration library. The CLI, MCP server, plugin SDK, and API import it rather than reimplementing the gate.

### D. Rust security engine

The standalone Rust workspace is rooted at `crates/Cargo.toml`, with the binary crate in `crates/veylqorix-engine/`. The engine implements normalized model types, secret scanning, policy resolution, gate evaluation, redaction, finding IDs, bounded JSON-over-stdio communication, and selected external-tool execution such as Rust dependency audit support.

When the binary is available, it is the authority for the secret scanner and gate decision for that run. The TypeScript core gathers relevant evidence such as dependency/license findings and quality-check results, then passes those results and the resolved policy to the Rust engine. When the binary is unavailable, the TypeScript-compatible fallback is explicitly labeled as degraded compatibility mode; it is not silently presented as the native-engine path.

### E. Results and enforcement surfaces

Results are exposed through:

- Stable exit codes for shell/CI callers.
- JSON and Markdown reports for tools and people.
- SARIF 2.1.0 for GitHub code scanning integration.
- API scan state/history and dashboard findings.
- Structured MCP responses.
- Auditable policy notes and applied-exception records.

**Important:** generating a red CI check is different from blocking a merge. Branch protection or a ruleset must explicitly require the relevant status check.

---

# 3. End-to-end scan lifecycle

![Veylqorix security scan lifecycle](veylqorix_doc_assets/02_scan_lifecycle.png)

*Figure 2. From code change to evidence-backed decision and rescan verification.*

## Step 1 — Accept and validate the target

The caller supplies a project root. Some paths are constrained further: MCP roots are canonicalized against configured workspace roots; API paths can be restricted by `VEYLQORIX_ALLOWED_ROOTS`; the core also exposes path-validation utilities. The scan should not run on a guessed path or a path outside the caller's permitted area.

CLI examples:

```bash
node apps/cli/dist/index.js scan --root . --json
node apps/cli/dist/index.js scan --root . --staged --json
```

`--staged` restricts the secret scan to root-relative staged files. That is useful for a local pre-commit check, but it is not identical to a full repository scan: it covers a smaller scope by design.

## Step 2 — Detect the project

`detectProject` collects the evidence needed to choose appropriate scanner behavior, including:

- Ecosystem (for example Node, Python, Go, Rust, Java, Ruby, PHP, .NET, or unknown).
- Package manager inferred from manifests/lockfiles when possible.
- Manifest and lockfile paths relative to the root.
- Whether the workspace is inside a Git repository.
- Detected languages and reasons behind the classification.

Detection is input to scanner selection. It is not a security verdict by itself.

## Step 3 — Resolve the policy

The effective policy is created by merging caller-supplied partial policy values over defaults. `undefined`/missing override fields should not erase defaults. Exceptions require a non-empty reason and are ignored when expired. Active exceptions are capped at `maxExceptions`; the shipped sample policy uses a cap of five.

The resolved policy and explanatory notes become part of the audit result and are passed to the gate engine.

## Step 4 — Run applicable scanners and checks

Scanner calls are wrapped by `runScannerSafely` and a timeout helper. A thrown exception or timeout is converted into an explicit scanner `ERROR` result rather than taking down the complete audit without a result. Network-dependent tools can be disabled with offline mode; their absence or skip must be represented as reduced evidence.

The exact set of checks depends on the detected project and the available tools. Do not infer that a scanner ran merely because it appears in the architecture diagram; inspect the individual `ScannerResult` status in the report.

## Step 5 — Normalize findings

The normalization path validates raw scanner output. A valid finding contains a non-empty title and rule ID; severity and confidence are constrained to known values (invalid severity/confidence inputs are replaced by defaults in the normalizer, while malformed entries are rejected). `makeFinding` creates stable IDs from scanner/rule/location/dependency identity and output-safe fields are retained in the finding schema.

A finding typically contains:

- `id`, `title`, `scanner`, `ruleId`.
- `severity` and `confidence`.
- Optional file/line/column location.
- Optional dependency name and installed/declared/fixed versions.
- Optional redacted evidence, structured details, advisory reference, remediation, and `secret` flag.

## Step 6 — Evaluate the quality gate

The gate receives normalized findings, check results, scanner statuses, and the resolved policy. It applies exceptions, identifies blocking findings, collects failed/error checks and scanner states, calculates coverage, and chooses `PASS`, `FAIL`, or `INCOMPLETE`.

The gate must not infer a pass just because the finding array is empty. Empty findings can mean “no issue found,” but can also mean “scanner did not run”; the status and coverage fields disambiguate those outcomes.

## Step 7 — Render reports and persist where configured

The CLI writes to stdout or explicit report paths. The core can render JSON, Markdown, and SARIF. The API stores repository registrations and scan records in its JSON store. The reusable workflow uploads scan artifacts; SARIF upload is validated before transmission when the relevant path is used.

Secrets should be redacted before they reach reports, API responses, or agent clients. Redaction is defense in depth, not proof that every unknown credential format is detected.

## Step 8 — Remediate and verify

A developer or agent makes a targeted change, then reruns the scan. The previous finding is considered resolved only when the next scan no longer reproduces it under the same relevant scope and the run has adequate coverage. A scan that is `INCOMPLETE` is not a substitute for a successful verification scan.

---

# 4. Repository map and key files

The repository is a pnpm workspace with TypeScript packages/apps and a Rust workspace. The exact set of files evolves; use the branch contents as the source of truth.

| Path | Responsibility | Why it matters |
|---|---|---|
| `package.json` | Root scripts and `packageManager` pin | Establishes the intended pnpm version and common developer commands. |
| `pnpm-workspace.yaml` | Workspace packages, allowed build scripts, dependency overrides | pnpm 11 reads workspace-level configuration from here. |
| `pnpm-lock.yaml` | Reproducible JavaScript dependency graph | CI uses frozen-lockfile installation; do not bypass mismatch errors. |
| `packages/core/` | Shared TypeScript audit engine | Common orchestration, scanners, policy, gate, reports, types. |
| `apps/cli/` | `veylqorix` command-line entry point | Human/CI local interface and CLI exit codes. |
| `packages/mcp-server/` | MCP server | Structured security tools for compatible agent clients. |
| `packages/plugin/` | Scanner/check extension SDK | Additive evidence extensions without replacing the gate. |
| `packages/skills/` | Agent instructions/config examples | Helps agent clients use the security workflow. |
| `packages/api/` | REST API and JSON store | Repository registration, scan lifecycle, history, reports. |
| `apps/web/` | Next.js landing/dashboard UI | Human-facing dashboard and docs/marketing pages. |
| `crates/Cargo.toml` | Rust workspace root | Correct manifest path for Cargo commands. |
| `crates/veylqorix-engine/` | Rust engine crate | Native implementation for policy/gate and secret scanning. |
| `.github/workflows/ci.yml` | Continuous integration | Build/test/typecheck/lint and Rust validation. |
| `.github/workflows/veylqorix-gate.yml` | Reusable scanning gate | CI scanning, report artifacts, SARIF upload. |
| `.github/workflows/release.yml` | npm release pipeline | Tag-based build/pack and OIDC publishing. |
| `veylqorix-policy.json` | Example/default repository policy | Shows a committed, inspectable policy configuration. |
| `docs/engine.md` | Rust engine details/protocol | Native engine responsibility and binary discovery. |
| `docs/cli.md` | CLI usage | CLI commands, flags, exit codes and install caveats. |
| `docs/mcp.md` | MCP setup and safety | Tool definitions, configured roots, redaction, limits. |
| `docs/plugin.md` | Plugin SDK | Extension APIs and constraints. |
| `docs/api.md` | API contract | Endpoints, auth, CORS, limits, result schemas. |
| `docs/dashboard.md` | Dashboard instructions | UI launch/use. |
| `docs/github-actions.md` | Reusable gate integration | Status mapping, SARIF, branch-protection caveat. |
| `docs/engineering/SECURITY_HARDENING.md` | Security operations | Security configuration and threat controls. |
| `docs/engineering/STORAGE_AND_OPERATIONS.md` | API persistence limits | Durability/recovery/retention and scaling limits. |
| `docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md` | npm setup guide | Bootstrap version, per-package publisher records, owner actions. |

## Package identity and workspace notes

- Root `package.json` declares the monorepo private and pins `pnpm@11.9.0`.
- Workspace patterns include `apps/*` and `packages/*`; Rust code is managed separately by Cargo under `crates/`.
- The core and CLI manifests in the inspected source declare `@veylqorix/core` and `@veylqorix/cli`, public package access settings, and version `0.1.0` in the files read for the release audit.
- **Documentation discrepancy to verify:** the root README excerpt describes CLI v0.1.1 while the inspected `apps/cli/package.json` declared v0.1.0. For packaging, the committed package manifest at the exact release commit is authoritative, not a hard-coded README badge or prose. Resolve this before a future release.

---

# 5. Shared data model: how the evidence is represented

The shared schema lives in `packages/core/src/types.ts`. It is the contract between scanners, the gate, reports, API, and MCP response adapters.

## 5.1 Severity and confidence

Severity values, ordered from least to most severe:

`INFO < LOW < MEDIUM < HIGH < CRITICAL`

Confidence values:

`LOW < MEDIUM < HIGH < CONFIRMED`

Severity answers “how bad is this issue if real?” Confidence answers “how strong is the evidence that the finding is real?” They should not be treated as the same dimension.

## 5.2 Scanner status

A single scanner may return:

- `PASS` — completed without producing a blocking failure in its own semantics.
- `FAIL` — the scanner completed and reported a failure condition.
- `SKIPPED` — the scanner did not run; the note should explain why.
- `ERROR` — execution failed or timed out.

An empty finding list alone does not define `PASS`. Check status and run coverage.

## 5.3 Audit result

The top-level `AuditResult` includes the absolute root, start timestamp, duration, project detection, scanner results, combined findings, quality checks, gate decision, coverage, and the resolved policy. The `AuditResultWithExit` returned by the core API adds the process exit code and may retain the soft/default code for comparison when strict mode is enabled.

## 5.4 Provenance: what exists and what is not confirmed

Each `Finding` records its scanner name and scanner-specific `ruleId`, alongside evidence and remediation where available. The audit result records the effective policy, while the gate records applied exceptions and their suppression counts.

**Do not assume that every proposed provenance feature already exists.** The schema inspected for this guide does not show a dedicated per-finding `ruleVersion` field or a first-class flag distinguishing “deterministic scanner evidence” from “LLM hypothesis.” Veylqorix's documented core is deterministic-first; agent integrations are separate surfaces. If per-finding rule-version provenance or a dedicated model-hypothesis classification is required, track it as an explicit schema/reporting enhancement rather than presenting it as already implemented.

---

# 6. Core orchestrator and scanner subsystem

## 6.1 `runAudit` orchestration

`packages/core/src/audit.ts` is the main integration point. It accepts audit options such as root, online/offline mode, scanner timeout, optional quality checks, selected/skipped scanners, staged files, strict mode, optional Gitleaks preference, policy overrides, external scanners/checks, and a stable scan ID.

At a high level it:

1. Records the start time and resolves the target root.
2. Detects project metadata.
3. Resolves the policy from defaults and caller overrides.
4. Runs dependency/license and other TypeScript-side scanners under safe wrappers.
5. Runs applicable quality checks unless disabled.
6. Sends gathered evidence and the effective policy to the Rust engine when available.
7. Uses the labeled TypeScript compatibility path when the Rust engine is not available.
8. Assembles findings, scanner results, checks, gate, coverage, policy, timing and exit code into a stable result.

The Rust engine is not an unrelated second product; the adapter is part of the core path and is invoked from the audit orchestrator.

## 6.2 Project detection

The detection object retains the ecosystem, package manager if inferred, relative manifest/lockfile paths, Git repository presence, languages, and human-readable detection reasons. Keeping the reasons is useful for debugging wrong scanner selection: a user can see which manifest/lockfile drove the decision instead of treating project classification as magic.

## 6.3 Dependency scanner

The TypeScript dependency adapter can use `npm audit` for Node projects and `pip-audit` for Python projects. Rust dependency advisories are supported through `cargo audit` in the Rust engine when the relevant path is applicable and the tool is available.

Operational realities:

- Dependency scanning often requires network/advisory database access.
- Offline mode deliberately skips network-dependent checks; it does not mean “dependency-safe.”
- A missing tool, missing lockfile, timeout, or unavailable advisory database should remain visible in the result and can degrade coverage.
- Dependency findings can carry installed/declared/fixed version metadata and an advisory reference where the tool provides it.

## 6.4 Secret scanner

The core contains a built-in offline rule set and the Rust engine implements the corresponding authoritative secret scanning behavior. The Rust docs describe nine rule families over common file extensions, a bounded directory walk, ignored directories such as `node_modules` and `.git`, and binary/oversized-file skipping. Optional Gitleaks delegation can add findings when configured/available; it does not replace the deterministic built-in rule set.

Secret-handling properties:

- Findings are expected to contain redacted snippets rather than raw credential values.
- The MCP server adds a second redaction pass over structured results, free text, notes, output and error messages.
- Redaction patterns are not universal credential recognition. Unknown formats can escape detection or redaction; never use a clean scan as proof of absence.
- If a real credential is exposed, rotate/revoke it; deleting the text from the current file is not enough if it remains valid or exists in Git history.

## 6.5 License scanner

License checks are manifest-level in the described implementation. They are useful for surfacing declared licenses and obvious policy issues, but they should not be described as a complete transitive dependency-license audit unless a dedicated transitive analysis is implemented and verified.

## 6.6 Quality checks

The quality layer discovers applicable project checks—such as type checking, linting, build, or tests—based on the repository's configuration. Results retain a stable check ID, command, status, duration, output when safe/available, and failure reason/error.

`--no-tests` skips test/build quality checks. That can make local feedback faster, but it reduces what was verified. A check-only CLI mode is explicitly documented as not running security scanners, so its gate is `INCOMPLETE` rather than evidence of secret/dependency safety.

## 6.7 Scanner registry, timeouts, and normalization

`packages/core/src/scanners/registry.ts` defines scanner context (root, detected project, timeout, online/offline state, optional test mocks) and scanner definitions with a `mandatory` flag.

`runScannerSafely` applies a wall-clock timeout. If the scanner throws or times out, it returns an explicit `ERROR` status, duration, error code/message, empty findings, and a note that coverage is unknown. `normalizeFindings` validates the raw array; malformed items are rejected, required fields checked, and a valid severity/confidence selected before stable `makeFinding` construction.

This wrapper is important because a subprocess failure must not be mistaken for a clean scanner result. When adding a new scanner, preserve the safe wrapper and ensure its availability semantics are honest.

---

# 7. Rust engine and TypeScript adapter

![Veylqorix integration model](veylqorix_doc_assets/04_ai_integrations.png)

*Figure 3. Multiple integration surfaces feed a shared engine and normalized results.*

## 7.1 Engine responsibilities

The key Rust source modules are:

| Rust source | Responsibility |
|---|---|
| `model.rs` | Shared model/result types, protocol/schema versions. |
| `policy.rs` | Deterministic policy defaults/overrides, exception expiry and cap behavior. |
| `gate.rs` | `PASS`/`FAIL`/`INCOMPLETE`, coverage and exit-code mapping. |
| `secrets.rs` | Offline secret scanning and file/directory scope rules. |
| `redact.rs` | Shared deterministic secret masking. |
| `finding.rs` | Stable finding ID construction. |
| `exec.rs` | Shell-free external process execution, timeouts and bounded output. |
| `dependencies.rs` | Rust dependency audit adapter. |
| `protocol.rs` | JSON-over-stdio request/response, caps and command dispatch. |
| `main.rs` / `lib.rs` | Binary entry point, crate API, version/protocol reporting. |

## 7.2 JSON-over-stdio protocol

The TypeScript adapter and Rust binary communicate with a bounded JSON protocol:

- Protocol version: `1`.
- Schema version: `1` in the documented current engine model.
- One request JSON document is sent to standard input; one response document is written to standard output.
- Standard output is reserved for protocol JSON. Diagnostics belong on stderr.
- Input is capped at 8 MiB and output/response at 16 MiB.
- Documented commands include `ping`, `scan`, and `evaluate`.
- Successful process completion uses exit `0`; malformed/unsupported requests use `64`, missing audit root uses `65`, and internal engine error uses `70`.
- A scanner failure *inside* a scan is represented in the result as scanner `SKIPPED` or `ERROR`; it should not be flattened into an apparent clean pass.

The adapter parses structured error frames from stdout on the error path; it does not treat stderr as machine-readable protocol data.

## 7.3 Binary discovery and compatibility fallback

The docs describe binary resolution through:

1. `VEYLQORIX_ENGINE` when it points to a valid file.
2. `veylqorix-engine` on `PATH`.
3. Documented install locations.
4. A development-checkout search for `crates/Cargo.toml` and a built binary under `crates/target/release` or `crates/target/debug`.

The native engine binary is **not bundled into the npm CLI package and is not automatically downloaded by the current CLI flow**. In a clean npm consumer, build/install the engine separately and set `VEYLQORIX_ENGINE` or put the binary on `PATH` to get the authoritative Rust-engine path. Otherwise the TypeScript compatibility path is labeled degraded; where the missing native engine creates a completeness gap, the run can be `INCOMPLETE` with exit `2`.

## 7.4 Cross-language parity

The engineering docs describe parity/differential tests for stable finding IDs, redaction, gate outcomes, and exit-code mapping between Rust and TypeScript compatibility behavior. This is a crucial regression boundary: if one implementation changes policy semantics without the other, different integration surfaces could disagree. Any change to shared schema, policy logic, redaction, or findings should update parity tests and protocol/schema notes.

---

# 8. Policy, exceptions, and gate semantics

## 8.1 Default policy

The TypeScript core's default policy is:

| Policy field | Default | Effect |
|---|---|---|
| `blockOnSeverity` | `CRITICAL`, `HIGH` | Findings at these severities can block. |
| `blockOnSecrets` | `true` | Exposed secrets block. |
| `blockOnTestFailure` | `true` | Failing required checks block. |
| `blockOnScannerError` | `true` | Scanner errors are configured as blocking reasons. |
| `blockOnSkippedCheck` | `true` | Skipped/error required checks are surfaced as blocking reasons. |
| `reportOnSeverity` | `MEDIUM`, `LOW` | Lower severities remain visible even when non-blocking. |
| `maxExceptions` | `5` | Caps active exceptions. |
| `exceptions` | empty | No suppression rules by default. |

Confirm the actual committed `veylqorix-policy.json` before assuming the repository policy is identical to the library's defaults; the file in the scanned project can be auto-discovered and applied.

## 8.2 How exceptions work

An exception specifies a `ruleId`, documented `reason`, optional ISO-8601 expiry, and optional path glob. The resolver filters expired exceptions and exceptions with blank reasons. If active exceptions exceed `maxExceptions`, it keeps only the first allowed number in document order and emits a note. A path-specific exception may restrict its match to a path glob; the helper supports `*`, `?`, and `**` semantics.

Example policy excerpt:

```json
{
  "maxExceptions": 5,
  "exceptions": [
    {
      "ruleId": "example-rule",
      "reason": "Temporary, reviewed compatibility constraint; issue SEC-123 tracks removal.",
      "expires": "2026-12-31T23:59:59.000Z",
      "pathGlob": "src/legacy/**"
    }
  ]
}
```

This is an illustrative example, not a claim that the rule exists in the shipped policy. Exception design should include an owner/issue reference in its reason and an expiry whenever practical. Do not use an exception as a way for an AI agent to suppress a finding without review.

## 8.3 Exception evaluation flow

1. Merge only defined caller overrides with defaults.
2. Filter exceptions: expiry and a non-empty reason must pass.
3. Apply the active exception cap.
4. Match by `ruleId`, and by `pathGlob` where configured.
5. Record an `AppliedException` with rule ID, reason, and suppression count.
6. Remove matched findings from the effective set used for gate evaluation.
7. Report the applied exception metadata for auditability.

Policy-version lifecycle tests should test before expiry, exactly around expiry boundaries, after expiry, invalid/blank reason, path match/non-match, duplicate rule matches, exception cap behavior, and stable results for a fixed policy + finding set. A proper historical result should preserve the policy used on that run; do not retroactively rewrite an old result just because current policy changed.

## 8.4 Gate decision logic

The current gate implementation separates **hard fail reasons** from **completeness gaps**.

| Condition | Typical decision behavior |
|---|---|
| Blocking finding after exceptions | `FAIL` (exit `1`). |
| Required check fails and `blockOnTestFailure` is enabled | `FAIL` (exit `1`). |
| Scanner execution error and `blockOnScannerError` is enabled | `FAIL` (exit `1`). |
| No hard-failure condition, but a scanner errored, mandatory scanner was skipped, or a check errored | `INCOMPLETE` (exit `2`). |
| No blocking issue and no completeness gap | `PASS` (exit `0`). |

The policy evaluator also emits `blockingReasons`, `reportedFindings`, `incompleteReasons`, `coverage`, and applied-exception records. Read those fields as well as the top-line gate.

Coverage values are `FULL`, `PARTIAL`, `LIMITED`, or `NONE`. The gate currently calculates coverage from scanner/check gaps; it is not a universal percentage of every file or line examined. Do not describe `FULL` as “all possible security defects detected.”

## 8.5 Exit code summary

| Code | Meaning | Common source |
|---:|---|---|
| `0` | Successful PASS | Fully covered scan with no blocking condition. |
| `1` | FAIL | Blocking finding or configured hard-failure condition. |
| `2` | INCOMPLETE / degraded coverage | Mandatory evidence did not complete, or strict mode marks a coverage gap. |
| `64` | Usage/protocol/input error | Invalid CLI usage or malformed engine request. |
| `65` | Invalid/missing root or input | Root/policy file/path not usable. |
| `70` | Unexpected/internal error | Unhandled process/engine failure. |

Check the command/surface documentation before using an exit code as the only diagnostic. The result JSON is usually more specific.

---

# 9. Reports and finding presentation

## 9.1 JSON

JSON is intended for programmatic consumers—CLI automation, dashboards, MCP adapters, and testing. It contains structured detection, scanner states, findings, checks, gate, coverage, policy, and timing information. Preserve the status fields when integrating; do not convert an `INCOMPLETE` result into an empty/successful finding list.

## 9.2 Markdown

Markdown is the human-readable summary option. It can be saved with `--report-out` and should provide the evidence, gate decision, blocking reasons, incomplete reasons, remediation guidance, and policy/exceptions context that help a reviewer act.

## 9.3 SARIF

SARIF is the code-scanning interchange format. The reusable GitHub gate documents a validate-then-upload sequence: missing or invalid SARIF should fail visibly before upload; upload requires `security-events: write` and an enabled code-scanning configuration. SARIF is a rendering of the audit evidence, not a separate scan or policy engine.

The single-scan design is important: JSON, Markdown and SARIF should all be rendered from the same audit result. Running multiple independent scans to produce each output could lead to mismatched findings and gate state.

## 9.4 Redaction considerations

Secret values should be masked before entering the result object, and integration surfaces add additional defenses where documented. Still:

- Treat reports and scan history as security-relevant data.
- Do not commit raw artifacts from real private repositories without review.
- Avoid including unnecessary code snippets in findings.
- Unknown credential formats may not match a redaction rule.
- If a real secret was exposed, revoke/rotate it.

---

# 10. CLI and local developer workflow

## 10.1 Main commands

| Command | Behavior |
|---|---|
| `veylqorix scan [root]` | Full audit and gate (default command). |
| `veylqorix check [root]` | Quality checks only; security scanners do not run, so result is `INCOMPLETE`. |
| `veylqorix report [root]` | Human-readable Markdown report. |
| `veylqorix config validate FILE` | Validate a policy JSON file. |
| `veylqorix hooks install` | Preview safe Git-hook scripts; dry-run is default. |
| `veylqorix hooks uninstall` | Remove Veylqorix-managed hooks. |
| `veylqorix --help` | Print usage. |

Legacy command aliases are documented (`audit`, `deps`, `secrets`, `gate` normalize to `scan`; `checks` maps to `check`). Verify aliases against the current CLI when changing command behavior.

## 10.2 Useful options

| Option | Effect |
|---|---|
| `--root PATH` | Target repository root. |
| `--staged` | Restrict secret scan to staged Git files. |
| `--json` | JSON output. |
| `--format json\|markdown\|sarif` | Select report format. |
| `--report-out FILE` | Write a Markdown report. |
| `--sarif-out FILE` | Write SARIF. |
| `--offline` | Skip network-dependent scanners; the result must say so. |
| `--no-tests` | Skip quality test/build checks; reduces verification scope. |
| `--scanners dependencies,secrets,licenses` | Select scanner IDs. `quality` is not a scanner ID in the documented CLI; quality checks have separate controls. |
| `--block-on HIGH,CRITICAL` | Override severity threshold for this invocation. |
| `--policy FILE` / `--config FILE` | Load policy JSON. |
| `--pre-push` | Add pre-push script when generating hooks. |
| `--yes` / `-y` | Actually write hook files. |
| `--force` | Back up and replace an existing non-Veylqorix hook. |

## 10.3 Local development prerequisites

- Node.js: the root README documents Node 22.13+ for pnpm 11.9.0; CI uses Node 24. Package manifests can individually declare a lower runtime floor, but the **monorepo toolchain** has the higher pnpm requirement.
- pnpm 11.9.0 as pinned by `packageManager`.
- Rust stable toolchain with `clippy` and `rustfmt` to run the full Rust CI loop.
- Optional external tools (e.g. Gitleaks/cargo-audit/pip-audit) influence which delegated scans can run. Missing optional tools should be recorded as skipped/degraded, not hidden.

## 10.4 Common local command sequence

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm test
pnpm typecheck
pnpm lint
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

Run commands appropriate to the task and document any prerequisite tool that was unavailable. Do not claim to have run these commands just because they appear here.

## 10.5 Git hooks

Hooks are a local convenience, not a hard security boundary. The installer is documented as dry-run by default, supports `--yes` for writing hooks, backs up existing non-Veylqorix hooks, and can use `VEYLQORIX_OVERRIDE=1` as an emergency local override. Hooks can be bypassed with Git flags; CI and branch protection are the enforcement boundary.

---

# 11. MCP server and agent integration

## 11.1 What MCP contributes

The MCP server exposes Veylqorix operations as structured tools to MCP-compatible coding agents such as Claude Code, Codex, Cursor, and other clients. It should be viewed as a constrained interface into the core, not as a separate security engine.

Documented tools:

| Tool | Purpose |
|---|---|
| `scan_repository` | Run the full audit and return the decision. |
| `scan_dependencies` | Dependency-focused scan. |
| `scan_secrets` | Secret-focused scan with redacted values. |
| `run_security_checks` | Quality-check runner. |
| `get_findings` | Return current findings with a cap. |
| `validate_fix` | Re-check after a proposed fix to see if the finding reproduces. |

## 11.2 Safety and input rules

- Inputs are validated with Zod schemas.
- `VEYLQORIX_ROOTS` is required. The server refuses to start unconfined.
- Roots are canonicalized; path traversal and symlink escapes outside allowed roots are rejected.
- The tool does not expose a write/commit/push operation; it reads/scans.
- It executes chosen tools via direct subprocesses rather than shell command strings.
- Result payloads have bounded finding counts and human-readable text caps.
- The server applies a second redaction pass to strings inside both text and structured results.
- Structured status, gate, coverage, and truncation flags are preserved so capped text does not erase the outcome.

## 11.3 Setup example

Build first:

```bash
pnpm install --frozen-lockfile
pnpm build
```

Then create a client config using an absolute path (replace placeholders with real paths):

```json
{
  "mcpServers": {
    "veylqorix": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/to/Veylqorix/packages/mcp-server/dist/bin.js"],
      "env": {
        "VEYLQORIX_ROOTS": "/ABSOLUTE/PATH/to/your/project",
        "VEYLQORIX_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

Restart the agent client and verify the MCP server is connected (the docs recommend `/mcp` in Claude Code). Never leave a placeholder root in a live configuration.

## 11.4 Prompt injection boundary

Source files being scanned may contain adversarial strings such as “ignore previous instructions.” Treat them as untrusted source content, never as directions to the scanner or agent. A scanner result should be grounded in tool output and policy evidence. The current documentation includes prompt-injection-style comments as a useful future/ongoing regression case; do not claim an LLM triage layer is part of the deterministic gate unless a concrete implementation exists in the branch under review.

---

# 12. Plugin SDK

`packages/plugin/` offers an extension SDK for teams adding custom scanners and quality checks. A plugin declares an ID/version/description plus scanner and check definitions. The helpers `definePlugin`, `toAuditOptions`, `withPlugin`, and `runPluginAudit` bridge plugin contributions into the core `runAudit` pipeline.

Design constraints from the docs/source:

- Plugins contribute evidence; they do not replace the gate.
- Extra scanners are additive to the built-ins.
- External subprocess access is mediated through a shell-free executor with a timeout and output cap, not a raw `child_process` handle.
- Extension scanner definitions default to optional (`mandatory: false`); mark a scanner mandatory only when it is required for coverage completeness.
- Missing optional tools should return `SKIPPED` with a reason; thrown errors/timeouts become `ERROR`, never PASS.
- Plugin findings are normalized to the shared schema and stable IDs.
- A plugin author is responsible for redacting any secret values emitted by the plugin; use the core redaction helper and set the secret marker where appropriate.
- Duplicate extension IDs are deduplicated in the bridge helpers.

The current documentation says the plugin ships in the monorepo and is tested with the workspace but is not yet published to npm. Treat publication as separate from existence in source.

---

# 13. REST API, persistence, and dashboard

## 13.1 API role

`packages/api/` exposes a local/remote API over the shared audit core. It manages repository registrations and scan lifecycle records, lets callers poll results, retrieves findings/reports/history, and provides liveness/store-health signals. It does not have its own separate security rules.

## 13.2 Main endpoints

| Method + path | Purpose |
|---|---|
| `GET /api/health` | Liveness + store-health/schema/time metadata. |
| `POST /api/repositories` | Register a repository path. |
| `GET /api/repositories` | List registered repositories. |
| `POST /api/scan` | Start an asynchronous scan; returns `202` and a scan ID. |
| `GET /api/scan/:id` | Poll full scan status/result. |
| `GET /api/scan/:id/findings` | Retrieve just the findings. |
| `GET /api/scan/:id/report` | Return inline report in Markdown/JSON/SARIF. |
| `GET /api/scans` | List scan summaries, optionally filtered by repo. |
| `GET /api/scans/:id` | Fetch detailed scan record. |
| `GET /api/reports/:scanId` | Downloadable report attachment. |
| `GET /api/repo/:id/latest` | Most recent completed scan. |
| `GET /api/repo/:id/history` | Scan history for a registered repo. |

The docs mention `RUNNING`, `DONE`, `ERROR`, and `INTERRUPTED` API scan states. A `RUNNING` scan left behind when the process dies is re-stamped `INTERRUPTED` when the store is loaded, not misrepresented as success.

## 13.3 Authentication and path safety

- Default binding is loopback (`127.0.0.1`).
- Exposing a non-loopback host without a token is refused by the API.
- Protected mode uses `VEYLQORIX_API_TOKEN` and `VEYLQORIX_API_HOST`; routes other than `GET /api/health` require `Authorization: Bearer <token>`.
- Token comparison is timing-safe according to the API docs.
- CORS is an exact-origin allowlist (`VEYLQORIX_CORS_ORIGINS`), not wildcard.
- Canonicalized paths are checked against `VEYLQORIX_ALLOWED_ROOTS` when configured.
- Request body and field lengths are capped; concurrency has a limit and returns `429` rather than silently recording an unaccepted scan.

Do not put the API token in client-side browser code. Use server-side environment configuration, rotate tokens deliberately, and keep the API local unless remote access is necessary and properly protected.

## 13.4 JSON store and reliability

The `ApiStore` interface hides storage behind a replaceable abstraction. The current JSON implementation:

1. Serializes the complete document.
2. Writes a temporary file in the same directory.
3. `fsync`s the temporary file.
4. Renames it over the current file.
5. Attempts a directory `fsync` where supported.

The file is schema-versioned. Corrupt, unreadable, unknown, or newer-schema stores fail closed instead of starting with guessed data. A missing store initializes an empty state. On load, scans still marked `RUNNING` become `INTERRUPTED`.

**Hard limitation:** the store is single-process. Running two API processes against the same JSON file can lose interleaved writes. Multi-process/host scaling requires a real database-backed `ApiStore` implementation, not merely adding replicas.

## 13.5 Dashboard

The web application is under `apps/web/` and uses Next.js. The dashboard presents repositories/scans/findings, status, and scan-related views through the API client. The docs state that when the API is unreachable, the UI displays clearly labelled sample/demo data and a live-status banner rather than presenting sample data as live security results. In any screenshot or demo, keep that labeling visible.

---

# 14. GitHub Actions and CI enforcement

![GitHub pull-request gate](veylqorix_doc_assets/03_github_security_gate.png)

*Figure 4. Local hooks give fast feedback; GitHub Actions is the independent remote check. Repository rules determine whether a failing check actually blocks a merge.*

## 14.1 Continuous integration workflow

The current documented CI workflow runs on pushes to `main` and pull requests. It performs reproducible install, TypeScript package builds, Rust toolchain setup, Rust formatting/clippy/tests/release build, TypeScript tests, typecheck and lint. CI pins third-party actions to commit SHAs; some external scanner installation steps are explicitly non-fatal because runtime tests distinguish absent optional tools.

The repo root pins pnpm 11.9.0. pnpm 11.9.0 requires a newer Node runtime than Node 20 (the repo's CI comments state it uses `node:sqlite`), so CI uses Node 24. Frozen lockfile errors should be fixed by matching pnpm and workspace/lockfile configuration, not bypassed with `--no-frozen-lockfile`.

## 14.2 Reusable `veylqorix-gate.yml`

The calling repository invokes the reusable workflow with `workflow_call`. The documented sequence builds or locates the CLI/engine, runs one scan, writes JSON/Markdown/SARIF artifacts from that same result, evaluates the exit code, validates SARIF, uploads code-scanning output, and preserves artifacts on success/failure where configured.

The gate uses distinct status messages for PASS, FAIL, INCOMPLETE, unexpected exit codes and missing CLI. A missing scan is an error, not a green check.

## 14.3 Gate versus enforcement

The reusable workflow can exit non-zero and create a red check, but **merge blocking requires a repository branch-protection rule or ruleset that marks the correct check as required**. The repository documentation explicitly calls this a manual owner step. A Git hook is even easier to bypass, so it must not be the only enforcement control.

## 14.4 Validation steps for changes

Before merging a change to scanners, the gate, policy, data model, Rust protocol or reporting:

- Run relevant unit and integration tests.
- Run Rust/TypeScript parity tests for shared semantics.
- Check all three outcomes (`PASS`, `FAIL`, `INCOMPLETE`).
- Check scanner errors/timeouts and unavailable external tools.
- Validate SARIF from a real scan result.
- Review artifact redaction and ensure raw credentials never leak.
- Ensure required permissions are minimal and external actions stay pinned.

---

# 15. npm packages and release process

## 15.1 Intended packages

| Package | Role | Registry state in the checked record |
|---|---|---|
| `@veylqorix/core` | Shared scanner/policy/gate/report library | Package manifest declares public access. The recorded first release failed at this package's publish step because npm Trusted Publishing was not configured. Verify current registry state before publishing. |
| `@veylqorix/cli` | `veylqorix` executable | Depends on `@veylqorix/core`; must be published after a compatible core version exists. Verify registry state before publishing. |
| `@veylqorix/plugin` | Extension SDK | Docs state it is available in monorepo but not yet published. |
| `@veylqorix/mcp-server` | MCP tool server | Workspace package; its publish readiness must be audited separately before treating it as part of the public npm release. |

## 15.2 Release workflow design

`.github/workflows/release.yml` is triggered only by a pushed tag matching `v*`. It is structured in two jobs:

1. **Pack job** — read-only permissions; checks that the tag matches versions in both package manifests; installs with frozen lockfile; builds core and CLI; packs tarballs using pnpm so the CLI's `workspace:*` dependency is rewritten to a concrete version; uploads artifacts.
2. **Publish job** — depends on pack; requests `id-token: write`; downloads packed artifacts; publishes core before CLI using npm and provenance. Each publishing step uses fail-fast shell behavior so a core failure prevents CLI publication.

Actions are pinned to immutable SHAs and the workflow avoids an `NPM_TOKEN` secret path. The workflow is designed to fail closed if npm trusted-publisher records are missing.

## 15.3 Recorded release history and blocker

The engineering commit record checked during document creation says the `v0.1.0` tag existed and had been pushed. The run for that tag built and packed both packages, then failed at `Publish @veylqorix/core` because the npm-side trusted publisher was not configured; the CLI publish step was skipped. The note says nothing was published. Separately, a later CI run on `main` was recorded successful after moving CI to Node 24.

See the repository's actual workflow page before acting:

- [Release workflow runs](https://github.com/soumyachk101/Veylqorix/actions/workflows/release.yml)
- [CI workflow runs](https://github.com/soumyachk101/Veylqorix/actions/workflows/ci.yml)
- [Trusted Publishing setup instructions](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md)

Do not assume these statuses remain current forever. Check the latest run and npm registry before a release attempt.

## 15.4 First publication / bootstrap dependency

The repository's trusted-publishing setup document explains that npm may require a package to exist before its Trusted Publisher settings can be created. If current npm behavior still requires this for the account/scope, a one-time manual bootstrap publication must be performed by the owner on their own machine using their npm account and 2FA. This is **not** a CI token fallback.

Safe order:

1. Confirm the `@veylqorix` npm scope is the one you control and that you have write permissions.
2. Query the registry for both package names and every candidate version. Never assume a version is unused.
3. Choose a bootstrap version lower than the intended stable version (the existing setup guide proposes `0.0.1`, subject to registry verification).
4. Build and pack both packages using the intended package-manager workflow.
5. Publish the core bootstrap version first.
6. Pack/publish the CLI so its packed `@veylqorix/core` dependency references the version that now actually exists on the registry.
7. Confirm both packages install in a clean consumer project.
8. Configure Trusted Publishing separately on each package, including direct `npm publish` permission if that is required by the current npm settings.
9. Ensure the first successful trusted-publisher use occurs within the current npm-defined validation window; check official docs at that time.
10. Use a valid new tag/version pair for a future release. Never move or repurpose an existing tag.

Useful registry checks (run only after installing npm and confirming scope access):

```bash
npm view @veylqorix/core versions
npm view @veylqorix/cli versions
npm view @veylqorix/plugin versions
npm view @veylqorix/mcp-server versions
```

Official guide: <https://docs.npmjs.com/trusted-publishers/>.

## 15.5 Critical release caveats

- npm versions are immutable in normal publication; already-published versions cannot be overwritten.
- Tag and manifests must match exactly; release YAML checks this.
- Do not push `v0.1.0` again to force a rerun. The tag already exists in the recorded history. If a newer source change is needed, plan a new, unused version and tag after verifying registry state.
- The CLI's package uses `workspace:*` internally. Pack with the configured pnpm approach and inspect the tarball manifest; a raw `npm pack` flow might leave an unresolvable workspace protocol in the tarball.
- Trusted Publishing settings are per package, not one global switch for an entire scope.
- Do not place npm passwords, OTPs, recovery codes or owner tokens in this repository or CI logs.

---

# 16. Security model and trust boundaries

## 16.1 Threats the architecture attempts to reduce

- Secret values appearing in findings/reports/tool responses.
- Scanner timeouts/errors being misread as clean results.
- Path traversal or symlink escapes in MCP/API target roots.
- Malformed scanner/plugin output corrupting report schemas.
- Unbounded subprocess output or wall-clock execution.
- AI/agent integrations gaining the ability to override gate thresholds.
- Unreviewed/undocumented exceptions suppressing an arbitrary number of findings.
- Tampered third-party GitHub Actions references due to mutable tags.
- A corrupted or newer JSON store being silently treated as valid state.

## 16.2 Controls described in source/docs

- Shared schema and validated scanner result normalization.
- Scanner/check timeouts and safe subprocess execution.
- Shell-free command invocation and capped output.
- Redaction before report/API/MCP exposure, with additional MCP redaction.
- MCP configured-root requirement and canonical path checks.
- API loopback default, token requirement for remote mode, exact-origin CORS.
- Bounded request body, field lengths, and concurrent scan limit.
- Deterministic gate/policy with exception caps and audit records.
- Versioned API store with atomic file replacement and interrupted-scan recovery.
- SHA-pinned GitHub Actions and verified external asset checksum in CI.
- OIDC release flow rather than a stored npm token in CI.

## 16.3 Residual risks and boundaries

- Regex secret scanners have false positives and false negatives.
- No security scanner can certify zero risk or guarantee detection of all vulnerabilities.
- Optional external tools/network-dependent audits may be unavailable; the result must report reduced coverage.
- The Rust engine is not currently auto-bundled/downloaded for npm consumers.
- API JSON store is not safe for multiple concurrent writers/replicas.
- GitHub Actions does not block merging without required status-check configuration.
- Local hooks can be bypassed.
- A plugin author must ensure any secret evidence they produce is redacted before it leaves the plugin.
- The checked shared Finding schema does not confirm dedicated per-finding rule-version or explicit model-hypothesis provenance fields.
- Documentation may lag manifests (the README/CLI version discrepancy noted above must be resolved).

---

# 17. Testing strategy and recommended regression matrix

The repository has TypeScript tests, Rust tests, integration tests, and parity-focused tests described in the engineering docs. The following matrix is the minimum mental model when modifying the pipeline.

| Scenario | Expected observable behavior | Why it matters |
|---|---|---|
| Clean project, all mandatory checks complete | `PASS`, coverage `FULL`, exit `0` | Baseline success behavior. |
| Confirmed HIGH/CRITICAL finding with default policy | `FAIL`, exit `1` | Blocking rule is effective. |
| Secret finding with `blockOnSecrets=true` | `FAIL`, exit `1` | Secret blocking independent of ordinary severity thresholds. |
| Mandatory scanner throws | Scanner `ERROR`; `FAIL` if configured hard failure applies, otherwise at least incomplete coverage; never silently PASS | Failure must remain explicit. |
| Required scanner skipped/unavailable | `INCOMPLETE` or stronger fail where applicable; exit non-zero | No “empty findings = safe” bug. |
| Optional plugin scanner missing | `SKIPPED` with reason; policy semantics still explicitly documented | Optionality cannot hide required evidence gaps. |
| Scanner timeout | Explicit `ERROR`/timeout reason and degraded coverage | Bounded execution and honesty. |
| Expired exception | Does not suppress finding | Expiry must take effect. |
| Exception with blank reason | Not active | Suppressions must be explainable. |
| Exception beyond configured cap | Only the permitted number apply; note recorded | Cap stays effective. |
| Path-scoped exception, path mismatch | Finding is not suppressed | Avoid broad accidental exceptions. |
| Rust and TypeScript engine parity | Same normalized finding/gate semantics for parity fixtures | Prevent surfaces from disagreeing. |
| Malformed plugin finding | Rejected/normalized safely and counted as applicable | Untrusted extension data cannot corrupt output. |
| Malformed/oversized protocol request | Structured error or explicit rejection | Protocol bounds stay enforced. |
| Rust binary unavailable | Explicit degraded-mode note; no silent claim of authoritative native engine | Consumer behavior remains honest. |
| SARIF missing/invalid | Validation fails; upload not treated as successful | Avoid empty/bogus code scanning artifacts. |
| Store contains RUNNING scan at restart | Scan becomes `INTERRUPTED` | Do not manufacture success on recovery. |
| API remote host without token | Startup refused | Avoid accidental open network service. |
| CLI pack manifest with `workspace:*` | Inspect packed package and verify concrete dependency version | Prevent unusable npm artifact. |
| Trusted publisher not configured | Release publish step fails closed; CLI step does not run after core failure | Prevent unauthenticated/unintended publication. |

## Improvement opportunity prompted by external technical feedback

A reviewer suggested labeled adversarial cases (known-vulnerable snippets, near-miss false positives, and prompt-injection-looking comments), a per-scanner coverage sanity check for sudden zero-file scans, and explicit test cases for expiring exceptions and policy changes. These are useful recommendations. This guide does **not** assert that a labelled adversarial benchmark suite or first-class per-scanner file-count invariant is already implemented. Before adopting such a test, define expected output and prove that AI/agent instructions cannot downgrade deterministic findings.

---

# 18. Development setup and common workflows

## 18.1 Clone and install

```bash
git clone https://github.com/soumyachk101/Veylqorix.git
cd Veylqorix
pnpm install --frozen-lockfile
```

Use a Node version compatible with pnpm 11.9.0 (the documented monorepo choice is Node 24).

## 18.2 Build and test TypeScript

```bash
pnpm -r build
pnpm test
pnpm typecheck
pnpm lint
```

## 18.3 Build and test Rust

```bash
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

## 18.4 Run the local API and dashboard

```bash
pnpm --filter @veylqorix/api start
pnpm --filter @veylqorix/web dev
```

The docs describe the API default at `http://localhost:4173` and the dashboard at `http://localhost:3000`; use the current environment files/config if a port or API base URL differs.

## 18.5 Run the CLI from source

```bash
pnpm build
node apps/cli/dist/index.js --help
node apps/cli/dist/index.js scan --root . --json
```

An installed consumer should separately provision the Rust binary if authoritative native-engine execution is required.

## 18.6 Debugging a non-green result

1. Save the JSON result and inspect `gate.result`, `coverage`, `incompleteReasons`, scanner statuses, and check statuses.
2. Check whether the root/detection is correct.
3. Look for `SKIPPED`, `ERROR`, timeout, or missing-tool notes.
4. Validate whether the effective policy and exceptions are what you expected.
5. Confirm Rust engine discovery (`VEYLQORIX_ENGINE`, `PATH`, or development build path).
6. Inspect scanner stderr/structured errors without printing secrets.
7. Fix the root cause and rescan; do not edit the result JSON to make the gate look green.

---

# 19. Operational troubleshooting

| Symptom | Likely explanation | Action |
|---|---|---|
| Gate is `INCOMPLETE` with no findings | Mandatory scanner skipped/errored, a check failed to run, offline mode, or missing Rust engine reduced coverage | Inspect `scanners`, `checks`, `incompleteReasons`, engine notes and tool availability. |
| Dependency scan is skipped | Offline mode, absent external tool, no usable lockfile, or advisory lookup unavailable | Fix tool/lockfile/network setup or accept clearly labelled coverage reduction. |
| Rust engine unavailable | Binary not built, not on PATH, or `VEYLQORIX_ENGINE` points to a wrong file | Build under `crates/` or set the environment variable to the actual executable. |
| MCP server refuses to start | `VEYLQORIX_ROOTS` missing, path nonexistent or invalid | Set one or more real absolute existing directories. Never set roots to a broader path than necessary. |
| MCP result looks truncated | Human-readable content exceeded configured cap | Read structured payload and truncation marker; increase cap carefully only if needed. |
| API returns 401/403 | Missing/incorrect bearer token or path not allowed | Check server mode, token configuration and canonical allowed roots without logging token values. |
| API returns 429 | Concurrent-scan limit reached | Honor `retryAfterSec`; investigate scan throughput before raising limits. |
| API store rejects startup | Corrupt/unreadable file, schema mismatch or newer schema | Back up the file, inspect safely, and follow the store runbook; do not hand-edit a running store. |
| Dashboard shows sample/demo data | API unreachable | Start the API and confirm API base URL; never interpret sample data as a live scan. |
| GitHub gate is red but merge still works | Required status check/branch protection not configured | Configure branch protection or a ruleset for the actual gate check. |
| npm release fails with 401/403 | Trusted Publisher missing/mismatched, OIDC permission/workflow mismatch, or direct publishing not allowed | Check package-specific npm settings and logs. Do not add a token fallback to CI. |
| CLI package is uninstallable | Packed manifest has unresolved `workspace:*` or dependency points at an unpublished core version | Inspect `pnpm pack` tarball manifest and publish compatible core first. |

---

# 20. Architecture figures and their interpretation

![AI agent integration model](veylqorix_doc_assets/04_ai_integrations.png)

*Figure 5. AI integrations. Agents call the CLI, MCP or a plugin interface where supported; the shared core remains the source of scan/policy decisions.*

![Release readiness sequence](veylqorix_doc_assets/05_release_readiness.png)

*Figure 6. Release-readiness sequence. This is a checklist-style sequence, not a claim that each step is complete. Resolve CI, package, and trusted-publishing blockers before tagging; verify the actual workflow and npm package pages afterward.*

---

# 21. Source-of-truth links

The following repository sources are the primary references for the topics above. If documentation and current code differ, inspect the branch/commit you are working on and correct stale documentation.

- [Root README](https://github.com/soumyachk101/Veylqorix/blob/main/README.md)
- [Core shared types](https://github.com/soumyachk101/Veylqorix/blob/main/packages/core/src/types.ts)
- [Audit orchestrator](https://github.com/soumyachk101/Veylqorix/blob/main/packages/core/src/audit.ts)
- [Scanner safety/normalization](https://github.com/soumyachk101/Veylqorix/blob/main/packages/core/src/scanners/registry.ts)
- [Policy resolver](https://github.com/soumyachk101/Veylqorix/blob/main/packages/core/src/policy.ts)
- [Quality gate](https://github.com/soumyachk101/Veylqorix/blob/main/packages/core/src/gate/index.ts)
- [Rust engine guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engine.md)
- [CLI guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/cli.md)
- [MCP guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/mcp.md)
- [Plugin SDK guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/plugin.md)
- [API contract](https://github.com/soumyachk101/Veylqorix/blob/main/docs/api.md)
- [Dashboard guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/dashboard.md)
- [GitHub Actions gate guide](https://github.com/soumyachk101/Veylqorix/blob/main/docs/github-actions.md)
- [Storage and operations](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engineering/STORAGE_AND_OPERATIONS.md)
- [Security hardening](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engineering/SECURITY_HARDENING.md)
- [Release readiness](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engineering/RELEASE_READINESS.md)
- [Trusted Publishing setup](https://github.com/soumyachk101/Veylqorix/blob/main/docs/engineering/NPM_TRUSTED_PUBLISHING_SETUP.md)
- [npm Trusted Publishers official docs](https://docs.npmjs.com/trusted-publishers/)

---

# 22. Final readiness checklists

These lists are intended to be checked off during actual work. A checked box means the owner/operator has verified it; it must not be checked automatically because a corresponding file exists.

## Before merging a code change

- [ ] Identify which boundary changed: scanner, normalization, policy, gate, Rust protocol, CLI, MCP, API, report, workflow, or docs.
- [ ] Add/adjust tests, including failure/timeout/incomplete scenarios relevant to the change.
- [ ] Run the affected TypeScript tests and/or Rust tests.
- [ ] Run Rust/TypeScript parity tests when shared semantics changed.
- [ ] Verify JSON/Markdown/SARIF preserve the same gate decision and safe evidence.
- [ ] Review secret redaction and logs.
- [ ] Review the actual diff and ensure no unrelated website changes were introduced.
- [ ] Confirm CI is green on the exact commit to merge.

## Before deploying API/dashboard

- [ ] API binds to loopback unless remote mode is needed.
- [ ] Remote mode has a strong token and correct host; token not exposed to frontend/logs.
- [ ] `VEYLQORIX_ALLOWED_ROOTS` and MCP roots are least-privilege.
- [ ] CORS allowlist includes only exact required origins.
- [ ] Store path is private, backed up and operated by one process only.
- [ ] Concurrency, timeouts, request limits and health state are monitored.
- [ ] Demo/sample fallback is visibly labelled.
- [ ] Branch protection/ruleset requires the right gate status where merge enforcement is intended.

## Before npm release

- [ ] Confirm the npm account/organization controls `@veylqorix` and has write permission.
- [ ] Query live registry versions for every package and choose an unused version.
- [ ] Check package manifest versions and source/tag commit consistency.
- [ ] Confirm any required bootstrap publish is approved and uses a version below the stable release.
- [ ] Verify packed CLI manifest resolves to an actual published core version.
- [ ] Build, test, pack, and install from a clean consumer project.
- [ ] Configure Trusted Publisher separately for each package.
- [ ] Confirm exact GitHub owner/repository/workflow and direct-publish permission.
- [ ] Confirm current npm/Node minimums and any first-use validation window from official docs.
- [ ] Confirm CI green on the intended release source.
- [ ] Get explicit owner approval before publication/tag push.
- [ ] After publishing, verify both package pages, install tests and provenance.

## Final truthfulness check

- [ ] Do not call an incomplete scan safe.
- [ ] Do not say “all vulnerabilities detected.”
- [ ] Do not label an advisory gate as merge-blocking until branch protection requires it.
- [ ] Do not claim Trusted Publishing works until a real successful OIDC publish has been observed.
- [ ] Do not claim a package is published unless the registry confirms it.
- [ ] Do not treat recommendations in this guide as already shipped features.

---

# Glossary

| Term | Meaning in this project |
|---|---|
| Audit | A run of detection, configured scanners/checks, policy evaluation and result generation. |
| Finding | Normalized statement of a detected issue with scanner/rule identity, severity/confidence and optional evidence/location/remediation. |
| Scanner | Component/tool that supplies security evidence (for example dependencies or secrets). |
| Quality check | Test/lint/type/build command; distinct from the scanner registry IDs. |
| Policy | Deterministic rules governing blocking/reporting thresholds, failure semantics and exceptions. |
| Exception | Documented, optionally expiring rule/path suppression which is capped and recorded. |
| Gate | Final `PASS`, `FAIL` or `INCOMPLETE` decision. |
| Coverage | Qualitative completeness label (`FULL`, `PARTIAL`, `LIMITED`, `NONE`), not a universal vulnerability-coverage percentage. |
| MCP | Model Context Protocol; structured tool interface for compatible agent clients. |
| SARIF | Static Analysis Results Interchange Format used by code-scanning integrations. |
| OIDC | Short-lived identity token flow used by GitHub Actions to authenticate to npm Trusted Publishing without a long-lived npm secret. |
| Provenance | Build/publish traceability evidence; not proof of vulnerability absence. |
| INCOMPLETE | A result with missing/degraded verification evidence. It must not be interpreted as PASS. |
| Labeled fallback | Explicitly marked reduced/native-engine-unavailable mode that avoids pretending the authoritative Rust binary ran. |
