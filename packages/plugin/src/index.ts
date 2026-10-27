/**
 * @veylqorix/plugin — scanner extension SDK for the Veylqorix security core.
 *
 * Author custom scanners and quality checks that plug into `runAudit`:
 *
 *   import { definePlugin, toAuditOptions, runPluginAudit } from '@veylqorix/plugin';
 *   import { runAudit } from '@veylqorix/core';
 *
 *   const myPlugin = definePlugin({
 *     id: 'acme/sast',
 *     scanners: [
 *       {
 *         id: 'acme-sast',
 *         run: async (ctx) => {
 *           const { stdout } = await ctx.exec('semgrep', ['run', '-o', 'json'], {
 *             cwd: ctx.root,
 *             timeoutMs: ctx.timeoutMs,
 *           });
 *           return [{
 *             scanner: 'acme-sast',
 *             ruleId: 'insecure-random',
 *             title: 'Math.random used for security-sensitive value',
 *             severity: 'MEDIUM',
 *             confidence: 'HIGH',
 *             file: 'src/util.ts',
 *             // no `id` needed — the bridge assigns the deterministic one
 *           }];
 *         },
 *       },
 *     ],
 *   });
 *
 *   // Either drive the audit yourself:
 *   const result = await runAudit(toAuditOptions({ root: '/repo' }, myPlugin));
 *
 *   // Or use the convenience runner:
 *   const result = await runPluginAudit({ root: '/repo' }, myPlugin);
 *
 * Plugin evidence is normalized into the core's finding schema and fed to the
 * authoritative gate (Rust engine when present, byte-compatible TypeScript
 * engine otherwise). A plugin that errors or times out degrades coverage to
 * INCOMPLETE (exit 2) — it can never produce a silent pass.
 */
import {
  runAudit,
  type AuditOptions,
  type AuditResultWithExit,
} from '@veylqorix/core';
import { toAuditOptions, withPlugin } from './bridge.js';
import { definePlugin } from './define.js';
import { PluginValidationError } from './errors.js';
import type {
  ExecFileFn,
  ExecOptions,
  ExecResult,
} from './exec.js';
import type {
  Plugin,
  PluginCheck,
  PluginCheckContext,
  PluginFinding,
  PluginScanner,
  PluginScannerContext,
  PluginScannerResult,
} from './types.js';

export { definePlugin, toAuditOptions, withPlugin, PluginValidationError };
export type {
  Plugin,
  PluginScanner,
  PluginScannerContext,
  PluginScannerResult,
  PluginFinding,
  PluginCheck,
  PluginCheckContext,
  ExecFileFn,
  ExecOptions,
  ExecResult,
};
export { execFileAsync, createExec } from './exec.js';

/**
 * Run a full `runAudit` with one or more plugins applied. The base options
 * must include `root`; plugin scanners/checks are merged in additively.
 */
export async function runPluginAudit(
  base: Omit<AuditOptions, 'externalScanners' | 'externalChecks'>,
  ...plugins: Plugin[]
): Promise<AuditResultWithExit> {
  const options = withPlugin(base as AuditOptions, ...plugins);
  return runAudit(options);
}
