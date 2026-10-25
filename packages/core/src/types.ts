/**
 * Shared domain types for the Veylqorix security core.
 *
 * Every scanner, gate decision, and report is expressed in terms of these
 * types so that findings from different tools can be compared and evaluated
 * by a single policy engine.
 */

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Ordered from least to most severe, so severities can be compared numerically. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH', 'CONFIRMED'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CONFIRMED: 3,
};

/** Outcome of running a single scanner. */
export type ScannerStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';

/** Overall verdict produced by the quality gate. */
export type GateResult = 'PASS' | 'FAIL' | 'INCOMPLETE';

/** Coverage level achieved by an audit, given what the scanners could detect. */
export type CoverageLevel = 'FULL' | 'PARTIAL' | 'LIMITED' | 'NONE';

export type Ecosystem =
  | 'node'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'
  | 'php'
  | 'dotnet'
  | 'unknown';

export interface Location {
  /** Path relative to the audited workspace root, always POSIX separators. */
  file: string;
  line?: number;
  column?: number;
}

export interface Evidence {
  /** Human-readable snippet, already redacted for secret findings. */
  snippet?: string;
  /** Extra structured detail safe to serialize. */
  details?: Record<string, string | number | boolean | string[]>;
}

export interface Finding {
  /** Stable identifier, e.g. `DEP-NPM-1093-4f2a`. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Scanner that produced the finding, e.g. `dependencies`, `secrets`, `quality`. */
  scanner: string;
  /** Scanner-specific rule identifier, e.g. `npm-audit`, `aws-access-key-id`. */
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  location?: Location;
  /** Dependency ecosystem, when the finding concerns a package. */
  dependency?: {
    name: string;
    /** Version resolved from the lockfile or installed tree. */
    installedVersion?: string;
    /** Version range declared in the manifest. */
    declaredVersion?: string;
    /** Version that resolves the advisory, when known. */
    fixedVersion?: string;
    packageManager?: string;
  };
  evidence?: Evidence;
  remediation?: string;
  /** Advisory reference such as a CVE or GHSA identifier, or a documentation URL. */
  advisory?: string;
  /** True when the finding describes an exposed secret rather than a code defect. */
  secret?: boolean;
}

export interface ScannerError {
  message: string;
  /** The underlying error type, e.g. `ETIMEDOUT`, `ENOENT`. */
  code?: string;
  /** Whether the scanner failed because of an unmet external dependency. */
  missingDependency?: boolean;
}

export interface ScannerResult {
  scanner: string;
  status: ScannerStatus;
  /** Normalized findings. Empty when the scanner did not run or found nothing. */
  findings: Finding[];
  /** Seconds the scanner took to execute. */
  durationMs: number;
  /** Present when status is ERROR. */
  error?: ScannerError;
  /** Human-readable notes about scope, skipped checks, or degraded coverage. */
  notes: string[];
  /** Structured summary counts for reporting. */
  summary?: Record<string, number | string | boolean>;
}

export interface ProjectDetection {
  ecosystem: Ecosystem;
  /** Package manager inferred from lockfiles, e.g. `npm`, `pnpm`, `uv`. */
  packageManager?: string;
  /** Detected manifest files, relative to the root. */
  manifests: string[];
  /** Detected lockfiles, relative to the root. */
  lockfiles: string[];
  /** Whether the project is inside a git repository. */
  gitRepository: boolean;
  /** Languages detected from file extensions. */
  languages: string[];
  /** Why the ecosystem was classified this way. */
  reasons: string[];
}

export interface CheckResult {
  /** Stable identifier, e.g. `typescript`, `eslint`, `pytest`. */
  id: string;
  /** The exact command that was executed. */
  command: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';
  durationMs: number;
  /** Trimmed output, truncated to a safe length. */
  output?: string;
  error?: ScannerError;
  /** Why the check was skipped. */
  reason?: string;
}

export interface GateDecision {
  result: GateResult;
  /** Rule identifiers that caused a BLOCK. */
  blockingReasons: string[];
  /** Findings reported but not blocking. */
  reportedFindings: Finding[];
  /** Scanners or checks that were skipped or errored and reduced coverage. */
  incompleteReasons: string[];
  coverage: CoverageLevel;
  /** Applied exceptions, for auditing. */
  appliedExceptions: AppliedException[];
}

export interface AppliedException {
  ruleId: string;
  reason: string;
  /** How many findings the exception suppressed. */
  suppressed: number;
}

export interface AuditResult {
  /** Absolute path of the audited root. */
  root: string;
  /** ISO timestamp of when the audit ran. */
  startedAt: string;
  durationMs: number;
  detection: ProjectDetection;
  scanners: ScannerResult[];
  findings: Finding[];
  checks: CheckResult[];
  gate: GateDecision;
  coverage: CoverageLevel;
  /** The policy that was evaluated. */
  policy: ResolvedPolicy;
}

export interface PolicyException {
  /** Rule identifier this exception applies to. */
  ruleId: string;
  /** Documented justification, required. */
  reason: string;
  /** Optional expiry date (ISO 8601) after which the exception is ignored. */
  expires?: string;
  /** Optional path glob the exception is restricted to. */
  pathGlob?: string;
}

export interface Policy {
  /** Severities that block the gate. */
  blockOnSeverity: Severity[];
  /** Whether any exposed secret blocks the gate. */
  blockOnSecrets: boolean;
  /** Whether failing required tests block the gate. */
  blockOnTestFailure: boolean;
  /** Whether scanner execution errors block the gate. */
  blockOnScannerError: boolean;
  /** Whether an unexpectedly skipped mandatory check blocks the gate. */
  blockOnSkippedCheck: boolean;
  /** Severities that are reported but do not block. */
  reportOnSeverity: Severity[];
  /** Maximum number of findings the exception mechanism may suppress. */
  maxExceptions: number;
  /** Documented, auditable exceptions. */
  exceptions: PolicyException[];
}

export interface ResolvedPolicy {
  policy: Policy;
  /** Notes describing how the effective policy was derived. */
  notes: string[];
}
