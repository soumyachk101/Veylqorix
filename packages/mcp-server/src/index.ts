import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  runAudit,
  validatePath,
  type AuditOptions,
  type AuditResultWithExit,
  type CheckResult,
  type Finding,
  type Policy,
  type ScannerResult,
} from '@veylqorix/core';

export interface McpServerOptions {
  /** Absolute workspace roots that tools may access. */
  roots: string[];
  /** Per-scanner / per-check timeout in milliseconds. */
  timeoutMs?: number;
  /** Run external scanners; false forces offline mode. */
  online?: boolean;
}

const SCANNER_NAMES = ['dependencies', 'secrets', 'licenses'] as const;
const SEVERITY_NAMES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Upper bounds so a single tool call can never return an unbounded payload. */
const DEFAULT_FINDING_LIMIT = 100;
const MAX_FINDING_LIMIT = 500;
const MAX_FINDINGS_PER_RESPONSE = 200;
const MAX_TEXT_CHARS = 60_000;

/** Shared parameter descriptions, so every tool documents confinement the same way. */
const ROOT_PARAM = z.string().min(1).describe(
  'Project directory to audit. Resolved inside the server\'s configured workspace roots; `..` traversal, symlink escapes, and roots with no configured roots are rejected.',
);

/**
 * Defense-in-depth redaction: scanners already mask secret values in
 * findings, but this second pass also scrubs scanner notes, check output,
 * and error messages so no raw credential ever reaches the client.
 */
const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement?: string }> = [
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { pattern: /\b[a-z]{1,5}\d{20,32}\b/g },
  { pattern: /\b[a-z]{32}@[a-z0-9.-]+\.[a-z]{2,}\b/g },
  { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g, replacement: '[REDACTED-PRIVATE-KEY]' },
];

/** Mask a matched secret value, keeping just enough characters to identify it. */
function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)} [redacted ${value.length} chars]`;
}

/** Scrub a string with the redaction patterns above. */
export function redactText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (match) => replacement ?? maskSecret(match));
  }
  return out;
}

/** Recursively redact every string inside a serialized value. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = redactDeep(v);
    return out;
  }
  return value;
}

function capText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n[... truncated to ${MAX_TEXT_CHARS} chars]`;
}

function capFindings(findings: Finding[], limit: number): { items: Finding[]; total: number; truncated: boolean } {
  const total = findings.length;
  const items = findings.slice(0, limit);
  return { items, total, truncated: total > limit };
}

/** A tool result in the shape the MCP SDK hands to the client. */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/**
 * Apply the output caps and the redaction pass to a tool result before it is
 * handed to the client.
 */
function sanitizeResult(result: ToolResult): ToolResult {
  result.content = result.content.map((c) => ({ ...c, text: capText(redactText(c.text)) }));
  if (result.structuredContent) {
    result.structuredContent = redactDeep(result.structuredContent) as Record<string, unknown>;
  }
  return result;
}

/**
 * Build the Veylqorix MCP server.
 *
 * Every tool validates its arguments with Zod and restricts filesystem access
 * to the configured workspace roots (canonicalized, `..`-traversal and
 * symlink escapes are rejected before any filesystem access). Scanner and
 * check executions run without a shell, under per-item timeouts, and with
 * truncated output. Secret values are redacted in every returned payload.
 * Scanner unavailability (offline mode, missing binary) is reported as
 * SKIPPED/ERROR with a note, never as a pass.
 */
