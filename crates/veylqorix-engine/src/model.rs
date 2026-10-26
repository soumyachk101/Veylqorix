//! Normalized schema types shared across the Rust engine and the TypeScript
//! boundary.
//!
//! These structures are the finding/report contract between the engine and
//! the rest of the application. Field names and JSON shapes mirror
//! `packages/core/src/types.ts` exactly so that a `Finding` produced by the
//! Rust engine and one produced by the TypeScript adapters are
//! interchangeable. Serialization is schema-versioned via
//! [`PROTOCOL_VERSION`] in the protocol envelope; the finding fields
//! themselves stay additive (new fields are optional).

use serde::{Deserialize, Serialize};

/// The schema version of the normalized finding/gate report shapes.
pub const SCHEMA_VERSION: u32 = 1;

/// Severity levels, ordered from least to most severe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    /// Numeric order used for deterministic comparison, matching the
    /// TypeScript `SEVERITY_ORDER`.
    pub fn order(self) -> u8 {
        match self {
            Severity::Info => 0,
            Severity::Low => 1,
            Severity::Medium => 2,
            Severity::High => 3,
            Severity::Critical => 4,
        }
    }

    pub const ALL: [Severity; 5] = [
        Severity::Info,
        Severity::Low,
        Severity::Medium,
        Severity::High,
        Severity::Critical,
    ];
}

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Severity::Info => "INFO",
            Severity::Low => "LOW",
            Severity::Medium => "MEDIUM",
            Severity::High => "HIGH",
            Severity::Critical => "CRITICAL",
        };
        f.write_str(s)
    }
}

impl std::str::FromStr for Severity {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "INFO" => Ok(Severity::Info),
            "LOW" => Ok(Severity::Low),
            "MEDIUM" => Ok(Severity::Medium),
            "HIGH" => Ok(Severity::High),
            "CRITICAL" => Ok(Severity::Critical),
            other => Err(format!("invalid severity '{other}'")),
        }
    }
}

/// Confidence in a finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Confidence {
    Low,
    Medium,
    High,
    Confirmed,
}

impl Confidence {
    pub fn order(self) -> u8 {
        match self {
            Confidence::Low => 0,
            Confidence::Medium => 1,
            Confidence::High => 2,
            Confidence::Confirmed => 3,
        }
    }
}

/// Outcome of running a single scanner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ScannerStatus {
    Pass,
    Fail,
    Skipped,
    Error,
}

impl ScannerStatus {
    /// The wire/string form of the status.
    pub fn as_str(self) -> &'static str {
        match self {
            ScannerStatus::Pass => "PASS",
            ScannerStatus::Fail => "FAIL",
            ScannerStatus::Skipped => "SKIPPED",
            ScannerStatus::Error => "ERROR",
        }
    }
}

impl std::fmt::Display for ScannerStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Overall verdict produced by the quality gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum GateResult {
    Pass,
    Fail,
    Incomplete,
}

impl GateResult {
    /// The wire/string form of the result.
    pub fn as_str(self) -> &'static str {
        match self {
            GateResult::Pass => "PASS",
            GateResult::Fail => "FAIL",
            GateResult::Incomplete => "INCOMPLETE",
        }
    }
}

impl std::fmt::Display for GateResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Coverage level achieved by an audit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CoverageLevel {
    Full,
    Partial,
    Limited,
    None,
}

impl CoverageLevel {
    /// The wire/string form of the coverage level.
    pub fn as_str(self) -> &'static str {
        match self {
            CoverageLevel::Full => "FULL",
            CoverageLevel::Partial => "PARTIAL",
            CoverageLevel::Limited => "LIMITED",
            CoverageLevel::None => "NONE",
        }
    }
}

impl std::fmt::Display for CoverageLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Position of a finding in a source file, relative to the audited root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    /// Path relative to the audited workspace root, always POSIX separators.
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
}

/// Safe-to-serialize evidence about a finding. Secret findings carry only
/// the redacted snippet; no raw credential ever appears here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// Human-readable snippet, already redacted for secret findings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// Extra structured detail safe to serialize.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<std::collections::BTreeMap<String, serde_json::Value>>,
}

/// Dependency metadata attached to dependency-audit findings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declared_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fixed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_manager: Option<String>,
}

