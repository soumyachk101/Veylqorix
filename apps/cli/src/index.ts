#!/usr/bin/env node
/**
 * Veylqorix CLI.
 *
 * Commands:
 *   veylqorix scan [root]      Run the full security audit + quality gate.
 *   veylqorix check  [root]    Run only the quality checks (type, lint, tests).
 *   veylqorix report [root]    Emit a human-readable Markdown report.
 *   veylqorix config validate [policy-file]   Validate a policy JSON file.
 *   Legacy aliases: audit, deps, secrets, checks, gate.
 *
 * Options (scan / check / report):
 *   --root PATH          Audit this directory (default: current working dir).
 *   --offline            Do not call external scanners (npm audit / pip-audit).
 *   --json               Emit machine-readable JSON instead of a human summary.
 *   --format json|markdown|sarif   Force a report format.
 *   --report-out PATH    Also write a Markdown report to this file.
 *   --sarif-out PATH     Also write a SARIF report to this file.
 *   --no-tests           Skip test/build quality checks.
 *   --scanners a,b       Run only the listed scanners.
 *   --staged             Scope the secret scan to Git-staged files (git repos only).
 *   --block-on a,b       Severities that block the gate.
 *   --policy FILE        Load a policy JSON file for the audit.
 *
 * Exit codes:
 *   0 PASS   1 FAIL (blocking findings)   2 INCOMPLETE (coverage degraded)
 *   64 usage error   65 root not found   70 unexpected error
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  runAudit,
  toJson,
  toMarkdown,
  toSarif,
  listStagedFiles,
  validatePolicyFile,
  findPolicyFile,
  installHooks,
  uninstallHooks,
  type AuditOptions,
  type Policy,
} from '@veylqorix/core';
import { fileURLToPath } from 'node:url';

const USAGE = `Veylqorix CLI

Usage:
  veylqorix <command> [root] [options]

Commands:
  scan             Run the full security audit + quality gate (default)
  check            Run only the quality checks
  report           Emit a Markdown report
  config validate  Validate a policy JSON file

Options:
  --root PATH              Audit this directory (default: current working dir)
  --offline                Do not call external scanners
  --json / --format json   Machine-readable output
  --format sarif           Emit SARIF
  --report-out PATH        Write a Markdown report to PATH
  --sarif-out PATH         Write a SARIF report to PATH
  --no-tests               Skip test/build quality checks
  --scanners a,b           Run only the listed scanners
  --staged                 Scope the secret scan to Git-staged files
  --block-on a,b           Severities that block the gate
  --policy FILE            Load a policy JSON file

Exit codes: 0=PASS  1=FAIL  2=INCOMPLETE  64=usage  65=bad root  70=error`;

interface ParsedArgs {
  command: string;
  root: string;
  offline: boolean;
  json: boolean;
  format?: 'json' | 'markdown' | 'sarif';
  reportOut?: string;
  sarifOut?: string;
  noTests: boolean;
  scanners?: string[];
  staged: boolean;
  policyFile?: string;
  policy?: Partial<Policy>;

  prePush: boolean;
  force: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0];
  const isConfig = first === 'config' && argv[1] === 'validate';
  const isHooks = first === 'hooks' && (argv[1] === 'install' || argv[1] === 'uninstall');
  const command = isConfig ? 'config' : isHooks ? 'hooks' : (first ?? 'scan');
  // For `config validate`, the positional after `validate` is the policy file.
  // For everything else, the positional after the command is the root.
  // `config validate <file>`: positional is the policy file.
  // `hooks install|uninstall`: no positional root.
  // Everything else: the positional after the command is the root.
  let flags: string[];
  if (isConfig) flags = argv.slice(2);
  else if (isHooks) flags = argv.slice(2);
  else flags = argv.slice(1);

  const parsed: ParsedArgs = {
    command,
    root: process.cwd(),
    offline: false,
    json: false,
    noTests: false,
    staged: false,
    prePush: false,
    force: false,
    yes: false,
  };

  const valueFlag = new Set(['--report-out', '--sarif-out', '--scanners', '--block-on', '--root', '--policy']);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (!flag) continue;
    if (valueFlag.has(flag)) {
      const value = flags[++i];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      switch (flag) {
        case '--root': parsed.root = value; break;
        case '--report-out': parsed.reportOut = path.resolve(value); break;
        case '--sarif-out': parsed.sarifOut = path.resolve(value); break;
        case '--policy': parsed.policyFile = path.resolve(value); break;
        case '--scanners': parsed.scanners = value.split(',').map((s) => s.trim()).filter(Boolean); break;
        case '--block-on':
          parsed.policy = { ...parsed.policy, blockOnSeverity: value.split(',').map((s) => s.trim().toUpperCase()) as Policy['blockOnSeverity'] };
          break;
      }
      continue;
    }
    switch (flag) {
      case '--offline': parsed.offline = true; break;
      case '--json': parsed.json = true; parsed.format = 'json'; break;
      case '--format': {
        const value = flags[++i];
        if (value !== 'json' && value !== 'markdown' && value !== 'sarif') throw new Error(`--format must be json, markdown, or sarif (got '${value}')`);
        parsed.format = value;
        if (value === 'json') parsed.json = true;
        break;
      }
      case '--no-tests': parsed.noTests = true; break;
      case '--staged': parsed.staged = true; break;
      case '--pre-push': parsed.prePush = true; break;
      case '--force': parsed.force = true; break;
      case '-y':
      case '--yes': parsed.yes = true; break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
        if (command.startsWith('config')) {
          // `veylqorix config validate <policy-file>`: the positional is the file.
          parsed.policyFile = path.resolve(flag);
        } else if (parsed.root === process.cwd() && !isKnownCommand(flag)) {
          // A bare positional is the root for scan/check/report.
          parsed.root = path.resolve(flag);
        } else if (isKnownCommand(flag)) {
          // Legacy single-word subcommands after the main one are ignored.
        }
    }
  }
  parsed.root = path.resolve(parsed.root);
  return parsed;
}

const KNOWN_COMMANDS = new Set(['scan', 'check', 'report', 'config', 'hooks', 'audit', 'deps', 'secrets', 'checks', 'gate']);
function isKnownCommand(word: string): boolean {
  return KNOWN_COMMANDS.has(word);
}

/** Normalize legacy aliases to modern verbs. */
function normalizeCommand(command: string): string {
  switch (command) {
    case 'audit':
    case 'deps':
    case 'secrets':
    case 'gate':
      return 'scan';
    case 'checks':
      return 'check';
    default:
      return command;
  }
}

