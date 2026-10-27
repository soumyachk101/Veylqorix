/**
 * `definePlugin` — author and validate a Veylqorix plugin.
 *
 * Validation is strict and fails fast (throws `PluginValidationError`) so a
 * broken plugin is caught at authoring time, not mid-audit. The result is a
 * frozen, shape-checked `Plugin` value you hand to `toAuditOptions` /
 * `withPlugin`.
 */
import type { Plugin, PluginCheck, PluginScanner } from './types.js';
import { PluginValidationError } from './errors.js';

export interface DefinePluginInput {
  id: string;
  version?: string;
  description?: string;
  scanners?: PluginScanner[];
  checks?: PluginCheck[];
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginValidationError(
      `Plugin definition: '${field}' must be a non-empty string.`,
    );
  }
}

function assertRunFn(run: unknown, what: string): asserts run is (...args: unknown[]) => unknown {
  if (typeof run !== 'function') {
    throw new PluginValidationError(
      `Plugin definition: ${what} is missing a runnable 'run' function.`,
    );
  }
}

/** Validate and freeze a plugin definition. */
export function definePlugin(input: DefinePluginInput): Plugin {
  if (!input || typeof input !== 'object') {
    throw new PluginValidationError('definePlugin: input must be an object.');
  }
  assertNonEmptyString(input.id, 'id');

  const scanners: PluginScanner[] = [];
  for (const s of input.scanners ?? []) {
    if (!s || typeof s !== 'object') {
      throw new PluginValidationError(`Plugin '${input.id}': scanner entries must be objects.`);
    }
    assertNonEmptyString(s.id, `scanner '${s.id ?? '<missing>'}'.id`);
    assertRunFn(s.run, `scanner '${s.id}'`);
    scanners.push({
      id: s.id,
      mandatory: s.mandatory === true,
      run: s.run,
    });
  }

  const checks: PluginCheck[] = [];
  for (const c of input.checks ?? []) {
    if (!c || typeof c !== 'object') {
      throw new PluginValidationError(`Plugin '${input.id}': check entries must be objects.`);
    }
    assertNonEmptyString(c.id, `check '${c.id ?? '<missing>'}.id`);
    assertRunFn(c.run, `check '${c.id}'`);
    checks.push({
      id: c.id,
      command: typeof c.command === 'string' && c.command.trim().length > 0 ? c.command : undefined,
      run: c.run,
    });
  }

  const plugin: Plugin = {
    id: input.id,
    version: typeof input.version === 'string' ? input.version : undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    scanners: Object.freeze(scanners),
    checks: Object.freeze(checks),
  };
  return Object.freeze(plugin);
}
