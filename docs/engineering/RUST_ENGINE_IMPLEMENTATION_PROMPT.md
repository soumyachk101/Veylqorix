# VEYLQORIX — REPOSITORY-AWARE MASTER IMPLEMENTATION PROMPT

## Project

- Name: Veylqorix
- Tagline: No Unsafe Code Gets Through.
- Repository: https://github.com/soumyachk101/Veylqorix
- Do not touch veylqorix-website/ this directory
- Primary engineering language: Rust, integrated with the existing TypeScript ecosystem.
- Existing package manager: pnpm.
- Existing frontend: Next.js, React, TypeScript, and Tailwind CSS.
- License currently declared in the repository: MIT.

## Mission

Act as a principal software architect, senior Rust engineer, application security engineer, DevSecOps engineer, backend and integration engineer, technical writer for engineering documentation, and QA specialist.

Improve the existing Veylqorix repository into a cohesive security platform with a genuine Rust core, functioning CLI and MCP integrations, GitHub security enforcement, reliable API behavior, and compatibility with the existing dashboard. The public website is already built and is explicitly out of scope for redesign or feature expansion.

Do not generate a new project from scratch. Do not overwrite the current implementation blindly. Work with the actual source code, dependencies, tests, and architecture.

Do not stop at planning or mockups. Audit the repository, implement improvements, run real checks, fix defects, and verify completed functionality.

Do not divide development into fixed days or a day-by-day schedule. Use logical, dependency-aware implementation milestones instead.

---

# 1. CURRENT REPOSITORY CONTEXT

The following structure was observed in the public repository. Verify it again against the current checkout before making changes.

- `packages/core/`: TypeScript security engine, scanning orchestration, policy, findings, and reporting.
- `apps/cli/`: existing CLI implementation.
- `packages/mcp-server/`: MCP server and validated tools.
- `packages/api/`: backend API.
- `packages/skills/`: portable AI-agent skill and client configurations.
- `apps/web/`: Next.js public landing page and dashboard.
- `apps/web/src/app/page.tsx`: existing homepage assembled from reusable components.
- `apps/web/src/app/dashboard/page.tsx`: existing dashboard route.
- `apps/web/src/app/docs/page.tsx`: existing documentation route.
- `apps/web/src/app/globals.css`: current design tokens and styling.
- `apps/web/src/components/landing/`: homepage sections, including hero, architecture, capabilities, integrations, and documentation.
- `Veylqorix_Diagrams/`: existing diagrams and editable Graphviz sources.
- `docs/`: existing technical documentation.
- `.github/workflows/ci.yml`: existing build, test, type-check, and lint workflow.
- `.github/workflows/veylqorix-gate.yml`: existing security-gate workflow.
- `CHANGELOG.md`: existing release history.
- `pnpm-workspace.yaml`: existing workspace configuration.

The inspected default-branch file tree contained no Rust source files, `Cargo.toml`, or `Cargo.lock`. The repository is therefore currently a TypeScript/pnpm monorepo, despite Rust being the intended primary language for the security engine.

The README describes existing functionality for dependency auditing, secret detection, license checking, quality checks, normalized findings, policy evaluation, JSON/SARIF reports, MCP, CLI, Git hooks, GitHub Actions, API, and the dashboard.

These descriptions are leads for your audit, not proof that every function works today.

Revalidate each capability through source inspection and tests. Record any difference between the documentation and the actual implementation.

Preserve the existing interface contracts wherever practical.

---

# 2. INITIAL AUDIT — BEFORE CHANGING FILES

Inspect the repository and run the available baseline checks before modifying code.

Review:

- Root package manifests and lockfiles.
- Rust toolchain availability, if installed.
- All existing workspace packages.
- Core scanning and policy implementation.
- CLI and command-line compatibility.
- MCP tools and input validation.
- API routes and storage behavior.
- Dashboard data flows and demo fallback.
- Existing website sections and design tokens.
- Existing technical diagrams and their editable source files.
- Root changelog and engineering documentation.
- Git hooks and GitHub Actions.
- Tests, fixtures, and CI configuration.
- README claims, documented limitations, and license.
- Vercel configuration and deployment assumptions.
- Existing dependency or security warnings.

