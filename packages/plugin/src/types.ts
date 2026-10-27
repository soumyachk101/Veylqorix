/**
 * Public types for the Veylqorix scanner extension SDK.
 *
 * A plugin is a *purely additive* extension of the audit: it contributes
 * custom scanners and/or custom quality checks that the core runs under its
 * own safe wrapper. Plugins never re-implement the gate and never see a raw
 * audit to mutate — they hand normalized evidence (findings / scanner results
 * / check results) to `runAudit`, which feeds it to the authoritative gate
 * (the Rust engine when present, else the byte-compatible TypeScript engine).
 *
 * This keeps the security invariant intact: a plugin that errors or times out
 * is recorded as an ERROR scanner/check result, which degrades coverage to
 * INCOMPLETE — it can never turn a bad scan into a clean pass.
 */
import type { ExecFileFn } from './exec.js';
import type {
  CheckResult,
  Finding,
  ProjectDetection,
  ScannerResult,
} from '@veylqorix/core';

/**
 * The context handed to a plugin scanner's `run` function. It mirrors the
 * core's `ScannerContext` but adds a shell-free `exec` helper so plugins can
 * run their own tools with the same timeout/output-capping rules the core
 * uses.
 */
export interface PluginScannerContext {
  /** Absolute path of the audited root. */
  root: string;
  /** Project detection for the audited root. */
  detection: ProjectDetection;
  /** Per-scanner timeout in milliseconds. */
  timeoutMs: number;
  /** True when the audit is running in offline mode. */
  offline: boolean;
  /**
   * Execute a command without a shell (no argument interpolation). Rejects
   * with `ExecError` on spawn failure; a timed-out command resolves with
   * `timedOut: true` so you can classify it as an ERROR result, never PASS.
   */
  exec: ExecFileFn;
}

/**
 * A finding a plugin scanner may emit. `id` is optional: when omitted, the
 * bridge assigns the deterministic id through the core's `normalizeFindings`
 * (the same algorithm the built-in scanners use), so authors never have to
 * compute finding ids themselves.
 */
export type PluginFinding = Omit<Finding, 'id'> & { id?: string };

/**
 * A scanner result a plugin scanner may return directly (in place of a bare
 * findings array). `findings` entries follow the {@link PluginFinding}
 * contract; the bridge normalizes them for stable ids and drops malformed
 * entries.
 */
export interface PluginScannerResult extends Omit<ScannerResult, 'findings'> {
  findings: PluginFinding[];
}

/**
 * A plugin-defined scanner. Its `run` returns either a fully-formed
 * `PluginScannerResult` or a bare array of `PluginFinding`s (normalized into
 * a scanner result for you — empty array ⇒ PASS, non-empty ⇒ FAIL).
 */
export interface PluginScanner {
  /** Stable scanner/registry id, e.g. `sast` or `myteam/sbom`. Must be non-empty. */
  id: string;
  /**
   * When `true`, the audit records a completeness gap if this scanner is
   * unavailable or errored, in addition to surfacing its findings. Defaults to
   * `false` so a *missing* optional plugin scanner is never treated the way a
   * missing built-in one is.
   */
  mandatory?: boolean;
  run(ctx: PluginScannerContext): Promise<PluginScannerResult | PluginFinding[]>;
}

/** The context handed to a plugin check's `run` function. */
export interface PluginCheckContext {
  /** Absolute path of the audited root. */
  root: string;
  /** Project detection for the audited root. */
  detection: ProjectDetection;
  /** Per-check timeout in milliseconds. */
  timeoutMs: number;
  /** True when the audit is running in offline mode. */
  offline: boolean;
  /** Shell-free command executor, same contract as on {@link PluginScannerContext}. */
  exec: ExecFileFn;
}

/**
 * A plugin-defined quality check. Its `run` returns a `CheckResult`; any
 * thrown error or overrun timeout is classified by the core as an `ERROR`
 * check (degraded coverage), never a pass.
 */
export interface PluginCheck {
  /** Stable check id, e.g. `coverage-check`. Must be non-empty. */
  id: string;
  /** Informational description of what the check runs; shown in reports. */
  command?: string;
  run(ctx: PluginCheckContext): Promise<CheckResult>;
}

/** A validated plugin definition. The arrays are frozen (readonly) — a
 *  `definePlugin` result is not meant to be mutated. */
export interface Plugin {
  /** Plugin id, e.g. `acme/review-scanners`. */
  id: string;
  /** Optional semantic version of the plugin. */
  version?: string;
  /** Optional short description, shown when listing plugins. */
  description?: string;
  /** Scanners contributed by the plugin (frozen). */
  scanners: readonly PluginScanner[];
  /** Quality checks contributed by the plugin (frozen). */
  checks: readonly PluginCheck[];
}
