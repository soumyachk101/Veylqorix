/**
 * Secret scanner: detect known high-entropy secret patterns in source files
 * using an offline rule set.
 *
 * Design notes:
 * - No external service is called; the scan runs entirely against local files
 *   so that source code never leaves the machine by default.
 * - Every matched value is masked before it appears in a finding.
 * - High-entropy generic patterns have intentionally LOW confidence; they are
 *   reported to be reviewed, never treated as confirmed leaks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeFinding } from '../finding.js';
import { walk } from '../detect.js';
import type { Finding, ProjectDetection, ScannerResult } from '../types.js';

export interface SecretScanOptions {
  /** Extra file extensions to scan beyond the defaults. */
  extraExtensions?: string[];
  /** Files and directories to exclude, relative to the audit root. */
  exclude?: string[];
  /** Optional deterministic mock findings for tests. */
  mockFindings?: Finding[];
}

const DEFAULT_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.sh', '.yaml', '.yml', '.json', '.env']);

interface SecretRule {
  name: string;
  description: string;
  pattern: RegExp;
  /** Capture group index that holds the secret value. */
  secretGroup: number;
  severity: Finding['severity'];
  confidence: Finding['confidence'];
  /** Advisory or documentation reference. */
  advisory?: string;
  remediation: string;
}

const RULES: SecretRule[] = [
  {
    name: 'aws-access-key-id',
    description: 'AWS access key identifier',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'HIGH',
    advisory: 'https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys',
    remediation: 'Remove the key from source control, rotate it in the AWS IAM console, and load it from an environment variable or secret manager at runtime.',
  },
  {
    name: 'github-personal-access-token',
    description: 'GitHub personal access token (legacy or fine-grained)',
    pattern: /\b([a-z]{1,5}\d{20,32})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'MEDIUM',
    advisory: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-tokens',
    remediation: 'Revoke the token in GitHub settings, rotate it, and reference it through the environment instead of hardcoding it.',
  },
  {
    name: 'github-github-pat-classic',
    description: 'Classic GitHub personal access token (ghp_, gho_, etc.)',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'HIGH',
    advisory: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-personal-access-tokens',
    remediation: 'Revoke the token, rotate it, and load it from an environment variable.',
  },
  {
    name: 'slack-token',
    description: 'Slack bot or user token',
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,255})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'HIGH',
    remediation: 'Revoke the token in the Slack API dashboard and load it from an environment variable.',
  },
  {
    name: 'private-key-block',
    description: 'PEM-encoded private key material',
    pattern: /-----BEGIN (RSA|EC|DSA|OPENSSH|ENCRYPTED)? ?PRIVATE KEY-----/g,
    secretGroup: 0,
    severity: 'CRITICAL',
    confidence: 'HIGH',
    remediation: 'Remove the key from the repository, rotate the key pair, and add the key to git history cleanup if it was committed.',
  },
  {
    name: 'openai-api-key',
    description: 'OpenAI API key',
    pattern: /\b(sk-[A-Za-z0-9]{20,})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'MEDIUM',
    remediation: 'Revoke the key in the provider dashboard and load it from an environment variable.',
  },
  {
    name: 'anthropic-api-key',
    description: 'Anthropic API key',
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    secretGroup: 1,
    severity: 'HIGH',
    confidence: 'MEDIUM',
    remediation: 'Revoke the key and load it from an environment variable.',
  },
  {
    name: 'google-api-key',
    description: 'Google API key',
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    secretGroup: 1,
    severity: 'MEDIUM',
    confidence: 'MEDIUM',
    remediation: 'Restrict the key in Google Cloud Console and load it from an environment variable.',
  },
  {
    name: 'heroku-api-key',
    description: 'Heroku API key or account email',
    pattern: /\b([a-z]{32}@[a-z0-9.-]+\.[a-z]{2,})\b/g,
    secretGroup: 1,
    severity: 'LOW',
    confidence: 'LOW',
    remediation: 'Confirm whether this is a hardcoded credential and rotate if so.',
  },
];

/**
 * Mask a matched secret value, keeping enough characters to identify it
 * without reproducing it in full.
 */
export function redactSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars, redacted)`;
}

function shouldScan(file: string, extraExtensions?: string[], exclude?: string[]): boolean {
  if (exclude?.some((ex) => file === ex || file.startsWith(ex + '/'))) return false;
  const ext = path.extname(file);
  if (DEFAULT_EXTENSIONS.has(ext)) return true;
  if (extraExtensions?.some((e) => file.endsWith(e))) return true;
  if (path.basename(file).toLowerCase() === '.env') return true;
  return false;
}

export async function scanSecrets(root: string, options: SecretScanOptions = {}): Promise<ScannerResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  const emptyFindings: Finding[] = [];

  if (options.mockFindings !== undefined) {
    return {
      scanner: 'secrets',
      status: options.mockFindings.some((f) => f.secret) ? 'FAIL' : 'PASS',
      findings: options.mockFindings,
      durationMs: Date.now() - startedAt,
      notes: ['Used deterministic mock findings (test mode)'],
    };
  }

  const files = walk(root, { maxDepth: 8, ignore: ['node_modules', '.git', 'dist', 'build'] });

  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const relative of files) {
    if (!shouldScan(relative, options.extraExtensions, options.exclude)) continue;
    const absolute = path.join(root, relative);
    let content: string;
    try {
      content = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    // Skip files that look like binary or are too large.
    if (content.length > 2_000_000 || content.includes('\u0000')) continue;
    filesScanned++;

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(content)) !== null) {
        const value = match[rule.secretGroup] ?? match[0];
        const linesBefore = content.slice(0, match.index).split('\n');
        const line = linesBefore.length;
        const column = (linesBefore[linesBefore.length - 1]?.length ?? 0) + 1;
        findings.push(
          makeFinding({
            scanner: 'secrets',
            ruleId: rule.name,
            title: `${rule.description} detected in ${relative}`,
            severity: rule.severity,
            confidence: rule.confidence,
            file: relative,
            line,
            column,
            evidence: {
              snippet: redactSecret(value),
              details: { rule: rule.name, description: rule.description },
            },
            remediation: rule.remediation,
            advisory: rule.advisory,
            secret: true,
          }),
        );
        if (match[0].length === 0) rule.pattern.lastIndex++;
      }
    }
  }

  const status: ScannerResult['status'] = findings.length > 0 ? 'FAIL' : 'PASS';
  if (findings.length === 0) {
    notes.push(`Scanned ${filesScanned} file(s); no known secret patterns matched. This does not guarantee the absence of secrets.`);
  } else {
    notes.push(`Scanned ${filesScanned} file(s); ${findings.length} potential secret(s) detected and redacted.`);
  }

  return {
    scanner: 'secrets',
    status,
    findings,
    durationMs: Date.now() - startedAt,
    notes,
    summary: { filesScanned, detected: findings.length, source: 'offline-rules' },
  };
}

export const secretScanner: { name: string; run: (d: ProjectDetection, o: SecretScanOptions) => Promise<ScannerResult> } = {
  name: 'secrets',
  run: async (_detection, options) => scanSecrets(optionsRoot(options), options),
};

/** Options object may carry the audit root so the scanner can walk it. */
function optionsRoot(options: SecretScanOptions & { root?: string }): string {
  return (options as { root?: string }).root ?? process.cwd();
}
