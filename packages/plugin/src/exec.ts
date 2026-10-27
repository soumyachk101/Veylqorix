/**
 * Shell-free execution helper exposed to plugin scanners/checks.
 *
 * Delegates to the core's `execFileAsync` so plugins inherit exactly the
 * guarantees the core provides: no shell (no argument interpolation /
 * injection), a hard timeout that SIGKILLs the child, and output capping.
 * A plugin that wants to run a tool gets the same safety surface as the
 * built-in scanners rather than a raw `child_process` handle.
 */
import {
  execFileAsync,
  type ExecOptions,
  type ExecResult,
} from '@veylqorix/core';

export { execFileAsync, type ExecOptions, type ExecResult };

/** The executor signature handed to plugin scanners/checks. `(file, args)` —
 *  never a shell string. Options are the core's `ExecOptions` (cwd,
 *  timeoutMs, env, maxOutputKb). */
export type ExecFileFn = (
  file: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** Build a bound executor for use in a plugin context. */
export function createExec(): ExecFileFn {
  return (file, args, options) => execFileAsync(file, args, options);
}