Run, where applicable:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Use the exact scripts supported by the checked-out project. If a command is not available, document that fact rather than pretending it passed.

Also inspect available Rust tooling and the target Rust toolchain.

Do not assume Rust is installed merely because it is requested.

Produce a concise baseline report containing:

1. Existing architecture.
2. Build and test results.
3. Functional code worth preserving.
4. Missing Rust implementation.
5. Security and integration risks.
6. Existing API and dashboard contracts that Rust integration must preserve.
7. Recommended implementation sequence.

After that report, begin implementation.

Do not require a further user response for ordinary local development work.

---

# 3. RUST MUST BE A REAL ENGINE, NOT AN EMPTY CRATE

Rust is a core architectural requirement for this project.

Do not satisfy it by merely adding:

- An unused `Cargo.toml`.
- A placeholder Rust binary.
- A Rust example that never runs.
- Decorative Rust branding without functional integration.
- Documentation claiming the engine is implemented.
- A subprocess that returns hardcoded successful results.

Implement and integrate working Rust functionality.

## 3.1 Recommended architecture

Introduce a Rust workspace appropriate to the existing project, for example:

```text
crates/
  veylqorix-core/
  veylqorix-cli/        # Only if a separate native CLI is justified

packages/
  core/                 # Existing TypeScript core during migration
  api/
  mcp-server/
  skills/
```

Keep the existing `apps/cli/` and `apps/web/` structure unless repository evidence justifies changing it.

Do not create unnecessary crates or packages merely to match this example.

## 3.2 Rust core responsibilities

Implement genuine Rust functionality for the central security engine, including:

- Typed scan configuration.
- Scanner orchestration.
- Safe process execution.
- Timeouts and bounded output handling.
- Structured execution errors.
- Normalized finding representations.
- Deterministic policy evaluation.
- PASS, FAIL, and INCOMPLETE decisions.
- Secret-safe evidence handling.
- JSON serialization.
- Report-generation interfaces.
- Unit and integration tests.

Use appropriate Rust libraries such as Serde and Tokio where justified.

Avoid unnecessary unsafe code and avoid building shell commands by concatenating untrusted strings.

The Rust core must distinguish scanner failure from a successful scan with findings and from a successful scan with no findings.

Use explicit types and error states rather than relying on ambiguous booleans.

## 3.3 Migration strategy

Do not rewrite the entire TypeScript implementation in one uncontrolled operation.

First identify which logic belongs in the Rust security engine and which logic is application integration.

Move central, security-sensitive responsibilities into Rust incrementally.

Keep TypeScript where it is useful for:

- Existing frontend rendering.
- Next.js server and client components.
- API routing and web-specific behavior.
- Client SDKs and integration adapters.
- Dashboard presentation.
- Content and documentation rendering.

Migrate the security orchestration and policy decisions into Rust while preserving the existing TypeScript interfaces through a documented adapter.

Use a well-defined interface, such as JSON over standard input/output, a structured local protocol, or another justified mechanism.

If you choose a subprocess boundary, implement:

- Explicit input and output schemas.
- Process timeouts.
- Exit-code mapping.
- Maximum input and output sizes.
- Safe process execution.
- Error propagation.
- Version compatibility.
- Child-process cleanup.
- Tests for malformed or incomplete output.

Do not silently fall back to a weaker TypeScript policy implementation when the Rust engine fails.

During migration, use a deliberate compatibility mode only where safe. Label incomplete or degraded execution honestly.

Do not declare Rust integration complete until real application features call the Rust engine and their output is verified through tests.

## 3.4 Existing TypeScript core

Preserve working behavior in `packages/core/`.

Audit its scanner adapters, policy evaluation, normalized findings, and report generation.

Create explicit compatibility tests to prevent regressions in:

- Existing CLI commands.
- Exit codes.
- MCP tools.
- API routes.
- Dashboard data contracts.
- JSON and SARIF output.
- Secret redaction.
- Existing policy files.