function severityIcon(status: string): string {
  switch (status) {
    case 'PASS': return '✅';
    case 'FAIL': return '❌';
    case 'SKIPPED': return '⏭️';
    default: return '⚠️';
  }
}

function summarize(result: Awaited<ReturnType<typeof runAudit>>): string {
  const gate = result.gate;
  const lines: string[] = [];
  lines.push(`${severityIcon(gate.result)} Gate result: ${gate.result}  (coverage ${result.coverage}, exit code ${result.exitCode})`);
  lines.push('');
  lines.push('Scanners:');
  for (const s of result.scanners) {
    lines.push(`  ${severityIcon(s.status)} ${s.scanner.padEnd(16)} ${s.status.padEnd(8)} ${s.findings.length} finding(s)`);
  }
  if (result.checks.length > 0) {
    lines.push('');
    lines.push('Checks:');
    for (const c of result.checks) {
      lines.push(`  ${severityIcon(c.status)} ${c.id.padEnd(16)} ${c.status}`);
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
    lines.push(`Findings: ${result.findings.length} total (use --json / --format markdown for details)`);
  } else {
    lines.push('');
    lines.push('Findings: 0');
  }
  return lines.join('\n');
}

function loadPolicy(parsed: ParsedArgs): Partial<Policy> | undefined {
  let file = parsed.policyFile;
  if (!file && findPolicyFile(parsed.root)) file = findPolicyFile(parsed.root);
  let policy = parsed.policy;
  if (file) {
    const result = validatePolicyFile(file);
    if (!result.valid) {
      console.error(`Policy file ${file} is invalid:`);
      for (const issue of result.issues) console.error(`  [${issue.level}] ${issue.field}: ${issue.message}`);
      process.exit(64);
    }
    const resolved = result.resolved?.policy;
    policy = { ...policy, ...resolved } as Partial<Policy>;
  }
  return policy;
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(64);
  }
  const command = normalizeCommand(parsed.command);

  if (command === 'hooks') {
    const sub = process.argv[3] === 'uninstall' ? 'uninstall' : 'install';
    const cliPath = path.resolve(fileURLToPath(import.meta.url));
    if (!parsed.yes) {
      // Dry run: print the exact hook scripts; nothing is written without --yes.
      const gitDir = path.join(parsed.root, '.git');
      console.log('Dry run: Veylqorix will write the following hooks (git config is never touched).');
      for (const kind of parsed.prePush ? ['pre-commit', 'pre-push'] : ['pre-commit']) {
        console.log(`--- ${gitDir}/hooks/${kind} ---`);
        const scanArgs = kind === 'pre-commit' ? 'scan --staged --no-tests --scanners secrets' : 'scan --no-tests';
        console.log(
          '#!/bin/sh\n# VeylqORIX-HOOK:v1\n' +
            `# ${kind}: local convenience gate; GitHub-side enforcement is the authoritative boundary.\n` +
            'if [ "$VEYLQORIX_OVERRIDE" = "1" ]; then echo "veylqorix: VeyLQORIX_OVERRIDE=1; skipping ' + kind + '" >&2; exit 0; fi\n' +
            'DIR=$(git rev-parse --show-toplevel) || exit 0\n' +
            `exec node ${JSON.stringify(cliPath)} ${scanArgs} --root "$DIR"\n` +
            'exit $?\n',
        );
      }
      console.log('\nRe-run with --yes to install. Emergency override: VeyLQORIX_OVERRIDE=1 <git command>.');
      process.exit(0);
    }
    const outcome =
      sub === 'install'
        ? await installHooks({
            repoRoot: parsed.root,
            cliPath,
            prePush: parsed.prePush,
            force: parsed.force,
            extraFlags: parsed.offline ? ['--offline'] : [],
          })
        : await uninstallHooks(parsed.root, parsed.prePush);
    for (const msg of outcome.installed) console.log(`  installed: ${msg}`);
    for (const msg of outcome.backedUp) console.log(`  backed up: ${msg}`);
    for (const msg of outcome.skipped) console.log(`  skipped: ${msg}`);
    for (const msg of outcome.errors) console.error(`  error: ${msg}`);
    if (sub === 'install' && outcome.installed.length > 0 && outcome.errors.length === 0) {
      console.log('\nManual alternative and testing steps:');
      for (const line of outcome.manualInstructions) console.log(`  ${line}`);
    }
    process.exit(outcome.errors.length > 0 ? 64 : 0);
    return;
  }

  if (command === 'config') {
    const target = parsed.policyFile;
    if (!target || !fs.existsSync(target)) {
      console.error(`Policy file not found: ${target ?? '(none)'}`);
      console.error('Usage: veylqorix config validate <policy.json>');
      process.exit(65);
    }
    const result = validatePolicyFile(path.resolve(target));
    if (result.valid) {
      console.log(`✅ Policy valid: ${path.resolve(target)}`);
      if (result.issues.length > 0) {
        for (const issue of result.issues) console.log(`  [${issue.level}] ${issue.field}: ${issue.message}`);
      }
      process.exit(0);
    }
    console.error(`❌ Policy invalid: ${path.resolve(target)}`);
    for (const issue of result.issues) console.error(`  [${issue.level}] ${issue.field}: ${issue.message}`);
    process.exit(64);
    return;
  }

  if (!fs.existsSync(parsed.root)) {
    console.error(`Root directory does not exist: ${parsed.root}`);
    process.exit(65);
  }

  let stagedFiles: string[] | undefined;
  if (parsed.staged) {
    stagedFiles = await listStagedFiles(parsed.root);
    if (stagedFiles.length === 0) {
      console.error('No staged files found; run `git add` first. --staged requires a Git repository with staged changes.');
      process.exit(65);
    }
  }

  const options: AuditOptions = {
    root: parsed.root,
    online: !parsed.offline,
    includeTests: !parsed.noTests,
    onlyScanners: command === 'check' ? [] : parsed.scanners,
    skipQualityChecks: command === 'check' ? false : undefined,
    policy: loadPolicy(parsed),
    stagedFiles,
  };

  const result = await runAudit(options);

  // Write report files when requested.
  if (parsed.reportOut) {
    fs.writeFileSync(parsed.reportOut, toMarkdown(result), 'utf8');
    if (parsed.format !== 'json' && parsed.format !== 'sarif') console.log(`Markdown report written to ${parsed.reportOut}`);
  }
  if (parsed.sarifOut) {
    fs.writeFileSync(parsed.sarifOut, toSarif(result), 'utf8');
    if (parsed.format !== 'json' && parsed.format !== 'markdown') console.log(`SARIF report written to ${parsed.sarifOut}`);
  }

  // Decide the stdout shape: --json/--format json wins, then markdown
  // (--format markdown or the `report` command), then a short summary.
  if (parsed.format === 'json' || parsed.json) {
    console.log(toJson(result));
  } else if (command === 'report' || parsed.format === 'markdown') {
    console.log(toMarkdown(result));
  } else {
    console.log(summarize(result));
  }

  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error('veylqorix: unexpected error:', error instanceof Error ? error.message : error);
  process.exit(70);
});