export function createServer(options: McpServerOptions): McpServer {
  if (!Array.isArray(options.roots) || options.roots.length === 0) {
    throw new Error('createServer: at least one workspace root is required');
  }
  const roots = options.roots;
  const online = options.online ?? true;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && (options.timeoutMs as number) > 0
      ? (options.timeoutMs as number)
      : 120_000;

  const server = new McpServer({
    name: 'veylqorix',
    version: '0.1.0',
    description:
      'Security audit tools: dependency, secret, and license scanning plus quality checks, gated by a quality gate.',
  });

  function validateRoot(requested: string): string {
    try {
      return validatePath(requested, roots, { allowMissing: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid path';
      const wrapped = new Error(`PATH_ERROR: ${message}`);
      if (error instanceof Error) wrapped.cause = error;
      throw wrapped;
    }
  }

  interface AuditArgs {
    root: string;
    policy?: Partial<Policy>;
    onlyScanners?: string[];
    skipQualityChecks?: boolean;
    includeTests?: boolean;
  }

  function auditOptionsFor(args: AuditArgs): AuditOptions {
    return {
      root: validateRoot(args.root),
      policy: args.policy,
      onlyScanners: args.onlyScanners,
      skipQualityChecks: args.skipQualityChecks,
      includeTests: args.includeTests,
      online,
      scannerTimeoutMs: timeoutMs,
    };
  }

  /** Catch a tool failure and return a structured error result. */
  async function withErrorFallback(
    action: () => Promise<ToolResult>,
    fallbackCode: string,
    fallbackMessage: string,
  ): Promise<ToolResult> {
    try {
      return sanitizeResult(await action());
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      if (message.startsWith('PATH_ERROR')) {
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
          structuredContent: { error: { code: 'PATH_ERROR', message } },
        };
      }
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
        structuredContent: { error: { code: fallbackCode, message: redactText(message) } },
      };
    }
  }

  const scannerSummaries = (result: AuditResultWithExit) =>
    result.scanners.map((s) => ({
      scanner: s.scanner,
      status: s.status,
      findingCount: s.findings.length,
      notes: s.notes,
      error: s.error,
    }));

  // 1. scan_repository — full audit: every scanner + quality checks + gate.
  server.registerTool(
    'scan_repository',
    {
      title: 'Scan repository',
      description:
        'Run the full security audit: dependency, secret, and license scanners plus the quality gate, and quality checks (type, lint, tests). Returns structured findings and a gate decision. Commands are chosen by the server from the project config; no shell is executed by a caller.',
      inputSchema: {
        root: ROOT_PARAM,
        onlyScanners: z.array(z.enum(SCANNER_NAMES)).optional().describe(
          'Restrict the audit to these scanners: dependencies, secrets, licenses. Default: all.',
        ),
        skipQualityChecks: z.boolean().optional().describe('Skip quality checks (type, lint, tests). Default false.'),
        includeTests: z.boolean().optional().describe('Include test/build runs in the quality checks. Default true.'),
        blockOnSeverity: z.array(z.enum(SEVERITY_NAMES)).optional().describe(
          'Severities that block the gate; default CRITICAL and HIGH.',
        ),
        blockOnSecrets: z.boolean().optional().describe('Whether exposed secrets block the gate; default true.'),
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const result = await runAudit(
          auditOptionsFor({
            root: args.root,
            onlyScanners: args.onlyScanners,
            skipQualityChecks: args.skipQualityChecks,
            includeTests: args.includeTests,
            policy: {
              blockOnSeverity: args.blockOnSeverity,
              blockOnSecrets: args.blockOnSecrets,
            },
          }),
        );
        const capped = capFindings(result.findings, MAX_FINDINGS_PER_RESPONSE);
        return {
          content: [{ type: 'text', text: summarizeGate(result) }],
          structuredContent: {
            gate: result.gate,
            coverage: result.coverage,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            scanners: scannerSummaries(result),
            findings: capped.items,
            totalFindings: capped.total,
            findingsTruncated: capped.truncated,
            checks: result.checks,
          },
        };
      }, 'AUDIT_FAILED', 'Audit failed'),
  );

  // 2. scan_dependencies — dependency scanner only.
  server.registerTool(
    'scan_dependencies',
    {
      title: 'Scan dependencies',
      description:
        'Run dependency vulnerability scanning for the project type (npm audit for Node, pip-audit for Python). Offline mode or a missing binary reports SKIPPED/ERROR with a note — an unavailable scanner is reported, never passed over.',
      inputSchema: {
        root: ROOT_PARAM,
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const result = await runAudit(auditOptionsFor({ root: args.root, onlyScanners: ['dependencies'] }));
        const dep = result.scanners.find((s) => s.scanner.startsWith('dependencies'));
        if (!dep) {
          return {
            content: [{ type: 'text', text: 'No dependency scanner was applicable to this project type.' }],
            isError: true,
            structuredContent: { error: { code: 'NOT_APPLICABLE', message: 'No dependency scanner applicable.' } },
          };
        }
        const capped = capFindings(dep.findings, MAX_FINDINGS_PER_RESPONSE);
        const unavailable = dep.status === 'SKIPPED' || dep.status === 'ERROR';
        return {
          content: [{ type: 'text', text: summarizeDependency(dep, unavailable) }],
          structuredContent: {
            scanner: dep.scanner,
            status: dep.status,
            available: !unavailable,
            findings: capped.items,
            totalFindings: capped.total,
            findingsTruncated: capped.truncated,
            notes: dep.notes,
            error: dep.error,
            coverage: result.coverage,
          },
        };
      }, 'AUDIT_FAILED', 'Dependency check failed'),
  );

  // 3. scan_secrets — secret scanner only.
  server.registerTool(
    'scan_secrets',
    {
      title: 'Scan secrets',
      description:
        'Scan project files for known secret patterns. Runs fully offline against local files; no source code leaves the machine. Matched values are redacted in all returned output.',
      inputSchema: {
        root: ROOT_PARAM,
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const result = await runAudit(auditOptionsFor({ root: args.root, onlyScanners: ['secrets'] }));
        const sec = result.scanners.find((s) => s.scanner === 'secrets');
        if (!sec) {
          return {
            content: [{ type: 'text', text: 'The secrets scanner was not run.' }],
            isError: true,
            structuredContent: { error: { code: 'SCANNER_ERROR', message: 'The secrets scanner was not run.' } },
          };
        }
        const capped = capFindings(sec.findings, MAX_FINDINGS_PER_RESPONSE);
        return {
          content: [{ type: 'text', text: summarizeSecrets(sec) }],
          structuredContent: {
            scanner: sec.scanner,
            status: sec.status,
            findings: capped.items,
            totalFindings: capped.total,
            findingsTruncated: capped.truncated,
            notes: sec.notes,
            error: sec.error,
            coverage: result.coverage,
          },
        };
      }, 'AUDIT_FAILED', 'Secret detection failed'),
  );

  // 4. run_security_checks — quality checks only (no scanners).
  server.registerTool(
    'run_security_checks',
    {
      title: 'Run security checks',
      description:
        'Run the applicable quality checks (TypeScript, ESLint, Ruff, project test scripts). The command set is chosen by the server from the project\'s own configuration; a caller cannot inject commands and no shell is executed. Each check is reported as PASS, FAIL, SKIPPED, or ERROR, with truncated output.',
      inputSchema: {
        root: ROOT_PARAM,
        includeTests: z.boolean().optional().describe('Include test and build runs; default true.'),
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const result = await runAudit(
          auditOptionsFor({
            root: args.root,
            onlyScanners: [],
            skipQualityChecks: false,
            includeTests: args.includeTests,
          }),
        );
        return {
          content: [{ type: 'text', text: summarizeChecks(result.checks) }],
          structuredContent: {
            checks: result.checks,
            failed: result.checks.filter((c) => c.status === 'FAIL'),
            errored: result.checks.filter((c) => c.status === 'ERROR'),
            gate: result.gate,
            coverage: result.coverage,
            exitCode: result.exitCode,
          },
        };
      }, 'CHECKS_FAILED', 'Quality checks failed'),
  );

  // 5. get_findings — fast, checks-free findings listing.
  server.registerTool(
    'get_findings',
    {
      title: 'Get findings',
      description:
        'Run the scanners without quality checks and return the current findings, capped to a limit. Use this to list what is unresolved after remediation. Secret values are redacted.',
      inputSchema: {
        root: ROOT_PARAM,
        onlyScanners: z.array(z.enum(SCANNER_NAMES)).optional().describe(
          'Restrict to these scanners: dependencies, secrets, licenses. Default: all.',
        ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_FINDING_LIMIT)
          .optional()
          .describe(`Maximum findings to return; default ${DEFAULT_FINDING_LIMIT}.`),
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const result = await runAudit(
          auditOptionsFor({
            root: args.root,
            onlyScanners: args.onlyScanners,
            skipQualityChecks: true,
          }),
        );
        const limit = args.limit ?? DEFAULT_FINDING_LIMIT;
        const capped = capFindings(result.findings, limit);
        return {
          content: [
            {
              type: 'text',
              text: `Findings: ${capped.total} total (${capped.items.length} returned)` +
                (capped.truncated ? `, truncated to limit ${limit}` : '') +
                `. Gate: ${result.gate.result}, coverage ${result.coverage}.`,
            },
          ],
          structuredContent: {
            findings: capped.items,
            totalFindings: capped.total,
            findingsTruncated: capped.truncated,
            limit,
            gate: result.gate,
            coverage: result.coverage,
            scanners: scannerSummaries(result),
          },
        };
      }, 'FINDINGS_FAILED', 'Finding retrieval failed'),
  );

  // 6. validate_fix — re-run the relevant scanners and verify specific finding ids.
  server.registerTool(
    'validate_fix',
    {
      title: 'Validate fix',
      description:
        'Re-run scanners after a fix and verify that the given finding ids no longer appear. A fix is verified only by a fresh run: any requested id still present is unresolved. Reports new findings introduced by the change and which scanners could not run.',
      inputSchema: {
        root: ROOT_PARAM,
        scanners: z.array(z.enum(SCANNER_NAMES)).optional().describe(
          'Scanners to re-run; default all (dependencies, secrets, licenses). Findings are only checkable within the scanners that are run.',
        ),
        findingIds: z.array(z.string().min(1)).optional().describe(
          'Finding ids to verify as resolved (stable, deterministic ids from earlier scan results).',
        ),
      },
    },
    async (args) =>
      withErrorFallback(async () => {
        const scanners = args.scanners ?? [...SCANNER_NAMES];
        const requested = args.findingIds ?? [];
        const result = await runAudit(
          auditOptionsFor({
            root: args.root,
            onlyScanners: scanners,
            skipQualityChecks: true,
          }),
        );
        const present = new Set(result.findings.map((f) => f.id));
        const requestedSet = new Set(requested);
        const checked = requested.map((id) => ({ id, stillPresent: present.has(id) }));
        const unresolved = checked.filter((c) => c.stillPresent).map((c) => c.id);
        const newFindings = capFindings(
          result.findings.filter((f) => !requestedSet.has(f.id)),
          MAX_FINDINGS_PER_RESPONSE,
        );
        const unverifiable = result.scanners.find((s) => s.status === 'SKIPPED' || s.status === 'ERROR');
        const notes: string[] = [
          'A fix is verified only when its finding id is absent from this fresh run.',
          `Findings are checkable only within the requested scanners: ${scanners.join(', ')}.`,
        ];
        if (unverifiable) {
          notes.push(
            `Scanner '${unverifiable.scanner}' did not complete (${unverifiable.status}); findings it would have reported cannot be verified as resolved.`,
          );
        }
        return {
          content: [
            {
              type: 'text',
              text:
                requested.length === 0
                  ? `Fresh run: ${newFindings.total} finding(s) currently present. Gate: ${result.gate.result}, coverage ${result.coverage}.`
                  : `Checked ${requested.length} finding id(s): ${requested.length - unresolved.length} resolved, ${unresolved.length} still present.${unverifiable ? ` Note: ${unverifiable.scanner} scanner unavailable.` : ''}`,
            },
          ],
          structuredContent: {
            checked,
            unresolved,
            newFindings: newFindings.items,
            totalNewFindings: newFindings.total,
            scanners: scannerSummaries(result),
            gate: result.gate,
            coverage: result.coverage,
            exitCode: result.exitCode,
            unverifiableScanner: unverifiable ? unverifiable.scanner : null,
            notes,
          },
        };
      }, 'VALIDATION_FAILED', 'Fix validation failed'),
  );

  return server;
}

