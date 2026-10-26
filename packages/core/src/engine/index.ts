/**
 * Rust security-engine adapter.
 *
 * The engine is a native binary that speaks a single-line JSON-over-stdio
 * protocol (PROTOCOL_VERSION 1). It is the authority for the secret scanner
 * and the quality-gate decision when it is available; when it is not, the
 * TypeScript core degrades to its own byte-compatible scanners and policy
 * engine and labels that honestly.
 *
 * Wire contract (see `crates/veylqorix-engine/src/protocol.rs`):
 * - one JSON request document on stdin, one JSON response document on stdout
 * - exit 0: a response was written; the gate decision is IN the response
 * - exit 64: malformed request / unsupported protocol
 * - exit 65: audit root missing
 * - exit 70: engine internal error
 *
 * A scanner failing *inside* a scan never causes a non-zero exit: it is a
 * SKIPPED/ERROR scanner result in the response, so a failure can never be
 * read as a pass.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CheckResult,
  Finding,
  GateDecision,
  ProjectDetection,
  ScannerResult,
} from '../types.js';

/** The protocol version this adapter speaks. */
export const PROTOCOL_VERSION = 1;

/** Byte cap for a single engine response document (mirrors the engine's output cap). */
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Headroom added to the per-tool `timeoutMs` to form the adapter's overall
 * wall-clock budget. The engine runs up to two external tools sequentially
 * (optional gitleaks, optional cargo audit) each bounded by `timeoutMs`; this
 * margin keeps a legitimately-timed-out tool from being killed mid-report by
 * the wall clock and misclassified as an adapter timeout.
 */
export const WALL_CLOCK_OVERHEAD_MS = 30_000;

/** The exit codes the engine uses for out-of-band protocol errors. */
export const ENGINE_EXIT = {
  OK: 0,
  MALFORMED: 64,
  ROOT_NOT_FOUND: 65,
  INTERNAL: 70,
} as const;

/* ------------------------------------------------------------------------ *
 * Response / request wire types
 * ------------------------------------------------------------------------ */

export interface EngineResponse {
  protocolVersion: number;
  engineVersion: string;
  schemaVersion: number;
  ok: boolean;
  gate?: GateDecision;
  exitCode?: number;
  strictExitCode?: number;
  findings?: Finding[];
  engineScannerResults?: ScannerResult[];
  notes: string[];
}

export interface EngineScanOptions {
  root: string;
  detection?: ProjectDetection;
  /** The resolved policy object (or a partial) to hand to the engine. */
  policy?: unknown;
  stagedFiles?: string[];
  /** Orchestrator quality-check results to merge into the gate (default: none). */
  checks?: CheckResult[];
  /** Orchestrator-side findings (dependency findings, ...) to merge into the gate. */
  findings?: Finding[];
  /** Completed orchestrator scanner results (dependency + license) to merge. */
  scannerResults?: ScannerResult[];
  strict?: boolean;
  preferGitleaks?: boolean;
  timeoutMs?: number;
  scanId?: string;
}

export interface EngineEvaluateOptions {
  policy?: unknown;
  findings?: Finding[];
  scannerResults?: ScannerResult[];
  checks?: CheckResult[];
  strict?: boolean;
  timeoutMs?: number;
}

/* ------------------------------------------------------------------------ *
 * Error types — structured, never ambiguous
 * ------------------------------------------------------------------------ */

/** Base class for every engine failure. */
export class EngineError extends Error {
  /** The resolved binary path this failure originated from, when known. */
  readonly binaryPath?: string;
  constructor(message: string, binaryPath?: string) {
    super(message);
    this.name = 'EngineError';
    this.binaryPath = binaryPath;
  }
}

/** The engine binary could not be located or executed. */
export class EngineUnavailableError extends EngineError {
  readonly reason: 'not-found' | 'spawn-failed' | 'invalid-path';
  constructor(message: string, reason: EngineUnavailableError['reason'], binaryPath?: string) {
    super(message, binaryPath);
    this.name = 'EngineUnavailableError';
    this.reason = reason;
  }
}

