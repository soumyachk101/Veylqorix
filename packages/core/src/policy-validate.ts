/**
 * Load and validate a Veylqorix policy file (JSON or JSON5-tolerant JSON).
 *
 * A policy file may contain any subset of `Policy` fields plus `exceptions`.
 * Validation reports precise, actionable problems instead of throwing, so the
 * CLI can print them and exit non-zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIDENCES,
  SEVERITIES,
  type Policy,
  type ResolvedPolicy,
  type Severity,
} from './types.js';
import { resolvePolicy } from './policy.js';

export interface PolicyValidationIssue {
  level: 'ERROR' | 'WARNING';
  field: string;
  message: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  issues: PolicyValidationIssue[];
  /** The fully resolved policy when input was valid enough to resolve. */
  resolved?: ResolvedPolicy;
}

/** Well-known policy file names, in order of preference. */
export const POLICY_FILE_NAMES = ['veylqorix-policy.json', '.veylqorix-policy.json', 'veylqorix.policy.json'];

/** Find the first existing policy file in `root`; undefined when none exists. */
export function findPolicyFile(root: string): string | undefined {
  for (const name of POLICY_FILE_NAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Load a policy file path; parses JSON and returns the raw object plus any parse issues. */
export function loadPolicyFile(filePath: string): { raw: unknown; parseIssues: PolicyValidationIssue[] } {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      raw: undefined,
      parseIssues: [
        { level: 'ERROR', field: 'file', message: `Cannot read ${filePath}: ${(error as Error).message}` },
      ],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      raw: undefined,
      parseIssues: [
        { level: 'ERROR', field: 'file', message: `Invalid JSON: ${(error as Error).message}` },
      ],
    };
  }
  return { raw, parseIssues: [] };
}

/** Validate a raw policy object against the Policy schema. */
export function validatePolicyObject(raw: unknown): PolicyValidationResult {
  const issues: PolicyValidationIssue[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ level: 'ERROR', field: '(root)', message: 'A policy must be a JSON object.' });
    return { valid: false, issues };
  }

  const obj = raw as Record<string, unknown>;
  const knownFields: (keyof Policy)[] = [
    'blockOnSeverity',
    'blockOnSecrets',
    'blockOnTestFailure',
    'blockOnScannerError',
    'blockOnSkippedCheck',
    'reportOnSeverity',
    'maxExceptions',
    'exceptions',
  ];
  for (const key of Object.keys(obj)) {
    if (!(knownFields as string[]).includes(key)) {
      issues.push({
        level: 'WARNING',
        field: key,
        message: `Unknown policy field '${key}' is ignored; did you mean one of: ${knownFields.join(', ')}?`,
      });
    }
  }

  const checkSeverityList = (field: string, value: unknown): Severity[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      issues.push({ level: 'ERROR', field, message: `'${field}' must be an array of severities.` });
      return [];
    }
    const invalid = value.filter((s) => !SEVERITIES.includes(s as Severity));
    if (invalid.length > 0) {
      issues.push({
        level: 'ERROR',
        field,
        message: `Invalid severity(ies) in '${field}': ${invalid.join(', ')}. Valid: ${SEVERITIES.join(', ')}.`,
      });
    }
    return value.filter((s) => SEVERITIES.includes(s as Severity)) as Severity[];
  };

  const blockOnSeverity = checkSeverityList('blockOnSeverity', obj.blockOnSeverity);
  const reportOnSeverity = checkSeverityList('reportOnSeverity', obj.reportOnSeverity);

  for (const field of ['blockOnSecrets', 'blockOnTestFailure', 'blockOnScannerError', 'blockOnSkippedCheck']) {
    if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
      issues.push({ level: 'ERROR', field, message: `'${field}' must be a boolean.` });
    }
  }

  if (obj.maxExceptions !== undefined) {
    if (typeof obj.maxExceptions !== 'number' || obj.maxExceptions < 0 || !Number.isInteger(obj.maxExceptions)) {
      issues.push({ level: 'ERROR', field: 'maxExceptions', message: `'maxExceptions' must be a non-negative integer.` });
    }
  }

  if (obj.exceptions !== undefined) {
    if (!Array.isArray(obj.exceptions)) {
      issues.push({ level: 'ERROR', field: 'exceptions', message: `'exceptions' must be an array.` });
    } else {
      obj.exceptions.forEach((exc, i) => {
        const at = `exceptions[${i}]`;
        if (exc === null || typeof exc !== 'object' || Array.isArray(exc)) {
          issues.push({ level: 'ERROR', field: at, message: 'Each exception must be an object.' });
          return;
        }
        const e = exc as Record<string, unknown>;
        if (typeof e.ruleId !== 'string' || e.ruleId.length === 0) {
          issues.push({ level: 'ERROR', field: `${at}.ruleId`, message: 'Exception must have a non-empty string ruleId.' });
        }
        if (typeof e.reason !== 'string' || e.reason.trim().length === 0) {
          issues.push({ level: 'ERROR', field: `${at}.reason`, message: 'Exception must have a documented reason (required for auditing).' });
        }
        if (e.expires !== undefined && (typeof e.expires !== 'string' || Number.isNaN(Date.parse(e.expires)))) {
          issues.push({ level: 'ERROR', field: `${at}.expires`, message: `'expires' must be an ISO 8601 date string.` });
        }
        if (e.pathGlob !== undefined && typeof e.pathGlob !== 'string') {
          issues.push({ level: 'ERROR', field: `${at}.pathGlob`, message: `'pathGlob' must be a string glob.` });
        }
      });
    }
  }

  // Confidence is not part of the policy but callers sometimes confuse the
  // two; surface a hint when someone tries to key on confidence here.
  if (obj.confidence !== undefined || obj.blockOnConfidence !== undefined) {
    issues.push({
      level: 'WARNING',
      field: 'confidence',
      message: `Confidence is not a policy knob; valid values are ${CONFIDENCES.join(', ')}.`,
    });
  }

  const valid = issues.every((i) => i.level !== 'ERROR');
  const resolved: PolicyValidationResult = { valid, issues };
  if (valid) {
    const policy: Partial<Policy> = {
      ...(blockOnSeverity.length > 0 ? { blockOnSeverity } : {}),
      ...(reportOnSeverity.length > 0 ? { reportOnSeverity } : {}),
      ...(obj.blockOnSecrets !== undefined ? { blockOnSecrets: obj.blockOnSecrets as boolean } : {}),
      ...(obj.blockOnTestFailure !== undefined ? { blockOnTestFailure: obj.blockOnTestFailure as boolean } : {}),
      ...(obj.blockOnScannerError !== undefined ? { blockOnScannerError: obj.blockOnScannerError as boolean } : {}),
      ...(obj.blockOnSkippedCheck !== undefined ? { blockOnSkippedCheck: obj.blockOnSkippedCheck as boolean } : {}),
      ...(obj.maxExceptions !== undefined ? { maxExceptions: obj.maxExceptions as number } : {}),
      ...(Array.isArray(obj.exceptions) ? { exceptions: obj.exceptions as Policy['exceptions'] } : {}),
    };
    resolved.resolved = resolvePolicy(policy);
  }
  return resolved;
}

/** Validate a policy file on disk. */
export function validatePolicyFile(filePath: string): PolicyValidationResult {
  const { raw, parseIssues } = loadPolicyFile(filePath);
  if (raw === undefined) {
    return { valid: false, issues: parseIssues };
  }
  const result = validatePolicyObject(raw);
  result.issues = [...parseIssues, ...result.issues];
  result.valid = result.valid && parseIssues.every((i) => i.level !== 'ERROR');
  return result;
}