function summarizeGate(result: AuditResultWithExit): string {
  const gate = result.gate;
  const lines = [`Gate result: ${gate.result} (coverage ${result.coverage}, exit code ${result.exitCode})`];
  if (gate.blockingReasons.length > 0) {
    lines.push(`Blocking (${gate.blockingReasons.length}):`);
    for (const r of gate.blockingReasons.slice(0, 10)) lines.push(`  - ${r}`);
  }
  if (gate.incompleteReasons.length > 0) {
    lines.push(`Incomplete (${gate.incompleteReasons.length}):`);
    for (const r of gate.incompleteReasons.slice(0, 10)) lines.push(`  - ${r}`);
  }
  const findings = result.findings;
  const bySeverity = new Map<string, number>();
  for (const f of findings) bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
  lines.push(`Findings: ${findings.length} total`);
  for (const [sev, count] of bySeverity) lines.push(`  ${sev}: ${count}`);
  return lines.join('\n');
}

function summarizeDependency(dep: ScannerResult, unavailable: boolean): string {
  const lines = [`Dependency scan (${dep.scanner}): ${dep.status}`];
  if (dep.findings.length > 0) {
    lines.push(`${dep.findings.length} vulnerable package(s):`);
    for (const f of dep.findings.slice(0, 20)) lines.push(`  - [${f.severity}] ${f.title}`);
  }
  if (dep.error) lines.push(`Error: ${dep.error.message}`);
  if (dep.notes.length > 0) lines.push(`Notes: ${dep.notes.join(' ')}`);
  if (unavailable) {
    lines.push('The dependency scanner did not complete; treat dependency coverage as incomplete. This is not a pass.');
  }
  return lines.join('\n');
}

function summarizeSecrets(sec: ScannerResult): string {
  const lines = [`Secret scan: ${sec.status}`];
  if (sec.findings.length > 0) {
    lines.push(`${sec.findings.length} potential secret(s) detected (values redacted):`);
    for (const f of sec.findings.slice(0, 20)) lines.push(`  - [${f.severity}] ${f.title}`);
  }
  if (sec.error) lines.push(`Error: ${sec.error.message}`);
  if (sec.notes.length > 0) lines.push(`Notes: ${sec.notes.join(' ')}`);
  return lines.join('\n');
}

function summarizeChecks(checks: CheckResult[]): string {
  const lines = [`Quality checks: ${checks.length} listed`];
  if (checks.length === 0) {
    lines.push('  No applicable quality checks were detected in this project.');
  }
  for (const c of checks) {
    const detail = c.reason ?? c.error?.message ?? '';
    lines.push(`  - ${c.id}: ${c.status}${detail ? ` — ${detail}` : ''}`);
  }
  return lines.join('\n');
}

export async function startServer(options: McpServerOptions): Promise<void> {
  const server = createServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
