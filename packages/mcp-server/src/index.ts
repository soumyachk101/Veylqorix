import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  runAudit,
  toJson,
  toMarkdown,
  validatePath,
  exitCodeFor,
  type AuditOptions,
  type AuditResultWithExit,
  type Policy,
} from '@veylqorix/core';

export interface McpServerOptions {
  /** Absolute workspace roots that tools may access. */
  roots: string[];
  /** Per-tool timeout in milliseconds. */
  timeoutMs?: number;
  /** Run external scanners; false forces offline mode. */
  online?: boolean;
}

/**
 * Build the Veylqorix MCP server.
 *
 * Every tool validates its arguments with Zod and restricts filesystem access
 * to the configured workspace roots. Paths are canonicalized and checked for
 * traversal and symlink escapes before they are used. All findings returned to
 * the client have secret values redacted by the scanners, and scanner
 * execution errors are surfaced as structured ERRORs, never as success.
 */
export function createServer(options: McpServerOptions): McpServer {
  const { roots, timeoutMs = 120_000, online = true } = options;
  const server = new McpServer({
    name: 'veylqorix',
    version: '0.1.0',
    description: 'Security audit tools: dependency, secret, and quality scanning with a quality gate.',
  });

  function validateRoot(requested: string): string {
    try {
      return validatePath(requested, roots, { allowMissing: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid path';
      throw new Error(`PATH_ERROR: ${message}`);
    }
  }

  function auditOptionsFor(args: {
    root: string;
    policy?: AuditOptions['policy'];
    onlyScanners?: string[];
    skipQualityChecks?: boolean;
  }): AuditOptions {
    const root = validateRoot(args.root);
    return {
      root,
      policy: args.policy,
      onlyScanners: args.onlyScanners,
      skipQualityChecks: args.skipQualityChecks,
      online,
      scannerTimeoutMs: timeoutMs,
    };
  }

  function errorContent(message: string, errorCode: string) {
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
      structuredContent: { error: { code: errorCode, message } },
    };
  }

  // 1. scan_project
  server.registerTool(
    'scan_project',
    {
      title: 'Scan project',
      description:
        'Run the full security audit: dependency, secret, and license scanners plus the quality gate. Returns structured findings and a gate decision.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root, inside a configured workspace root'),
        onlyScanners: z.array(z.string()).optional().describe('Restrict the audit to these scanner names: dependencies, secrets, licenses'),
        skipQualityChecks: z.boolean().optional().describe('Skip running quality checks (type, lint, tests)'),
        blockOnSeverity: z.array(z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional().describe('Severities that block the gate; default CRITICAL and HIGH'),
        blockOnSecrets: z.boolean().optional().describe('Whether exposed secrets block the gate; default true'),
      },
    },
    async (args) => {
      try {
        const result = await runAudit(
          auditOptionsFor({
            root: args.root,
            onlyScanners: args.onlyScanners,
            skipQualityChecks: args.skipQualityChecks,
            policy: {
              blockOnSeverity: args.blockOnSeverity as Policy['blockOnSeverity'],
              blockOnSecrets: args.blockOnSecrets,
            },
          }),
        );
        return serializeAudit(result, 'scan_project');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Audit failed';
        if (message.startsWith('PATH_ERROR')) {
          return errorContent(message, 'PATH_ERROR');
        }
        return errorContent(message, 'AUDIT_FAILED');
      }
    },
  );

  // 2. check_dependencies
  server.registerTool(
    'check_dependencies',
    {
      title: 'Check dependencies',
      description:
        'Run dependency vulnerability scanning for a project (npm audit for Node, pip-audit for Python). Offline mode reports coverage as incomplete.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root'),
      },
    },
    async (args) => {
      try {
        const result = await runAudit(
          auditOptionsFor({ root: args.root, onlyScanners: ['dependencies'] }),
        );
        const dep = result.scanners.find((s) => s.scanner === 'dependencies');
        if (!dep) {
          return errorContent('No dependency scanner was applicable to this project type.', 'NOT_APPLICABLE');
        }
        return {
          content: [{ type: 'text' as const, text: summarizeDependency(dep) }],
          structuredContent: {
            status: dep.status,
            findings: dep.findings,
            notes: dep.notes,
            error: dep.error,
            coverage: result.coverage,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Dependency check failed';
        if (message.startsWith('PATH_ERROR')) return errorContent(message, 'PATH_ERROR');
        return errorContent(message, 'AUDIT_FAILED');
      }
    },
  );

  // 3. detect_secrets
  server.registerTool(
    'detect_secrets',
    {
      title: 'Detect secrets',
      description:
        'Scan project files for known secret patterns. Values are redacted in all returned output. No source code leaves the machine.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root'),
      },
    },
    async (args) => {
      try {
        const result = await runAudit(
          auditOptionsFor({ root: args.root, onlyScanners: ['secrets'] }),
        );
        const sec = result.scanners.find((s) => s.scanner === 'secrets');
        if (!sec) {
          return errorContent('The secrets scanner was not run.', 'SCANNER_ERROR');
        }
        return {
          content: [{ type: 'text' as const, text: summarizeSecrets(sec) }],
          structuredContent: {
            status: sec.status,
            findings: sec.findings,
            notes: sec.notes,
            error: sec.error,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Secret detection failed';
        if (message.startsWith('PATH_ERROR')) return errorContent(message, 'PATH_ERROR');
        return errorContent(message, 'AUDIT_FAILED');
      }
    },
  );

  // 4. run_quality_checks
  server.registerTool(
    'run_quality_checks',
    {
      title: 'Run quality checks',
      description:
        'Run applicable static-analysis and test checks (TypeScript, ESLint, pytest, project test scripts). Each check is reported as PASS, FAIL, SKIPPED, or ERROR.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root'),
        includeTests: z.boolean().optional().describe('Include test and build runs; default true'),
      },
    },
    async (args) => {
      try {
        const result = await runAudit({
          root: validateRoot(args.root),
          onlyScanners: [],
          skipQualityChecks: false,
          online,
          scannerTimeoutMs: timeoutMs,
          includeTests: args.includeTests,
        });
        return {
          content: [{ type: 'text' as const, text: summarizeChecks(result.checks) }],
          structuredContent: {
            checks: result.checks,
            failed: result.checks.filter((c) => c.status === 'FAIL'),
            errored: result.checks.filter((c) => c.status === 'ERROR'),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Quality checks failed';
        if (message.startsWith('PATH_ERROR')) return errorContent(message, 'PATH_ERROR');
        return errorContent(message, 'AUDIT_FAILED');
      }
    },
  );

  // 5. get_audit_report
  server.registerTool(
    'get_audit_report',
    {
      title: 'Get audit report',
      description:
        'Run the audit and return a Markdown report plus a structured gate decision. Secret values are redacted in the report.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root'),
        format: z.enum(['markdown', 'json']).optional().describe('Report format; default markdown'),
      },
    },
    async (args) => {
      try {
        const result = await runAudit(auditOptionsFor({ root: args.root }));
        const report = args.format === 'json' ? toJson(result) : toMarkdown(result);
        return {
          content: [{ type: 'text' as const, text: report }],
          structuredContent: {
            gate: result.gate,
            coverage: result.coverage,
            findings: result.findings,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Report generation failed';
        if (message.startsWith('PATH_ERROR')) return errorContent(message, 'PATH_ERROR');
        return errorContent(message, 'REPORT_FAILED');
      }
    },
  );

  // 6. verify_quality_gate
  server.registerTool(
    'verify_quality_gate',
    {
      title: 'Verify quality gate',
      description:
        'Run the audit and return the gate decision (PASS, FAIL, INCOMPLETE) with a deterministic exit code. A scanner error or skipped mandatory check forces INCOMPLETE, never PASS.',
      inputSchema: {
        root: z.string().describe('Absolute path to the project root'),
        blockOnSeverity: z.array(z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])).optional(),
        blockOnSecrets: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const result: AuditResultWithExit = await runAudit(
          auditOptionsFor({
            root: args.root,
            policy: {
              blockOnSeverity: args.blockOnSeverity as Policy['blockOnSeverity'],
              blockOnSecrets: args.blockOnSecrets,
            },
          }),
        );
        const exitCode = exitCodeFor(result.gate, result.coverage);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Gate result: ${result.gate.result} (exit code ${exitCode}, coverage ${result.coverage})`,
            },
          ],
          structuredContent: {
            result: result.gate.result,
            exitCode,
            coverage: result.coverage,
            blockingReasons: result.gate.blockingReasons,
            incompleteReasons: result.gate.incompleteReasons,
            appliedExceptions: result.gate.appliedExceptions,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Gate verification failed';
        if (message.startsWith('PATH_ERROR')) return errorContent(message, 'PATH_ERROR');
        return errorContent(message, 'AUDIT_FAILED');
      }
    },
  );

  return server;
}

function serializeAudit(result: AuditResultWithExit, toolName: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: summarizeGate(result),
      },
    ],
    structuredContent: {
      tool: toolName,
      gate: result.gate,
      coverage: result.coverage,
      exitCode: result.exitCode,
      scanners: result.scanners.map((s) => ({
        scanner: s.scanner,
        status: s.status,
        findingCount: s.findings.length,
        notes: s.notes,
        error: s.error,
      })),
      findings: result.findings,
      checks: result.checks,
    },
  };
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

function summarizeDependency(dep: {
  status: string;
  findings: { id: string; severity: string; title: string }[];
  notes: string[];
  error?: { message: string };
}) {
  const lines = [`Dependency scan: ${dep.status}`];
  if (dep.findings.length > 0) {
    lines.push(`${dep.findings.length} vulnerable package(s):`);
    for (const f of dep.findings.slice(0, 20)) lines.push(`  - [${f.severity}] ${f.title}`);
  }
  if (dep.error) lines.push(`Error: ${dep.error.message}`);
  if (dep.notes.length > 0) lines.push(`Notes: ${dep.notes.join(' ')}`);
  return lines.join('\n');
}

function summarizeSecrets(sec: {
  status: string;
  findings: { id: string; severity: string; title: string }[];
  notes: string[];
  error?: { message: string };
}) {
  const lines = [`Secret scan: ${sec.status}`];
  if (sec.findings.length > 0) {
    lines.push(`${sec.findings.length} potential secret(s) detected (values redacted):`);
    for (const f of sec.findings.slice(0, 20)) lines.push(`  - [${f.severity}] ${f.title}`);
  }
  if (sec.error) lines.push(`Error: ${sec.error.message}`);
  if (sec.notes.length > 0) lines.push(`Notes: ${sec.notes.join(' ')}`);
  return lines.join('\n');
}

function summarizeChecks(checks: { id: string; status: string; command: string; reason?: string; error?: { message: string } }[]) {
  const lines = [`Quality checks: ${checks.length} run`];
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