Remove duplicated policy logic only after its replacement is implemented and verified.

## 3.5 Rust development and CI

Add the appropriate Rust workspace files, dependency configuration, formatting configuration, and tests.

Use the project's intended supported Rust toolchain and document it.

Update CI to validate Rust alongside the existing TypeScript/pnpm workspace.

Run the appropriate Rust checks, such as (the cargo workspace lives at
`crates/Cargo.toml` — there is no `Cargo.toml` at the repo root, so every
cargo command takes `--manifest-path crates/Cargo.toml`):

```bash
cargo fmt --manifest-path crates/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/Cargo.toml --workspace --all-targets --all-features -- -D warnings
cargo test --manifest-path crates/Cargo.toml --workspace --all-features
cargo build --manifest-path crates/Cargo.toml --workspace --release
```

Adjust commands to actual workspace capabilities.

Avoid making an unrelated frontend task depend on an unavailable Rust installation unless Rust is mandatory for the relevant workflow.

Do not commit lockfiles that do not correspond to the actual dependency configuration.

---

# 4. SECURITY SCANNERS AND POLICY ENGINE

Integrate established scanners instead of writing replacements without a clear technical reason.

## Dependency auditing

Support applicable dependency manifests and lockfiles for:

- Rust.
- JavaScript/TypeScript.
- Python.

Evaluate tools such as:

- `cargo audit`.
- Appropriate npm ecosystem auditing.
- `pip-audit`.

Report real advisories, affected versions, severity, patched versions where available, and useful remediation information.

Do not treat every outdated dependency as a vulnerability.

Do not claim that dependencies are up to date without checking them.

## Secret detection

Integrate Gitleaks or another maintained scanner where feasible.

Support staged changes and other scan scopes as configured.

Redact discovered secrets from:

- Terminal output.
- Reports.
- API responses.
- MCP responses.
- Dashboard details.
- GitHub annotations.
- Logs and artifacts.

Use fake credentials only in test fixtures.

## Static analysis

Integrate suitable tools according to the actual project ecosystem.

Examples include Clippy, ESLint, Ruff, Bandit, and Semgrep where appropriate.

Do not run an irrelevant scanner against every project.

Report unavailable mandatory scanners as incomplete execution rather than a clean pass.

## Normalized finding schema

Maintain a consistent finding schema across Rust and TypeScript boundaries.

Include applicable fields for:

- Finding identifier.
- Scanner and rule.
- Category and severity.
- Confidence.
- File path and line range.
- Redacted evidence.
- Impact and explanation.
- Recommended remediation.
- Dependency/advisory information.
- Scan ID and timestamp.
- Verification status.

Keep schema versioning explicit.

## Policy enforcement

Implement configurable security thresholds and explicit failure rules.

Support:

- Critical and high-severity policies.
- Confirmed secret blocking.
- Test failures.
- Missing mandatory scanners.
- Scanner timeouts.
- Incomplete scans.
- Auditable exceptions.
- Expiring baselines.
- JSON and SARIF reports.

Use deterministic exit codes consistent with the existing CLI unless a documented compatibility change is necessary.

An unavailable scanner must never be silently treated as a successful scan.

AI agents must not be able to suppress findings, weaken thresholds, or approve their own exceptions without the required authorization.

---

# 5. CLI, GIT, MCP, SKILL, AND GITHUB ACTIONS

## CLI

Preserve the current `veylqorix` command interface where practical.

Verify the documented commands and behavior:

```bash
veylqorix scan
veylqorix check
veylqorix report
veylqorix config validate
veylqorix hooks install
veylqorix hooks uninstall
```

Use the existing syntax and options after inspecting the implementation.

Ensure the CLI uses the integrated security engine rather than a decorative Rust wrapper.

## Git hooks

Preserve safe installation and removal behavior.

Do not change Git configuration or replace existing hooks without explicit approval.

Local hooks are a convenience. They are not the authoritative merge-enforcement mechanism.

## MCP

