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

### Why does the dashboard sometimes show sample data?

When the API is unreachable the dashboard renders clearly-labeled sample
data and shows a **SAMPLE DATA** banner. It never presents sample data as
a live result. Start the API to get real data — see `docs/dashboard.md`.

### Is the REST API open to the network by default?

No. The API binds to `127.0.0.1` (loopback-only) by default, so remote
hosts cannot reach it. To expose it on another address you must run it in
protected mode: set `VEYLQORIX_API_HOST` **and** `VEYLQORIX_API_TOKEN` —
a non-loopback host without a token refuses to start. With a token, every
`/api` route except `GET /api/health` requires the bearer token, and CORS
is an exact-origin allowlist (`VEYLQORIX_CORS_ORIGINS`), never a
wildcard.

### Does scan data survive an API restart?

Yes. The API persists repositories and scan results to a JSON file
(`VEYLQORIX_STORE_PATH`, default `./.veylqorix-store.json`) with atomic
writes, so state survives restarts. Scans still running when the process
exits are re-stamped `INTERRUPTED` on the next start (never shown as
completed) and can be re-run.

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
Filing a bug? Collect the fields that bug reporter needs — surface, exact
command + exit code, the `--json` output with secrets redacted, and the
version/commit — one-to-one with the bug-report template. The checklist lives
in `docs/troubleshooting.md` § "Filing a bug: what to attach".
