# Plugin SDK (`@veylqorix/plugin`)

`@veylqorix/plugin` is the **scanner extension SDK** for the Veylqorix
security core. It lets a team add its own scanners and quality checks —
wrapping an in-house SAST tool, an SBOM policy check, a coverage gate, or a
house rule — and have that evidence flow into the same audit, the same
finding schema, and the same deterministic gate as the built-in scanners.

Plugins are **purely additive**: they contribute evidence; they never
re-implement the gate and never touch a raw audit. The gate stays
authoritative and single-sourced (the Rust engine when its binary is
available, the byte-compatible TypeScript engine otherwise).

## Guarantees

- **No silent passes.** A plugin scanner that throws or overruns its
  timeout is wrapped by the core's safe scanner runner and recorded as an
  `ERROR` result. An errored/failed plugin check is likewise a first-class
  gate input. Under the **default** policy (`blockOnScannerError` and
  `blockOnSkippedCheck` both `true`, `packages/core/src/policy.ts`) an
  `ERROR` check or scanner **hard-fails the gate** — `FAIL`, exit `1`
  (see `packages/core/src/gate/index.ts`). Only when the corresponding
  `blockOnScannerError` / `blockOnSkippedCheck` flags are disabled does the
  gap instead degrade coverage to `INCOMPLETE` (exit `2`). A *skipped*
  mandatory scanner is a completeness gap, not a content violation: under
  the strict flags it is reported but leaves the gate `INCOMPLETE`,
  never a silent pass.
- **Normalized findings.** Findings returned by plugin scanners go through
  the core's `normalizeFindings`: deterministic ids, severity/confidence
  clamping, malformed entries dropped and counted. The id algorithm is
  identical to the built-in scanners, so report diffs stay stable.
- **Shell-free execution.** The context handed to a plugin includes `exec`,
  the core's `execFileAsync` — no shell, hard timeout, capped output.
  Plugins never get a raw `child_process` handle.
- **Redaction is the author's job.** Reports trust that findings arrive
  already redacted (the built-in secret scanner redacts at the source). A
  plugin that detects secrets must mask values before emitting them — use
  `redactSecret` from `@veylqorix/core` — and set `secret: true` so the
  gate's `blockOnSecrets` applies.
- **Opt-in mandatory.** Plugin scanners default to `mandatory: false`, so a
  *missing* optional plugin tool does not create the same completeness gap
  as a missing built-in one. Set `mandatory: true` only when the check must
  run for coverage to be considered complete.
