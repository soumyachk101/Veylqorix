# Veylqorix Security

## Threat model

Veylqorix is a **pre-commit / pre-push / CI verification tool**. It is not a
security boundary on its own: it makes unsafe code visible and blocks it in the
workflow where it runs, but it does not replace GitHub-side enforcement.

### What it protects

- **Local convenience gate**: Git hooks catch obvious issues early (secret
  commits, vulnerable pinned deps) and cost the developer seconds.
- **CI gate (authoritative)**: the reusable `veylqorix-gate` workflow runs on
  GitHub, uploads SARIF to code scanning, and only enforces when the repo
  requires its status check via branch protection or a ruleset.
- **Agent discipline**: MCP tools confine filesystem access to configured
  roots; secret values are redacted in every response; an agent cannot commit
  or push through the server.

### Trust assumptions

- The Veylqorix binary, its scanners, and the scanner advisory databases
  (npm advisory DB, OSV, PyPI) are trusted inputs. A compromised advisory
  source can produce false findings but not suppress real ones.
- Local hooks run in the developer's context and can be bypassed by a
  determined actor (`VEYLQORIX_OVERRIDE=1`, `git commit --no-verify`). This is
  why GitHub-side enforcement is the boundary.

### Secrets handling

- Secret scanner matches are redacted (`AKIA…CDEF (20 chars, redacted)`) in
  JSON, Markdown, SARIF, API responses, and the dashboard.
- Veylqorix never writes secret values to logs.
- Test fixtures contain only fake, well-known placeholder values.

### Least privilege

- MCP server: `VEYLQORIX_ROOTS` (required — without it the server
  refuses to start, no current-directory fallback) restricts every
  tool to authorized directories; paths are canonicalized and checked
  for `..` traversal and symlink escapes.
- API: `VEYLQORIX_ALLOWED_ROOTS` (optional) restricts which repositories can be
  registered; the API binds to `127.0.0.1` by default, and a
  non-loopback `VEYLQORIX_API_HOST` without `VEYLQORIX_API_TOKEN`
  refuses to start. With a token, every `/api` route except
  `GET /api/health` requires a bearer token (timing-safe check);
  CORS is an exact-origin allowlist (`VEYLQORIX_CORS_ORIGINS`),
  never a wildcard.
- GitHub workflow: `contents: read` + `security-events: write` only; no
  secrets are forwarded into the called workflow.

### What the store file contains

API state (repositories, scan records, findings) persists to
`VEYLQORIX_STORE_PATH` (default `./.veylqorix-store.json`). The file
holds repository paths + names, scan metadata (status, timing, exit
code), and redacted findings only — matched secret values are
masked before they enter a finding (`redactSecret` in
`packages/core/src/scanners/secrets.ts`), so no plaintext secret
value is written to the store, logs, or any output. The store is
single-process; two API processes sharing one file will lose
interleaved writes. Scans still `RUNNING` when a process exits are
re-stamped `INTERRUPTED` on the next start — never completed.

## Known limitations

- Regex secret detection has false positives (low confidence) and false
  negatives (unknown formats); it complements Gitleaks, it does not replace it.
- Offline dependency scans cannot see CVEs published after the last advisory
  pull.
- License scanning is a manifest-level check, not a transitive license audit.
- A clean lint is not a security certification.

## Responsible disclosure

Report security vulnerabilities in Veylqorix privately via the project's
security email or an unlisted GitHub private vulnerability report. Do not open
a public issue describing an active exploit.
