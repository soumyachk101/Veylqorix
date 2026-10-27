/**
 * Bridge a `Plugin` into `runAudit` options.
 *
 * The two adapters here are the whole contract between the SDK and the core:
 *
 *  - `PluginScanner`  → core `ScannerDefinition` (the `externalScanners` slot).
 *    The plugin's `run` is wrapped so that (a) it receives a context with a
 *    shell-free `exec`, and (b) a bare `Finding[]` return value is normalized
 *    into a `ScannerResult` through the core's own `normalizeFindings` — so
 *    plugin findings get the same deterministic ids, severity/confidence
 *    clamping, and malformed-entry rejection as built-in scanners.
 *
 *  - `PluginCheck`    → core `ExternalCheck` (the `externalChecks` slot).
 *    Its `run` is wrapped to receive an exec-capable context; the core's safe
 *    wrapper turns a thrown error or overrun timeout into an `ERROR` check.
 *
 * Neither path re-implements the gate: the evidence simply flows into
 * `runAudit`, which hands it to the authoritative gate.
 */
import {
  normalizeFindings,
  type AuditOptions,
  type ExternalCheck,
  type ScannerDefinition,
  type ScannerContext,
  type CheckResult,
  type ProjectDetection,
  type ScannerResult,
} from '@veylqorix/core';
import { createExec, type ExecFileFn } from './exec.js';
import type {
  Plugin,
  PluginCheckContext,
  PluginFinding,
  PluginScannerContext,
  PluginScannerResult,
} from './types.js';

export type { ExecFileFn };

const sharedExec = createExec();

/** Build the context handed to a plugin scanner's `run`. */
function pluginScannerContext(ctx: ScannerContext): PluginScannerContext {
  return {
    root: ctx.root,
    detection: ctx.detection,
    timeoutMs: ctx.timeoutMs,
    offline: ctx.offline,
    exec: sharedExec,
  };
}

/** Build the context handed to a plugin check's `run`. */
function pluginCheckContext(
  root: string,
  detection: ProjectDetection,
  timeoutMs: number,
  offline: boolean,
): PluginCheckContext {
  return { root, detection, timeoutMs, offline, exec: sharedExec };
}

/**
 * Adapt one plugin scanner into a core `ScannerDefinition`. The scanner's
 * `run` may return either a `PluginScannerResult` or a bare `PluginFinding[]`;
 * the array form is normalized into a `ScannerResult` (empty ⇒ PASS,
 * non-empty ⇒ FAIL) through the core's `normalizeFindings`, so ids and field
 * validation match the built-in scanners exactly.
 */
function toScannerDefinition(scanner: Plugin['scanners'][number]): ScannerDefinition {
  const id = scanner.id;
  return {
    name: id,
    mandatory: scanner.mandatory === true,
    run: async (ctx) => {
      const result = await scanner.run(pluginScannerContext(ctx));
      // A bare PluginFinding[] return is normalized here.
      if (Array.isArray(result)) {
        return normalizeScannerFindings(id, result);
      }
      // A full PluginScannerResult: ensure the name is stable, notes exist, and
      // any bare findings inside are normalized for deterministic ids.
      return normalizeScannerResult(id, result);
    },
  };
}

/** Normalize a plugin scanner's bare `PluginFinding[]` into a `ScannerResult`. */
function normalizeScannerFindings(id: string, raw: PluginFinding[]): ScannerResult {
  const { findings, rejected } = normalizeFindings(id, raw);
  const notes: string[] = [];
  if (rejected > 0) {
    notes.push(
      `Plugin scanner '${id}': ${rejected} malformed finding(s) were dropped to protect the report.`,
    );
  }
  const status: ScannerResult['status'] = findings.length > 0 ? 'FAIL' : 'PASS';
  return {
    scanner: id,
    status,
    findings,
    durationMs: 0,
    notes: findings.length > 0 ? notes : [...notes, 'No findings.'],
  };
}

/** Normalize a full `PluginScannerResult`: stable name, notes, and ids. */
function normalizeScannerResult(id: string, result: PluginScannerResult): ScannerResult {
  const normalized = normalizeFindings(id, result.findings ?? []);
  const notes: string[] = [...(result.notes ?? [])];
  if (normalized.rejected > 0) {
    notes.push(
      `Plugin scanner '${id}': ${normalized.rejected} malformed finding(s) were dropped to protect the report.`,
    );
  }
  const status: ScannerResult['status'] =
    result.status ?? (normalized.findings.length > 0 ? 'FAIL' : 'PASS');
  const out: ScannerResult = {
    scanner: result.scanner || id,
    status,
    findings: normalized.findings,
    durationMs: result.durationMs ?? 0,
    notes,
  };
  if (result.error) out.error = result.error;
  if (result.summary !== undefined) out.summary = result.summary;
  return out;
}

/** Adapt one plugin check into a core `ExternalCheck`. */
function toExternalCheck(check: Plugin['checks'][number]): ExternalCheck {
  const id = check.id;
  const command = check.command;
  return {
    id,
    command,
    run: async (ctx) => {
      const result = await check.run(
        pluginCheckContext(ctx.root, ctx.detection, ctx.timeoutMs, ctx.offline),
      );
      // Normalize a partial/failed check result into a well-formed CheckResult.
      const status: CheckResult['status'] = result?.status ?? 'PASS';
      const out: CheckResult = {
        id,
        command: result?.command ?? command ?? `${id} (plugin check)`,
        status,
        durationMs: result?.durationMs ?? 0,
      };
      if (result?.output !== undefined) out.output = result.output;
      if (result?.error) out.error = result.error;
      if (result?.reason !== undefined) out.reason = result.reason;
      return out;
    },
  };
}

/**
 * Produce the `runAudit` options fragment a plugin contributes: the
 * `externalScanners` / `externalChecks` slots plus any caller overrides.
 * Spread the result into `runAudit(options)`:
 *
 *   const options = toAuditOptions({ root, ...other }, myPlugin);
 *   const result = await runAudit(options);
 */
export function toAuditOptions(
  base: Omit<AuditOptions, 'externalScanners' | 'externalChecks'>,
  ...plugins: Plugin[]
): AuditOptions {
  const externalScanners: ScannerDefinition[] = [];
  const externalChecks: ExternalCheck[] = [];
  for (const plugin of plugins) {
    for (const s of plugin.scanners) externalScanners.push(toScannerDefinition(s));
    for (const c of plugin.checks) externalChecks.push(toExternalCheck(c));
  }
  return { ...base, externalScanners, externalChecks };
}

/**
 * Convenience wrapper: take an existing `AuditOptions` and append the
 * contributions of one or more plugins, merging with any `externalScanners` /
 * `externalChecks` the caller already set (deduplicated by scanner/check id).
 */
export function withPlugin(
  options: AuditOptions,
  ...plugins: Plugin[]
): AuditOptions {
  const contributed = toAuditOptions(options, ...plugins);
  const contributedScanners = contributed.externalScanners ?? [];
  const contributedChecks = contributed.externalChecks ?? [];
  const seenScanners = new Set((options.externalScanners ?? []).map((s) => s.name));
  const seenChecks = new Set((options.externalChecks ?? []).map((c) => c.id));
  return {
    ...options,
    externalScanners: [
      ...(options.externalScanners ?? []),
      ...contributedScanners.filter((s) => !seenScanners.has(s.name)),
    ],
    externalChecks: [
      ...(options.externalChecks ?? []),
      ...contributedChecks.filter((c) => !seenChecks.has(c.id)),
    ],
  };
}