- **Additive, not overriding.** Plugin scanners/checks run alongside the
  built-ins; `onlyScanners`/`skipScanners` never filter plugin scanners
  away, and `skipQualityChecks` also skips plugin checks (keeps "no check
  evidence reaches the gate" true).

## Quick start

```ts
import { definePlugin, runPluginAudit } from '@veylqorix/plugin';

const myPlugin = definePlugin({
  id: 'acme/security',
  version: '1.0.0',
  description: 'In-house SAST + coverage checks',
  scanners: [
    {
      // Run an external tool; the context gives you root + a safe exec.
      id: 'acme-sast',
      run: async (ctx) => {
        const { code, stdout } = await ctx.exec('semgrep', ['run', '--json', 'rules/'], {
          cwd: ctx.root,
          timeoutMs: ctx.timeoutMs,
        });
        if (code === 127) {
          // Honest degradation: tool missing → SKIPPED, never PASS.
          return {
            scanner: 'acme-sast',
            status: 'SKIPPED',
            findings: [],
            durationMs: 0,
            notes: ['semgrep is not installed; install it to enable this scanner.'],
          };
        }
        // Or return raw findings — they are normalized for you
        // (ids assigned, bad entries dropped).
        const report = JSON.parse(stdout);
        return (report.results ?? []).map((r) => ({
          scanner: 'acme-sast',
          ruleId: r.check_id,
          title: `${r.path}:${r.start.line} — ${r.extra.message}`,
          severity: 'MEDIUM',
          confidence: 'HIGH',
          file: r.path,
          line: r.start.line,
          remediation: r.extra.message,
        }));
      },
    },
  ],
  checks: [
    {
      id: 'coverage-floor',
      command: 'node scripts/check-coverage.mjs',
      run: async (ctx) => {
        const { code } = await ctx.exec('node', ['scripts/check-coverage.mjs'], {
          cwd: ctx.root,
          timeoutMs: ctx.timeoutMs,
        });
        return {
          id: 'coverage-floor',
          command: 'node scripts/check-coverage.mjs',
          status: code === 0 ? 'PASS' : 'FAIL',
          durationMs: 0,
        };
      },
    },
  ],
});

const result = await runPluginAudit({ root: '/path/to/repo', online: false }, myPlugin);
console.log(result.gate.result); // 'PASS' | 'FAIL' | 'INCOMPLETE'
process.exit(result.exitCode);    // 0 · 1 · 2
```

Prefer to drive `runAudit` yourself? `toAuditOptions` and `withPlugin` give
you the raw options fragment:

```ts
import { runAudit } from '@veylqorix/core';
import { toAuditOptions } from '@veylqorix/plugin';

const result = await runAudit(toAuditOptions({ root, policy: myPolicy }, myPlugin));
```

## API reference

| Export | What it does |
|--------|--------------|
| `definePlugin(input)` | Validates and freezes a plugin definition. Fails fast with `PluginValidationError` on a missing/blank id or a scanner/check without a `run` function. |
| `toAuditOptions(base, ...plugins)` | Returns `runAudit` options with each plugin's scanners mapped to `externalScanners` and its checks to `externalChecks`. |
| `withPlugin(options, ...plugins)` | Appends plugin contributions to an existing `AuditOptions`, deduplicating by scanner/check id. |
| `runPluginAudit(base, ...plugins)` | `runAudit(withPlugin(base, ...plugins))` — the common path in one call. |
| `createExec()` / `execFileAsync` | The shell-free executor (core `execFileAsync` re-export). Rejects with `ExecError` on spawn failure; resolves `timedOut: true` on deadline. |
| `PluginValidationError` | Thrown by `definePlugin` for invalid definitions. |

### `Plugin` shape

```ts
interface Plugin {
  id: string;                    // required, non-empty
  version?: string;
  description?: string;
  scanners: PluginScanner[];
  checks: PluginCheck[];
}

interface PluginScanner {
  id: string;                    // scanner/registry id, e.g. 'acme-sast'
  mandatory?: boolean;           // default false (see "Opt-in mandatory")
  run(ctx: PluginScannerContext): Promise<ScannerResult | Finding[]>;
}

interface PluginCheck {
  id: string;
  command?: string;              // informational, shown in reports
  run(ctx: PluginCheckContext): Promise<CheckResult>;
}
```

`PluginScannerContext` / `PluginCheckContext` carry `root`, `detection`,
`timeoutMs`, `offline`, and `exec`.

## What a plugin must not do

- **Weaken the gate.** There is no API surface for raising thresholds or
  suppressing findings — that stays with the committed policy file and its
  auditable, capped, expirable exceptions.
- **Return PASS-shaped results for a check that could not run.** Missing
  tool → `SKIPPED` + note; crash → let it throw (the core records `ERROR`).
  A scanner that cannot run must never be reported as clean.
- **Emit live secret values.** Redact before the finding leaves the
  scanner, in every field (`snippet`, `details`, `remediation`).

## Status

`@veylqorix/plugin` ships inside the monorepo (`packages/plugin`), builds
with `pnpm build`, and is covered by `pnpm test`
(`packages/plugin/src/plugin.test.ts` plus the core regression suite in
`packages/core/src/audit-external.test.ts`). Not yet published to npm;
consume it from source (`workspace:*`) until publish.