Preserve the existing MCP server and its documented tool contracts unless a verified defect requires a change.

Make its execution path use the Rust-backed security engine through the defined adapter.

Keep validation, workspace confinement, redaction, timeouts, and output limits.

Do not expose unrestricted shell execution.

Do not push, commit, or modify files automatically through the MCP server.

## AI skill

Preserve the existing portable `SKILL.md` and client configurations.

Improve them to reflect the real Rust-backed engine, supported clients, actual commands, limitations, and required verification workflow.

Do not claim that every editor supports an identical skill format.

## GitHub Actions

Preserve the existing reusable security gate and CI workflows.

Integrate Rust build/test checks and maintain the TypeScript build/test pipeline.

Use least-privilege permissions and verified immutable action SHAs where appropriate.

Ensure blocking policy failures produce actual failing checks.

Document that merge blocking requires repository rulesets or branch protection to require the relevant check.

Do not claim authoritative merge enforcement unless it has been configured and verified.

---

# 6. PRESERVE THE EXISTING WEBSITE AND DASHBOARD

The public website and dashboard have already been built. Do not redesign them, create new marketing pages, add a blog/storytelling/roadmap website, introduce SEO work, or make visual improvements as part of this task.

Keep the existing Next.js application, styles, pages, components, branding, logo, navigation, content, and dashboard layout intact.

Only modify frontend or API files when a specific change is strictly necessary to integrate the Rust engine or preserve an existing product contract. Such changes must be minimal, justified, and tested.

Do not replace the frontend framework, rewrite the homepage, or introduce a content-management system.

The existing dashboard must continue to consume real API scan data. Preserve its clearly labeled demo fallback if the API is unavailable. Confirm that Rust integration does not break dashboard data contracts, reports, status labels, secret redaction, or existing routes.

If a frontend regression is discovered during backend integration, fix only that regression; do not use it as an opportunity for a broader UI redesign.

---

# 7. TECHNICAL DIAGRAMS AND ARCHITECTURE DOCUMENTATION

Keep existing Veylqorix diagrams and their editable sources unless a real architecture change makes an update necessary.

The existing collection may include:

1. System architecture.
2. Security scan lifecycle.
3. GitHub security gate.
4. AI agent integration model.
5. Historical eight-day roadmap.
6. Expanded platform architecture.
7. Continuous code health.
8. Pre-PR master gate.

Update only diagrams whose technical content becomes inaccurate after Rust integration. Prioritize architecture accuracy, readable labels, and editable source formats such as Graphviz, Mermaid, or SVG.

Do not create a new branding exercise, redesign the website, or spend time on decorative graphics. A historical eight-day roadmap is not a development schedule and must not constrain implementation.

---

# 8. TESTING AND VERIFICATION

Testing is mandatory.

## Rust

Run applicable:

- Formatting.
- Clippy.
- Unit tests.
- Integration tests.
- Release build.

## Existing TypeScript workspace

Run applicable:

- Build.
- Type checking.
- Lint.
- Unit and integration tests.

## Security workflow

Test:

- Clean repository.
- Known vulnerable dependency.
- Fake test secret.
- Insecure code fixture.
- Failed quality check.
- Missing scanner.
- Scanner timeout.
- Malformed output.
- Incomplete scan.
- Finding remediation followed by a rescan.

## Integration compatibility

Verify:

- Rust engine to TypeScript adapter.
- CLI exit-code compatibility.
- MCP tool outputs.
- API findings.
- Dashboard data.
- JSON and SARIF reports.
- Secret redaction across all layers.
- GitHub Actions pass/fail behavior.

Do not suppress failing tests to make the project appear healthy.

Do not claim completion merely because the files exist.

Record tests that cannot run and explain why.

---

# 9. IMPLEMENTATION METHOD

Work in logical, dependency-aware milestones. Do not impose fixed daily schedules.

For each meaningful change:

1. Inspect the existing code.
2. Identify the smallest useful complete feature.
3. Define expected behavior and acceptance criteria.
4. Implement it.
5. Add or update tests.
6. Run relevant checks.
7. Inspect real outputs.
8. Fix regressions.
9. Update technical documentation and changelog entries when warranted.
10. Continue to the next priority.

