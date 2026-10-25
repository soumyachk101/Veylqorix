/**
 * Argument parsing for the Veylqorix CLI, isolated from the executable entry
 * point so tests can exercise dispatch and flag handling without spawning a
 * process. `index.ts` re-uses these definitions verbatim.
 */
import path from 'node:path';
import type { Policy } from '@veylqorix/core';

export type HooksSubcommand = 'install' | 'uninstall';

export interface ParsedArgs {
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
  strict: boolean;
  policyFile?: string;
  policy?: Partial<Policy>;

  prePush: boolean;
  force: boolean;
  yes: boolean;
  hooksSub: HooksSubcommand;
}

export const KNOWN_COMMANDS = new Set([
  'scan',
  'check',
  'report',
  'config',
  'hooks',
  'audit',
  'deps',
  'secrets',
  'checks',
  'gate',
]);

export function isKnownCommand(word: string): boolean {
  return KNOWN_COMMANDS.has(word);
}

/** Normalize legacy aliases to modern verbs. */
export function normalizeCommand(command: string): string {
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

const HOOK_SUBCOMMANDS = new Set(['install', 'uninstall', 'remove']);

/** Parse CLI argv (post-executable) into a structured command description. */
export function parseArgs(argv: string[], cwd: string = process.cwd()): ParsedArgs {
  const first = argv[0];
  const isConfig = first === 'config' && argv[1] === 'validate';
  const isHooks =
    first === 'hooks' && (argv[1] === 'install' || argv[1] === 'uninstall' || argv[1] === 'remove');
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
    root: cwd,
    offline: false,
    json: false,
    noTests: false,
    staged: false,
    strict: false,
    prePush: false,
    force: false,
    yes: false,
    hooksSub: 'install',
  };

  const valueFlag = new Set([
    '--report-out',
    '--sarif-out',
    '--scanners',
    '--block-on',
    '--root',
    '--path',
    '--policy',
    '--config',
  ]);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (!flag) continue;
    if (valueFlag.has(flag)) {
      const value = flags[++i];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      switch (flag) {
        case '--root':
        case '--path':
          parsed.root = path.resolve(value);
          break;
        case '--report-out':
          parsed.reportOut = path.resolve(value);
          break;
        case '--sarif-out':
          parsed.sarifOut = path.resolve(value);
          break;
        case '--policy':
        case '--config':
          parsed.policyFile = path.resolve(value);
          break;
        case '--scanners':
          parsed.scanners = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          break;
        case '--block-on':
          parsed.policy = {
            ...parsed.policy,
            blockOnSeverity: value.split(',').map((s) => s.trim().toUpperCase()) as Policy['blockOnSeverity'],
          };
          break;
      }
      continue;
    }
    switch (flag) {
      case '--offline':
        parsed.offline = true;
        break;
      case '--json':
        parsed.json = true;
        parsed.format = 'json';
        break;
      case '--format': {
        const value = flags[++i];
        if (value !== 'json' && value !== 'markdown' && value !== 'sarif')
          throw new Error(`--format must be json, markdown, or sarif (got '${value}')`);
        parsed.format = value;
        if (value === 'json') parsed.json = true;
        break;
      }
      case '--no-tests':
        parsed.noTests = true;
        break;
      case '--staged':
        parsed.staged = true;
        break;
      case '--strict':
        parsed.strict = true;
        break;
      case '--pre-push':
        parsed.prePush = true;
        break;
      case '--force':
        parsed.force = true;
        break;
      case '-y':
      case '--yes':
        parsed.yes = true;
        break;
      case '-h':
      case '--help':
        return parsed;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown option: ${flag}`);
        if (command === 'config') {
          // `veylqorix config validate <policy-file>`: the positional is the file.
          parsed.policyFile = path.resolve(flag);
        } else if (command === 'hooks') {
          // Any bare positional after `hooks install|uninstall` is the root.
          if (parsed.root === cwd) parsed.root = path.resolve(flag);
        } else if (parsed.root === cwd && !isKnownCommand(flag)) {
          // A bare positional is the root for scan/check/report.
          parsed.root = path.resolve(flag);
        } else if (isKnownCommand(flag)) {
          // Legacy single-word subcommands after the main one are ignored.
        }
    }
  }

  if (command === 'hooks') {
    parsed.hooksSub = isHooks && argv[1] === 'remove' ? 'uninstall' : 'install';
  }
  parsed.root = path.resolve(parsed.root);
  return parsed;
}

/** True when `-h` / `--help` was requested. */
export function wantsHelp(argv: string[]): boolean {
  const first = argv[0];
  const isConfig = first === 'config' && argv[1] === 'validate';
  const isHooks = first === 'hooks' && HOOK_SUBCOMMANDS.has(argv[1] ?? '');
  const flags = isConfig || isHooks ? argv.slice(2) : argv.slice(1);
  return flags.includes('-h') || flags.includes('--help');
}