/** The engine exited with a protocol error code (64/65/70) without a response. */
export class EngineProtocolError extends EngineError {
  readonly exitCode: number;
  /** The stderr reason, when the engine printed one. */
  readonly reason?: string;
  constructor(message: string, exitCode: number, reason?: string, binaryPath?: string) {
    super(message, binaryPath);
    this.name = 'EngineProtocolError';
    this.exitCode = exitCode;
    this.reason = reason;
  }
}

/** The engine ran to completion but produced no parseable/valid response. */
export class EngineResponseError extends EngineError {
  readonly kind: 'not-json' | 'protocol-version' | 'empty';
  constructor(message: string, kind: EngineResponseError['kind'], binaryPath?: string) {
    super(message, binaryPath);
    this.name = 'EngineResponseError';
    this.kind = kind;
  }
}

/** The engine did not finish within the wall-clock budget. */
export class EngineTimeoutError extends EngineError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, binaryPath?: string) {
    super(`Engine did not complete within ${timeoutMs}ms`, binaryPath);
    this.name = 'EngineTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/* ------------------------------------------------------------------------ *
 * Binary resolution
 * ------------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the engine binary.
 *
 * Order:
 * 1. `VEYLQORIX_ENGINE` env var, when set to an existing file.
 * 2. Walk up from the given start directory (default `process.cwd()`) to
 *    find a directory containing `crates/Cargo.toml`, then
 *    `crates/target/release/veylqorix-engine`, then
 *    `crates/target/debug/veylqorix-engine`.
 * 3. Fall back to a walk up from the package source location so the resolved
 *    path works when the package is consumed from `dist/` as well.
 *
 * Returns `undefined` when no usable binary is found.
 */
export function resolveEngineBinary(startDir?: string): string | undefined {
  const explicit = process.env.VEYLQORIX_ENGINE;
  if (explicit) {
    try {
      if (fs.statSync(explicit).isFile()) return explicit;
    } catch {
      return undefined;
    }
  }

  const candidates = new Set<string>();
  const roots: string[] = [];
  if (startDir) roots.push(startDir);
  roots.push(process.cwd());
  // The dist/ layout is one level above src/; walk from the package root too.
  roots.push(path.resolve(here, '..'));
  roots.push(path.resolve(here, '..', '..'));

  for (const root of roots) {
    let dir: string | undefined = root;
    // Bounded upward walk so a deep cwd can never loop forever.
    for (let i = 0; i < 12 && dir; i++) {
      const manifest = path.join(dir, 'crates', 'Cargo.toml');
      if (fs.existsSync(manifest)) {
        candidates.add(path.join(dir, 'crates', 'target', 'release', 'veylqorix-engine'));
        candidates.add(path.join(dir, 'crates', 'target', 'debug', 'veylqorix-engine'));
      }
      dir = path.dirname(dir);
      if (dir === path.dirname(dir)) break; // reached filesystem root
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

const binaryCache = new Map<string, string | undefined>();

/**
 * Whether a usable engine binary can be resolved right now. Callers (tests,
 * reports) use this to be honest about the engine's availability instead of
 * faking a result.
 */
export function isEngineAvailable(): boolean {
  const key = process.env.VEYLQORIX_ENGINE ?? '';
  if (binaryCache.has(key)) return binaryCache.get(key) !== undefined;
  const found = resolveEngineBinary();
  binaryCache.set(key, found);
  return found !== undefined;
}

/* ------------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------------ */

export interface RustEngineAdapterOptions {
  /** Pin a specific binary path instead of the env-var + walk resolution. */
  binaryPath?: string;
  /** The directory to start the upward binary walk from (default: process.cwd()). */
  startDir?: string;
}

export class RustEngineAdapter {
  private readonly binaryPath?: string;
  private readonly startDir?: string;

  constructor(options: RustEngineAdapterOptions = {}) {
    this.startDir = options.startDir;
    if (options.binaryPath) {
      this.binaryPath = options.binaryPath;
    } else if (process.env.VEYLQORIX_ENGINE) {
      this.binaryPath = process.env.VEYLQORIX_ENGINE;
    } else {
      this.binaryPath = resolveEngineBinary(this.startDir);
    }
  }

  /** The resolved binary, or `undefined` when no engine is available. */
  get available(): boolean {
    if (!this.binaryPath) return false;
    try {
      return fs.statSync(this.binaryPath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Perform one engine round-trip: spawn the binary, write one JSON request
   * line to its stdin, and read one JSON response line from its stdout under
   * a byte cap and a wall-clock timeout. Error classification:
   * - spawn ENOENT / unusable binary  -> EngineUnavailableError
   * - exit 64/65/70                   -> EngineProtocolError (with the code)
   * - exit 0 with unparseable JSON, a response that is not valid engine JSON,
   *   or a protocolVersion mismatch -> EngineProtocolError (never a silent
   *   fallback to the TypeScript gate)
   * - wall-clock timeout              -> EngineTimeoutError
   */
  async request(request: Record<string, unknown>): Promise<EngineResponse> {
    if (!this.binaryPath) {
      throw new EngineUnavailableError('No engine binary could be resolved', 'not-found');
    }
    const binary = this.binaryPath;

    const rawTimeout = (request.args as { timeoutMs?: unknown } | undefined)?.timeoutMs;
    const perToolMs =
      typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0
        ? rawTimeout
        : 120_000;
    // Overall wall-clock budget = per-tool budget + headroom (the engine may
    // run more than one external tool sequentially). This is the budget the
    // timeout errors report.
    const timeoutMs = perToolMs + WALL_CLOCK_OVERHEAD_MS;

    return await new Promise<EngineResponse>((resolve, reject) => {
      let settled = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        reject(
          new EngineUnavailableError(
            `Failed to spawn engine: ${String(error instanceof Error ? error.message : error)}`,
            'spawn-failed',
            binary,
          ),
        );
        return;
      }
      if (!child.stdin || !child.stdout || !child.stderr) {
        reject(
          new EngineUnavailableError('Engine spawned without the expected stdio pipes', 'spawn-failed', binary),
        );
        return;
      }
      let stdout = '';
      let stdoutBytes = 0;
      let stderr = '';
      let timer: NodeJS.Timeout | undefined;
      let timedOut = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        finish(() => reject(new EngineTimeoutError(timeoutMs, binary)));
      }, timeoutMs);

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error.code === 'ENOENT') {
            reject(new EngineUnavailableError(`Engine binary not found: ${binary}`, 'not-found', binary));
          } else {
            reject(
              new EngineUnavailableError(
                `Failed to spawn engine: ${error.message}`,
                'spawn-failed',
                binary,
              ),
            );
          }
        });
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_RESPONSE_BYTES) {
          // Over the cap: stop buffering and fail the round-trip. An oversized
          // response is structurally unreliable, and a failure can never be
          // read as a pass.
          finish(() =>
            reject(
              new EngineProtocolError(
                `Engine response exceeded the ${MAX_RESPONSE_BYTES}-byte cap`,
                ENGINE_EXIT.INTERNAL,
                undefined,
                binary,
              ),
            ),
          );
          return;
        }
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 8192) stderr += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        const exit = code ?? -1;
        if (timedOut) {
          finish(() => reject(new EngineTimeoutError(timeoutMs, binary)));
          return;
        }
        if (exit !== ENGINE_EXIT.OK) {
          // Protocol error codes carry out-of-band reasons on stderr; any
          // other non-zero code is reported as a protocol failure too, so a
          // failed engine run is never read as a pass.
          const reason = stderr.trim() || undefined;
          finish(() => {
            if (exit === ENGINE_EXIT.MALFORMED) {
              reject(new EngineProtocolError('Engine rejected the request as malformed', exit, reason, binary));
            } else if (exit === ENGINE_EXIT.ROOT_NOT_FOUND) {
              reject(new EngineProtocolError('Engine could not find the audit root', exit, reason, binary));
            } else if (exit === ENGINE_EXIT.INTERNAL) {
              reject(new EngineProtocolError('Engine hit an internal error', exit, reason, binary));
            } else {
              reject(new EngineProtocolError(`Engine exited with code ${exit}`, exit, reason, binary));
            }
          });
          return;
        }
        const trimmed = stdout.trim();
        if (trimmed.length === 0) {
          finish(() =>
            reject(new EngineProtocolError('Engine exited 0 but wrote no response', exit, undefined, binary)),
          );
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          finish(() =>
            reject(
              new EngineProtocolError('Engine response was not valid JSON', exit, undefined, binary),
            ),
          );
          return;
        }
        const response = parsed as EngineResponse;
        if (response.protocolVersion !== PROTOCOL_VERSION) {
          finish(() =>
            reject(
              new EngineProtocolError(
                `Protocol version mismatch: engine speaks ${String(response.protocolVersion)}, adapter speaks ${PROTOCOL_VERSION}`,
                exit,
                undefined,
                binary,
              ),
            ),
          );
          return;
        }
        if (!response.ok || typeof response.protocolVersion !== 'number') {
          finish(() =>
            reject(
              new EngineProtocolError(
                `Engine response was not valid: ${response.notes?.[0] ?? '(unparseable shape)'}`,
                exit,
                response.notes?.[0],
                binary,
              ),
            ),
          );
          return;
        }
        finish(() => resolve(response));
      });

      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        // EPIPE can fire when the child exits early; the close handler owns
        // the result, so only fail fast here when we have not settled yet.
        if (error.code !== 'EPIPE' && !settled) {
          finish(() =>
            reject(
              new EngineUnavailableError(
                `Failed to write request to engine: ${error.message}`,
                'spawn-failed',
                binary,
              ),
            ),
          );
        }
      });
      child.stdin.end(JSON.stringify(request) + '\n');
    });
  }

  /** Handshake: no work, just version reporting. */
  async ping(): Promise<EngineResponse> {
    return this.request({ protocolVersion: PROTOCOL_VERSION, command: 'ping', args: {} });
  }

  /**
   * Run the engine's built-in scanners (secret scan, optional cargo audit /
   * gitleaks) and evaluate the gate over their results plus the supplied
   * orchestrator evidence.
   */
  async engineScan(options: EngineScanOptions): Promise<EngineResponse> {
    const isRust = options.detection?.ecosystem === 'rust';
    const args: Record<string, unknown> = {
      root: options.root,
      detection: options.detection,
      policy: options.policy,
      stagedFiles: options.stagedFiles,
      checks: options.checks ?? [],
      findings: options.findings ?? [],
      scannerResults: options.scannerResults ?? [],
      strict: options.strict ?? false,
      runSecrets: true,
      // cargo audit and the engine's Rust dependency scanner only apply to
      // Rust projects; the engine records SKIPPED honestly for other trees.
      runCargoAudit: isRust,
      preferGitleaks: options.preferGitleaks ?? false,
      timeoutMs: options.timeoutMs,
      scanId: options.scanId,
    };
    // Keep the request lean: drop undefined values so the engine sees clean JSON.
    for (const key of Object.keys(args)) {
      if (args[key] === undefined) delete args[key];
    }
    return this.request({ protocolVersion: PROTOCOL_VERSION, command: 'scan', args });
  }

  /**
   * Gate-only evaluation over supplied evidence. No filesystem access on the
   * engine side; used when the orchestrator already ran its own scanners.
   */
  async engineEvaluate(options: EngineEvaluateOptions): Promise<EngineResponse> {
    const args: Record<string, unknown> = {
      policy: options.policy,
      findings: options.findings ?? [],
      scannerResults: options.scannerResults ?? [],
      checks: options.checks ?? [],
      strict: options.strict ?? false,
      timeoutMs: options.timeoutMs,
    };
    for (const key of Object.keys(args)) {
      if (args[key] === undefined) delete args[key];
    }
    return this.request({ protocolVersion: PROTOCOL_VERSION, command: 'evaluate', args });
  }
}

/** A convenience default adapter using env-var + walk resolution. */
export function createEngineAdapter(options?: RustEngineAdapterOptions): RustEngineAdapter {
  return new RustEngineAdapter(options);
}

export { MAX_RESPONSE_BYTES as ENGINE_MAX_RESPONSE_BYTES };
