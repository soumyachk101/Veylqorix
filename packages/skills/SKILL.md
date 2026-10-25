---
name: veylqorix-security-scan
description: Evidence-based security scanning for code before it is committed, pushed, or merged. Use before any code change, commit, or PR: verify dependencies, detect secrets, run static analysis, and gate on results.
---

# Veylqorix Security Scan Skill

You are verifying code security with Veylqorix, a security platform that runs
**real scanners** and gates on their output. Your job is to independently verify
code before it leaves the developer's machine — never to guess or simulate
results.

## Core rule

**Never fabricate scan results, vulnerability counts, or "all clear" verdicts.**
Every security claim you make must trace back to a scanner output you actually
ran and read. If a scanner could not run, say so — a skipped scanner is not a
pass.

## Activation

Use this skill when the user:
- Asks you to "check", "audit", "scan", or "verify" the security of a repository or codebase.
- Is about to commit, push, open a PR, or deploy, and asks you to make sure the change is safe.
- Reports that they may have committed a secret or added a vulnerable dependency.
- Wants to know whether their changes are "safe to ship".

## Workflow (run in this order)

### 1. Inspect before you act

```
1. Identify the ecosystem: read package.json / requirements.txt / go.mod /
   Cargo.toml / pyproject.toml at the root.
2. Note the package manager (lockfile): pnpm-lock.yaml, package-lock.json,
   yarn.lock, uv.lock, poetry.lock.
3. Note the test runner and linters already configured so you don't add new ones.
```

### 2. Run the appropriate checks

Prefer the Veylqorix CLI when it is installed; otherwise the MCP server
exposes the same engine (`@veylqorix/mcp-server`) as tools. Run the underlying
tools directly only when neither is available, and apply the same
interpretation rules below.

```
node <veylqorix-cli> scan --root <repo> --json          # full audit
node <veylqorix-cli> scan --staged --root <repo>        # git-staged files only
node <veylqorix-cli> check --root <repo>                 # quality checks only
node <veylqorix-cli> report --root <repo>                 # markdown report
```

MCP tools (when the veylqorix server is connected):
- `scan_repository` — full audit: dependency, secret, and license scanners,
  quality checks, and the gate. Structured findings + gate decision.
- `scan_dependencies` — dependency scanner only (npm audit / pip-audit). An
  unavailable scanner comes back SKIPPED/ERROR with a note, never a pass.
- `scan_secrets` — offline secret-pattern scan; values are redacted in output.
- `run_security_checks` — quality checks only (type, lint, tests). Commands
  are chosen from the project's own config; callers cannot inject commands.
- `get_findings` — list current findings (fast, no quality checks), with a
  result cap.
- `validate_fix` — re-run scanners and check that specific finding ids no
  longer appear. This is the only way to verify a fix actually worked.

The exit code is authoritative: **0 = PASS, 1 = FAIL (blocking findings),
2 = INCOMPLETE (coverage degraded)** — never treat 2 as a pass.

### 3. Read and interpret the actual results

Parse the JSON (or read the Markdown) and look at:
- `gate.result` — the verdict you will report.
- `gate.blockingReasons` — the specific findings that FAIL the gate.
- `gate.incompleteReasons` — scanners that could not complete.
- `findings[]` — each with `severity`, `confidence`, `location`, and `remediation`.
- `coverage` — FULL / PARTIAL / LIMITED. If not FULL, your "no findings" result
  is weaker than a full scan.

### 4. Explain findings with evidence, not vibes

For each finding report:
- **What** (rule id + scanner, e.g. `secrets/aws-access-key-id`), **where**
  (file + line), **why it matters**, and **the concrete fix**.
- Distinguish confidence levels: a `CONFIRMED` high-severity vulnerability is
  actionable; a `LOW`-confidence pattern match is "review this".
- Never claim a finding is real just because a regex matched; carry the
  confidence through.

### 5. Suggest minimal, targeted fixes

- Prefer the smallest change that resolves the specific finding (pin a patched
  version, move a secret to an env var, remove a key from history).
- Do not introduce new dependencies to fix one issue unless the tool genuinely
  requires it.
- For exposed secrets: the fix is **rotate first, then remove** — removing from
  the working tree without rotating still leaves a leaked credential.

### 6. Verify your fix

Re-run the relevant scanner (or the full audit) after the change and confirm the
finding is gone or downgraded. Do not claim a fix worked until you have a fresh
run showing it.

