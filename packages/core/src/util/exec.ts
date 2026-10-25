/**
 * Utilities for safely executing external scanner commands.
 *
 * Rules enforced here:
 * - No shell: always `execFile`/`spawn` with argument arrays.
 * - No untrusted input flows into command arguments: caller is responsible
 *   for constructing arguments from validated data only.
 * - Every execution carries a timeout; on timeout the child is killed and
 *   the result is classified ERROR, never PASS.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Cap on how many kilobytes of output are retained before truncation. */
  maxOutputKb?: number;
}

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly result?: ExecResult,
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

function truncate(text: string, maxKb: number): string {
  const maxBytes = maxKb * 1024;
  if (text.length <= maxBytes) return text;
  const marker = `\n... [truncated ${Math.ceil((text.length - maxBytes) / 1024)} KB of ${Math.ceil(text.length / 1024)} KB total] ...`;
  return text.slice(0, maxBytes) + marker;
}

/**
 * Execute a command without a shell. Resolves with an `ExecResult` on
 * completion; rejects with `ExecError` on spawn failure. Never resolves with
 * `timedOut: false` after the timeout has elapsed — a timed-out command
 * always yields `timedOut: true` so callers can classify it as ERROR.
 */
export function execFileAsync(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxOutputKb = options.maxOutputKb ?? 256;
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new ExecError(`Failed to spawn ${file}: ${(error as Error).message}`, 'ESPAWN'));
      return;
    }
    const started = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutputKb * 2 * 1024) stdout = stdout.slice(-maxOutputKb * 1024);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutputKb * 2 * 1024) stderr = stderr.slice(-maxOutputKb * 1024);
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      resolve({
        code,
        stdout: truncate(stdout, maxOutputKb),
        stderr: truncate(stderr, maxOutputKb),
        durationMs,
        timedOut,
      });
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ExecError(error.message, error.code ?? 'EUNKNOWN', undefined));
    });
    child.on('close', (code) => finish(code));
  });
}

/** Extract the last JSON object from mixed stdout/stderr output. */
export function extractJson(text: string): Record<string, unknown> | undefined {
  const cleaned = text.trim();
  if (cleaned === '') return undefined;
  // Try the whole text first.
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // fall through
  }
  // Find balanced braces from the last `{` that is the start of a complete object.
  const matches = [...cleaned.matchAll(/\{/g)].map((m) => m.index as number);
  for (let i = matches.length - 1; i >= 0; i--) {
    const start = matches[i];
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = start; j < cleaned.length; j++) {
      const c = cleaned.charAt(j);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, j + 1)) as Record<string, unknown>;
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
