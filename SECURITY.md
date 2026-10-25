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

- MCP server: `VEYLQORIX_ROOTS` restricts every tool to authorized
  directories; paths are canonicalized and checked for `..` traversal and
  symlink escapes.
- API: `VEYLQORIX_ALLOWED_ROOTS` (optional) restricts which repositories can be
  registered; the default API permissions are read-only.
- GitHub workflow: `contents: read` + `security-events: write` only; no
  secrets are forwarded into the called workflow.

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