Choose implementation order based on actual dependencies and risks.

Prioritize:

1. Establish a verified baseline and preserve the current implementation.
2. Build a real Rust security core with typed inputs, safe scanner orchestration, normalized findings, deterministic policy evaluation, and structured results.
3. Integrate the Rust engine with the existing TypeScript core through a stable, tested adapter.
4. Preserve and verify CLI behavior, exit codes, scanner output, policy files, JSON/SARIF reporting, and secret redaction.
5. Integrate MCP, API, Git hooks, and GitHub Actions with the Rust-backed engine without duplicating security rules.
6. Preserve the existing dashboard and website, changing them only when needed for compatibility with the updated engine/API.
7. Update technical documentation and architecture diagrams only where implementation changes require it.
8. Run end-to-end validation and report remaining gaps honestly.

Adapt this order whenever repository evidence shows a different dependency or a higher-priority security risk.

Do not stop after adding a Rust crate or generating wrapper code. The Rust engine must perform meaningful security work and be invoked by real application workflows.

Do not remove working TypeScript functionality until its Rust-backed replacement is implemented and verified.

Do not generate excessive placeholders, duplicate business logic, or unnecessary services.

If an external service requires credentials, infrastructure, or permission that is unavailable, implement what can be done safely and document the exact remaining requirement.

---

# 10. EXTERNAL ACTIONS

You may inspect and modify project files and run appropriate local commands.

Do not automatically push commits, open pull requests, merge code, publish packages, create releases, deploy production, alter repository security rules, delete important data, or upload private source code externally.

Obtain explicit approval before consequential external actions.

Never expose credentials in code, logs, documentation, diagrams, screenshots, or reports.

---

# 11. COMPLETION REPORT

After the initial audit, report:

- Current TypeScript architecture.
- Existing functionality verified.
- Absence or presence of Rust implementation.
- Build and test baseline.
- Proposed Rust crate structure and integration boundary.
- Security risks and compatibility requirements.
- Recommended implementation sequence.

After each logical milestone, report:

- Changes made.
- Files changed.
- Commands run.
- Actual test results.
- Remaining limitations.
- Any external blocker.

At final completion, distinguish:

- Implemented and verified.
- Implemented but not fully verified.
- Incomplete.
- Blocked by external requirements.

Do not report website improvements as a deliverable. The website already exists and is outside the scope of this task, except for minimal compatibility fixes required by Rust/API integration.

Never represent intended architecture as completed functionality.

---

# 12. FINAL DIRECTIVE

Begin by auditing the current Veylqorix repository, not by generating a replacement project.

The primary objective is to implement a real Rust security engine and integrate it with the existing TypeScript/pnpm ecosystem without breaking the current CLI, MCP server, API, dashboard, scanner adapters, policy behavior, JSON/SARIF reports, or GitHub Actions.

The current repository contains a TypeScript core and does not yet contain a verified Rust workspace. Treat Rust implementation as substantive engineering work, not as a cosmetic addition or empty crate.

Move central security-sensitive orchestration and policy evaluation into Rust incrementally, define a stable interface to the existing TypeScript applications, and verify the integration through real scans and compatibility tests.

Preserve the existing website and dashboard. Do not build new public website pages, redesign the UI, add blog/storytelling/changelog pages, or undertake SEO and marketing-site improvements. Make frontend changes only if strictly necessary to keep the existing product working with the Rust-backed engine.

Preserve the existing security integrations and improve their correctness, reliability, and test coverage. Update engineering documentation and technical diagrams only when needed to reflect actual implementation changes.

Prioritize reliable Rust functionality, evidence-based security, safe process execution, deterministic policy evaluation, secret redaction, adapter compatibility, CI verification, maintainable code, and honest reporting.

Do not divide implementation by days.

Start with the repository audit, then implement and validate the work incrementally until the scoped engineering tasks are complete or a clearly documented external blocker prevents further progress.