```
node <veylqorix-cli> scan --root <repo> --scanners <the one you fixed> --json
```

With the MCP server connected, call `validate_fix` with the finding ids you
fixed. It re-runs the scanners and tells you which ids are still present.
A fix is verified **only** when its id is reported resolved — if the scanner
that would report it did not complete, the fix is unverified, not fixed.

### 7. Report honestly

State explicitly:
- Which checks passed, which failed, which **could not run** (and why).
- Any finding you fixed and the evidence it is now resolved.
- Any unresolved risk and the exact command to re-verify it later.
- The current gate result and exit code.

Never say "all clear" when `coverage` is not FULL or a scanner errored.

## Dependency verification rules

- `npm audit` / `pip-audit` results are authoritative for *known* CVEs; they
  do not prove a package is the latest version. Distinguish:
  - **security update** (advisory published) — act on it.
  - **compatible update** — suggest, don't block.
  - **major / breaking update** — flag, never auto-apply.
- Prefer upgrading to the **fixed version** the advisory names over the latest
  version; "latest" is not always "patched".
- Check the lockfile, not just the manifest: a range in `package.json` is only
  a declaration; the lockfile version is what actually installs.

## Secret-handling rules

- **Never print, log, echo, or paste a detected secret value — full or nearly
  full.** Reference it by file, line, and the redacted form the scanner gives
  you (e.g. `AKIA…CDEF (20 chars, redacted)`).
- Treat every match as a potential leak until verified: the remediation is
  rotation, not just deletion.
- Do not "fix" a secret by committing a new value in its place.
- If the secret is in git history, deletion of the working-tree copy is
  insufficient; note that history cleanup (and, critically, rotation) is required.

## Error-handling instructions

- Scanner binary missing (npm/pip-audit/ruff absent): report it as SKIPPED or
  ERROR with the install command, and mark coverage as degraded. Do not invent
  results.
- Network unavailable: dependency scans that need an advisory DB are skipped,
  not failed. Say coverage is LIMITED.
- A check that "could not run" is not a pass. If the gate reports INCOMPLETE,
  surface that plainly.

## Examples and limitations

- **Do not** claim a scan found zero vulnerabilities when the dependency
  scanner was skipped (e.g. offline).
- **Do not** batch-fix findings the user did not ask about without asking first.
- **Do** get explicit approval before any destructive operation (rewriting
  history, deleting a key, force-pushing) or before publishing anything
  externally.

## Approval before consequential operations

The scanning tools are read-only: they do not modify files or execute
caller-supplied commands. But *you* may propose or apply changes. Get explicit
user approval before:
- committing, pushing, rewriting history, or deleting anything;
- rotating or deleting a detected credential;
- applying a fix you were not asked to apply, or publishing results anywhere.

A fix that changes code (pinning a version, moving a secret to an env var)
only counts when you re-ran the scanner afterwards and it no longer reports the
finding — never announce a fix based on the edit alone.

## MCP server safety model

When tools come from `@veylqorix/mcp-server`:
- **Workspace confinement**: the server is started with a set of allowed
  workspace roots; every tool resolves its `root` argument against them and
  rejects `..` traversal and symlink escapes before touching the filesystem.
  If a tool returns `PATH_ERROR`, the requested path was outside the allowed
  roots — stop and report it, do not try to "fix" the path yourself.
- **No shell execution**: command selection is hardcoded on the server side
  from the detected project config. Callers cannot supply or inject commands
  through any tool argument.
- **Timeouts and output caps**: every scanner, check, and tool result is
  bounded; oversized output is truncated and a truncated result is always
  labeled as truncated.
- **Redaction**: secret values are masked in every tool result. Quote the
  redacted form only (e.g. `AKIA…CDEF (20 chars, redacted)`).
- **Honest availability**: when a scanner cannot run (offline, missing
  binary), the tool reports `SKIPPED` or `ERROR` with a note. Treat that as
  "could not verify", not as a pass.

## Limitations

- Offline dependency scanning cannot detect *new* CVEs published since the
  last advisory-DB pull.
- Regex secret detection has false positives; always carry confidence.
- Static analysis (Clippy/ESLint/Ruff/Bandit) is only as strong as its rule
  set; a clean lint is not a security certification.
- Veylqorix reports what its scanners found. It does not certify the absence of
  vulnerabilities or secrets.
