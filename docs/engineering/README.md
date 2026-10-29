# Engineering reference (`docs/engineering/`)

Internal audit records that document a point in time: what was checked,
against which branch and date, and what was verified at that moment. These are
frozen records, not living docs — a "Last synced" date means the prose matches
the code as of that date, and any drift after it is recorded in a dated
addendum in the file itself rather than silently edited. Treat a discrepancy
with the current source as "the record is older than the code," not as the
source being wrong.

## Files

- [BASELINE_AUDIT.md](BASELINE_AUDIT.md) — read-only architectural audit of
  `main` (2026-07-10). Every claim is grounded in a file read at the time;
  items the auditor could not verify are marked **UNCERTAIN**.
- [ENGINE_PARITY.md](ENGINE_PARITY.md) — the contract that the Rust engine
  (`crates/veylqorix-engine`) and the TypeScript core (`packages/core`) must
  behave equivalently, pinned by the shared fixture files.
- [NPM_PUBLICATION_AUDIT.md](NPM_PUBLICATION_AUDIT.md) — Phase 1 (CI green under
  the toolchain it was authored with) and Phase 2 (release-workflow readiness),
  dated 2026-07-11 with a 2026-10-27 second-round update.
- [NPM_PUBLICATION_REPORT.md](NPM_PUBLICATION_REPORT.md) — the evidence log for
  the release: which checks passed, which failed and why, against the real
  Actions history and the live registry (2026-10-27, post-`dd2054f`).
- [NPM_TRUSTED_PUBLISHING_SETUP.md](NPM_TRUSTED_PUBLISHING_SETUP.md) — the
  standing procedure for the one-time npm-side trusted-publisher setup and the
  `v0.1.1` release execution (2026-10-27). Single source of truth for how the
  release is performed.
- [RELEASE_READINESS.md](RELEASE_READINESS.md) — packaging correctness, the
  release workflow, and the split (A) automated / (B) owner actions checklist.
  Last validated 2026-10-27.
- [SECURITY_HARDENING.md](SECURITY_HARDENING.md) — threat model and hardening of
  the REST API (`packages/api`). Last synced with code 2026-07-08.
- [STORAGE_AND_OPERATIONS.md](STORAGE_AND_OPERATIONS.md) — the API's
  file-backed JSON store, its atomic writes, and operational behavior. Last
  synced 2026-07-08.
- [SUPPLY_CHAIN.md](SUPPLY_CHAIN.md) — supply-chain and dependency assessment:
  `pnpm audit`, `allowBuilds`/`overrides`, GitHub Actions pinning, and the
  `.env.example` reconciliation.
- [VALIDATION_REPORT.md](VALIDATION_REPORT.md) — the closing report for the
  engineering hardening & release-readiness effort (branch
  `feat/engineering-hardening`, 2026-10-26): findings fixed (e.g. F-05) and the
  commands actually run in that session.

When two of these disagree, the dated 2026-10-27 release documents
(`NPM_PUBLICATION_REPORT.md` and `NPM_TRUSTED_PUBLISHING_SETUP.md`) are the most
recent state of the release; the 2026-07 files record the earlier baseline and
were not all re-synced after the engine and release work landed.
