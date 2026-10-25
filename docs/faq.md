# Veylqorix FAQ

## Honest limitations (read this first)

Veylqorix reports what its scanners found. It does **not** certify the absence
of vulnerabilities or secrets.

### "Scanner unavailable" / degraded coverage

If a scanner cannot run — no network, `--offline`, a missing binary
(`pip-audit` not installed), or no lockfile for `npm audit` — that scanner is
reported as **SKIPPED** or **ERROR**, which degrades coverage and can make the
gate **INCOMPLETE** (exit 2). This is deliberate: Veylqorix never treats an
incomplete scan as a clean pass.

- Offline mode skips the advisory-DB pull, so dependency scans cannot see
  published CVEs in offline runs.
- Regex secret detection has false positives and false negatives; unknown
  formats are not covered. It complements Gitleaks; it does not replace it.
- License scanning is manifest-level, not a transitive license audit.
- A clean lint or clean quality check is not a security certification.

### "Advisory gate" — when does it actually block?

The `veylqorix-gate` GitHub Actions workflow **does not block merges by
itself**. It runs a real scan, uploads SARIF to code scanning, and exits
non-zero on blocking findings or incomplete coverage — but GitHub only blocks
a merge when the calling repository **requires that workflow's status check**
via branch protection or a ruleset.

Until that is configured, the gate is **advisory**: it produces findings and
fails the check, but a merge can still be forced. See
`docs/github-actions.md` for how to make it authoritative.

Git hooks are also advisory: a local convenience, bypassable with
`git commit --no-verify` or `VEYLQORIX_OVERRIDE=1`.

## General questions

### Do I need to install anything to run a scan?

No. The secret, license, and quality scanners run from the Node runtime.
The dependency scanner uses `npm audit` (Node) or `pip-audit` (Python);
without the binary or network, that scanner is skipped and coverage is
degraded — never hidden.

### Are my secrets safe in the reports?

Yes. Matched secret values are redacted (`AKIA…CDEF (20 chars, redacted)`)
in every output surface: JSON, Markdown, SARIF, the API, and the dashboard.
Test fixtures contain only fake, well-known placeholder values.

### Why does the dashboard sometimes show demo data?

When the API is unreachable the dashboard renders clearly-labeled sample data
and shows a **DEMO MODE** banner. It never presents the demo as a live
result. Start the API to get real data — see `docs/dashboard.md`.

### Can an AI agent suppress findings to force a pass?

No. Exceptions must carry a documented reason, are capped by
`maxExceptions`, can expire, and are recorded in every gate decision. An
exception is only honored if it is present in the committed policy file and
visible in the report.

### Which ecosystems are supported?

Project detection covers Node, Python, Go, Rust, Java, Ruby, PHP, and .NET
manifests. Scanners run where their toolchain is present; where it is not, the
scanner is skipped and coverage degrades.

For deeper "why did it fail" answers, see `docs/troubleshooting.md`.