/// A normalized finding, matching the TypeScript `Finding` shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Stable identifier, e.g. `SECRETS-8C5562BA`.
    pub id: String,
    /// Human-readable title.
    pub title: String,
    /// Scanner that produced the finding, e.g. `secrets`, `dependencies`.
    pub scanner: String,
    /// Scanner-specific rule identifier.
    pub rule_id: String,
    pub severity: Severity,
    pub confidence: Confidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<Location>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency: Option<DependencyInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Evidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
    /// Advisory reference (CVE / GHSA / docs URL).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advisory: Option<String>,
    /// True when the finding describes an exposed secret.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<bool>,
    /// Scan this finding belongs to (set by the orchestrator).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_id: Option<String>,
    /// When this finding was produced (set by the orchestrator).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub found_at: Option<String>,
    /// Verification status for post-fix re-scans.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<String>,
}

/// Structured error for a scanner that could not run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerError {
    pub message: String,
    /// Underlying error code, e.g. `ETIMEDOUT`, `ENOENT`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// True when the scanner failed because an external tool is missing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_dependency: Option<bool>,
}

/// The result of running one scanner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerResult {
    pub scanner: String,
    pub status: ScannerStatus,
    /// Normalized findings. Empty when the scanner did not run or found nothing.
    pub findings: Vec<Finding>,
    /// Seconds the scanner took to execute.
    pub duration_ms: u64,
    /// Present when status is ERROR.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ScannerError>,
    /// Notes about scope, skipped checks, or degraded coverage.
    pub notes: Vec<String>,
    /// Structured summary counts for reporting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<std::collections::BTreeMap<String, serde_json::Value>>,
}

/// Project detection summary produced by the orchestrator (TypeScript) and
/// handed to the engine so the engine can choose scanners without re-walking
/// the tree for the same purpose.
///
/// All fields are optional on the wire so a partial detection (e.g. just
/// `ecosystem`) is accepted; the missing fields fall back to safe defaults
/// rather than rejecting the whole request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetection {
    #[serde(default = "default_ecosystem")]
    pub ecosystem: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub package_manager: Option<String>,
    #[serde(default)]
    pub manifests: Vec<String>,
    #[serde(default)]
    pub lockfiles: Vec<String>,
    #[serde(default)]
    pub git_repository: bool,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub reasons: Vec<String>,
}

fn default_ecosystem() -> String {
    "unknown".to_string()
}

/// A single quality-check result (type, lint, tests, ...).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// Stable identifier, e.g. `typescript`, `eslint`, `pytest`.
    pub id: String,
    /// The exact command that was executed (or would be).
    pub command: String,
    pub status: ScannerStatus,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ScannerError>,
    /// Why the check was skipped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// A documented, auditable exception in a policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyException {
    /// Rule identifier this exception applies to.
    pub rule_id: String,
    /// Documented justification, required.
    pub reason: String,
    /// Optional expiry date (ISO 8601); ignored after this point.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    /// Optional path glob restricting the exception.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_glob: Option<String>,
}

/// The policy the gate evaluates against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    /// Severities that block the gate.
    pub block_on_severity: Vec<Severity>,
    /// Whether any exposed secret blocks the gate.
    pub block_on_secrets: bool,
    /// Whether failing required tests block the gate.
    pub block_on_test_failure: bool,
    /// Whether scanner execution errors block the gate.
    pub block_on_scanner_error: bool,
    /// Whether an unexpectedly skipped mandatory check blocks the gate.
    pub block_on_skipped_check: bool,
    /// Severities that are reported but do not block.
    pub report_on_severity: Vec<Severity>,
    /// Maximum number of findings the exception mechanism may suppress.
    pub max_exceptions: u32,
    /// Documented, auditable exceptions.
    pub exceptions: Vec<PolicyException>,
}

/// The fully resolved policy plus derivation notes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPolicy {
    pub policy: Policy,
    /// Notes describing how the effective policy was derived.
    pub notes: Vec<String>,
}

/// An exception that the gate actually applied, for the audit trail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedException {
    pub rule_id: String,
    pub reason: String,
    /// How many findings the exception suppressed.
    pub suppressed: u32,
}

/// The gate's decision over a completed audit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDecision {
    pub result: GateResult,
    /// Rule identifiers / reasons that caused a BLOCK.
    pub blocking_reasons: Vec<String>,
    /// Findings reported but not blocking.
    pub reported_findings: Vec<Finding>,
    /// Scanners or checks that were skipped or errored and reduced coverage.
    pub incomplete_reasons: Vec<String>,
    pub coverage: CoverageLevel,
    /// Applied exceptions, for auditing.
    pub applied_exceptions: Vec<AppliedException>,
}
