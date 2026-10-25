/**
 * Client-side mirror of the Veylqorix API data model.
 *
 * Shapes match `packages/api/src/index.ts` and `packages/core/src/types.ts`
 * (Finding, ScannerResult, GateDecision, ProjectDetection, Policy).
 * They are duplicated here — not imported — because the browser cannot
 * resolve workspace packages at build time.
 */

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH' | 'CONFIRMED';

export type ScannerStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';

export type GateResult = 'PASS' | 'FAIL' | 'INCOMPLETE';

export type CoverageLevel = 'FULL' | 'PARTIAL' | 'LIMITED' | 'NONE';

export interface Repository {
  id: string;
  path: string;
  name: string;
  registeredAt: string;
}

export interface ScanRecordSummary {
  id: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  createdAt: string;
  gate?: GateResult;
  coverage?: CoverageLevel;
  exitCode?: number;
  findingCount?: number;
}

export interface Location {
  file: string;
  line?: number;
  column?: number;
}

export interface Evidence {
  snippet?: string;
  details?: Record<string, string | number | boolean | string[]>;
}

export interface Finding {
  id: string;
  title: string;
  scanner: string;
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  location?: Location;
  dependency?: {
    name: string;
    installedVersion?: string;
    declaredVersion?: string;
    fixedVersion?: string;
    packageManager?: string;
  };
  evidence?: Evidence;
  remediation?: string;
  advisory?: string;
  secret?: boolean;
}

export interface ScannerResult {
  scanner: string;
  status: ScannerStatus;
  findings: Finding[];
  durationMs: number;
  error?: { message: string; code?: string; missingDependency?: boolean };
  notes: string[];
}

export interface CheckResult {
  id: string;
  command: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';
  durationMs: number;
  output?: string;
  reason?: string;
}

export interface AppliedException {
  ruleId: string;
  reason: string;
  suppressed: number;
}

export interface GateDecision {
  result: GateResult;
  blockingReasons: string[];
  reportedFindings: Finding[];
  incompleteReasons: string[];
  coverage: CoverageLevel;
  appliedExceptions: AppliedException[];
}

export interface ProjectDetection {
  ecosystem: string;
  packageManager?: string;
  manifests: string[];
  lockfiles: string[];
  gitRepository: boolean;
  languages: string[];
  reasons: string[];
}

export interface PolicyException {
  ruleId: string;
  reason: string;
  expires?: string;
  pathGlob?: string;
}

export interface Policy {
  blockOnSeverity: Severity[];
  blockOnSecrets: boolean;
  blockOnTestFailure: boolean;
  blockOnScannerError: boolean;
  blockOnSkippedCheck: boolean;
  reportOnSeverity: Severity[];
  maxExceptions: number;
  exceptions: PolicyException[];
}

/** Full detail payload of GET /api/scan/:id. */
export interface ScanDetail {
  id: string;
  repoId: string;
  status: 'RUNNING' | 'DONE' | 'ERROR';
  error?: string;
  gate?: GateDecision;
  coverage?: CoverageLevel;
  exitCode?: number;
  findings?: Finding[];
  scanners?: Pick<ScannerResult, 'scanner' | 'status' | 'notes' | 'error'>[];
  detection?: ProjectDetection;
  policy?: ResolvedPolicy;
  startedAt?: string;
  root?: string;
  durationMs?: number;
  checks?: CheckResult[];
}

export interface ResolvedPolicy {
  policy: Policy;
  notes: string[];
}

/** Payload of GET /api/repo/:id/latest. */
export interface RepoLatest {
  repository: Repository;
  latest:
    | null
    | {
        id: string;
        status: 'RUNNING' | 'DONE' | 'ERROR';
        gate?: GateDecision;
        coverage?: CoverageLevel;
        exitCode?: number;
        findings?: Finding[];
        scanners?: ScannerResult[];
        detection?: ProjectDetection;
        startedAt?: string;
      };
}

export const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const SEVERITIES: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
