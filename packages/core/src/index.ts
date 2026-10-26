export * from './types.js';
export * from './policy.js';
export { findingId, makeFinding } from './finding.js';
export * from './detect.js';
export { runAudit, type AuditOptions, type AuditResultWithExit } from './audit.js';
export { exitCodeFor, evaluateGate } from './gate/index.js';
export { toJson, toMarkdown, toSarif, renderAllReports, validateSarifFile, type ReportOutputs, type RenderedReports, type SarifValidation } from './report/index.js';
export { globMatch } from './policy.js';
export { validatePath, relativeToRoot, PathValidationError, type WorkspaceRoots } from './util/paths.js';
export {
  runScannerSafely,
  normalizeFindings,
  withTimeout,
  TimeoutError,
  type ScannerContext,
  type ScannerDefinition,
} from './scanners/registry.js';
export { dependencyScanner, type DependencyScanOptions } from './scanners/dependencies.js';
export { listStagedFiles, isGitRepository } from './util/git.js';
export { installHooks, uninstallHooks, runStagedScan, type HookInstallOptions, type HookInstallResult } from './util/hooks.js';
export {
  validatePolicyObject,
  validatePolicyFile,
  loadPolicyFile,
  findPolicyFile,
  POLICY_FILE_NAMES,
  type PolicyValidationResult,
  type PolicyValidationIssue,
} from './policy-validate.js';
export { scanSecrets, redactSecret, type SecretScanOptions } from './scanners/secrets.js';
export { scanLicenses, type LicenseScanOptions } from './scanners/licenses.js';
export { detectChecks, runCheck, type QualityCheckOptions } from './scanners/quality.js';
export { execFileAsync, ExecError, extractJson, sha256 } from './util/exec.js';
export {
  RustEngineAdapter,
  createEngineAdapter,
  resolveEngineBinary,
  isEngineAvailable,
  EngineError,
  EngineUnavailableError,
  EngineProtocolError,
  EngineResponseError,
  EngineTimeoutError,
  PROTOCOL_VERSION,
  ENGINE_EXIT,
  type EngineResponse,
  type EngineScanOptions,
  type EngineEvaluateOptions,
  type RustEngineAdapterOptions,
} from './engine/index.js';
