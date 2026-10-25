#!/usr/bin/env node
/**
 * Veylqorix CLI.
 *
 * Usage:
 *   veylqorix audit [root] [options]
 *   veylqorix deps [root]
 *   veylqorix secrets [root]
 *   veylqorix checks [root]
 *   veylqorix gate [root]
 *
 * Options:
 *   --offline          Do not call external scanners (npm audit / pip-audit).
 *   --json             Emit machine-readable JSON instead of a human summary.
 *   --report-out PATH  Also write the report to this file (markdown).
 *   --no-tests         Skip test/build quality checks.
 *   --scanners a,b     Run only the listed scanners.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  runAudit,
  toJson,
  toMarkdown,
  type AuditOptions,
} from '@veylqorix/core';

interface ParsedArgs {
  command: string;
  root: string;
  offline: boolean;
  json: boolean;
  reportOut?: string;
  noTests: boolean;
  scanners?: string[];
  policy?: AuditOptions['policy'];
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? 'audit';
  const flags = argv.slice(1);
  const parsed: ParsedArgs = {
    command,
    root: process.cwd(),
    offline: false,
    json: false,
    noTests: false,
  };

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    switch (flag) {
      case '--offline':
        parsed.offline = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--no-tests':
        parsed.noTests = true;
        break;
      case '--report-out': {
        const value = flags[++i];
        if (!value) throw new Error('--report-out requires a path');
        parsed.reportOut = path.resolve(value);
        break;
      }
      case '--scanners': {
        const value = flags[++i];
        if (!value) throw new Error('--scanners requires a comma-separated list');
        parsed.scanners = value.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--block-on': {
        const value = flags[++i];
        if (!value) throw new Error('--block-on requires a severity list');
        parsed.policy = {
          ...parsed.policy,
          blockOnSeverity: value
            .split(',')
            .map((s) => s.trim().toUpperCase() as 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
            .filter((s) => ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s)),
        };
        break;
      }
      case '--root': {
        const value = flags[++i];
        if (!value) throw new Error('--root requires a path');
        parsed.root = path.resolve(value);
        break;
      }
      default:
        // A positional argument after the command is the root.
        if (flag && !flag.startsWith('--') && parsed.root === process.cwd()) {
          parsed.root = path.resolve(flag);
        } else if (flag?.startsWith('--')) {
          throw new Error(`Unknown option: ${flag}`);
        }
    }
  }
  parsed.root = path.resolve(parsed.root);
  return parsed;
}

function summarize(result: Awaited<ReturnType<typeof runAudit>>): string {
  const gate = result.gate;
  const lines: string[] = [];
  const icon = gate.result === 'PASS' ? '✅' : gate.result === 'FAIL' ? '❌' : '⚠️';
  lines.push(`${icon} Gate result: ${gate.result}  (coverage ${result.coverage}, exit code ${result.exitCode})`);
  lines.push('');
  lines.push('Scanners:');
  for (const s of result.scanners) {
    const status = s.status === 'PASS' ? '✅' : s.status === 'FAIL' ? '❌' : s.status === 'SKIPPED' ? '⏭️' : '⚠️';
    lines.push(`  ${status} ${s.scanner.padEnd(14)} ${s.status.padEnd(8)} ${s.findings.length} finding(s)`);
  }
  if (result.checks.length > 0) {
    lines.push('');
    lines.push('Checks:');
    for (const c of result.checks) {
      const status = c.status === 'PASS' ? '✅' : c.status === 'FAIL' ? '❌' : c.status === 'SKIPPED' ? '⏭️' : '⚠️';
      lines.push(`  ${status} ${c.id.padEnd(14)} ${c.status}`);
    }
  }
  if (gate.blockingReasons.length > 0) {
    lines.push('');
    lines.push('Blocking reasons:');
    for (const r of gate.blockingReasons) lines.push(`  - ${r}`);
  }
  if (gate.incompleteReasons.length > 0) {
    lines.push('');
    lines.push('Incomplete coverage:');
    for (const r of gate.incompleteReasons) lines.push(`  - ${r}`);
  }
  if (result.findings.length > 0) {
    lines.push('');
    lines.push(`Findings: ${result.findings.length} total (see --json or --report-out for details)`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(64);
  }

  if (!fs.existsSync(parsed.root)) {
    console.error(`Root directory does not exist: ${parsed.root}`);
    process.exit(65);
  }

  const options: AuditOptions = {
    root: parsed.root,
    online: !parsed.offline,
    includeTests: !parsed.noTests,
    onlyScanners: parsed.scanners,
    policy: parsed.policy,
  };

  const result = await runAudit(options);

  if (parsed.reportOut) {
    fs.writeFileSync(parsed.reportOut, toMarkdown(result), 'utf8');
    if (!parsed.json) console.log(`Report written to ${parsed.reportOut}`);
  }

  if (parsed.json) {
    console.log(toJson(result));
  } else {
    console.log(summarize(result));
  }

  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error('veylqorix: unexpected error:', error instanceof Error ? error.message : error);
  process.exit(70);
});
