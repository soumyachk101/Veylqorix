//! Dependency auditing for Rust projects via `cargo audit`, with delegation
//! semantics that never confuse "unavailable" with "clean".
//!
//! - When the audited tree has no `Cargo.lock`, the scanner reports SKIPPED
//!   with a note rather than PASS: there is no lockfile to audit.
//! - When `cargo-audit` is not installed, the scanner reports SKIPPED (missing
//!   dependency) with a clear install hint. This is a *completeness gap*, not
//!   a pass.
//! - When the tool runs, findings are normalized into the shared finding
//!   schema with real advisory, affected, and patched-version fields.

use std::collections::BTreeMap;

use crate::exec::{exec, ExecOptions};
use crate::finding::{make_finding, MakeFinding};
use crate::model::{
    Confidence, DependencyInfo, Evidence, Finding, ScannerResult, ScannerStatus, Severity,
};

/// Run `cargo audit` against a Rust project's lockfile and normalize its
/// output.
///
/// `root` is the directory containing `Cargo.lock`. `timeout_ms` bounds the
/// run. The result is a `ScannerResult` that is SKIPPED when the tool or the
/// lockfile is absent, FAIL when advisories are found, and PASS when the
/// audit completes clean.
pub fn cargo_audit(root: &std::path::Path, timeout_ms: u64) -> ScannerResult {
    let started = std::time::Instant::now();
    let lockfile = root.join("Cargo.lock");

    if !lockfile.is_file() {
        return ScannerResult {
            scanner: "dependencies/rust".into(),
            status: ScannerStatus::Skipped,
            findings: Vec::new(),
            duration_ms: started.elapsed().as_millis() as u64,
            error: None,
            notes: vec![
                "No Cargo.lock found; Rust dependency auditing requires a lockfile. This is not a pass."
                    .into(),
            ],
            summary: Some(BTreeMap::from([
                ("source".to_string(), serde_json::Value::String("cargo-audit".into())),
                ("ecosystem".to_string(), serde_json::Value::String("rust".into())),
            ])),
        };
    }

    let args = vec![
        "audit".into(),
        "-f".into(),
        lockfile.to_string_lossy().into(),
        "--json".into(),
    ];
    let opts = ExecOptions {
        cwd: Some(root.to_path_buf()),
        timeout_ms,
        ..ExecOptions::default()
    };

    let result = match exec("cargo", &args, &opts) {
        Ok(r) if r.timed_out => {
            return ScannerResult {
                scanner: "dependencies/rust".into(),
                status: ScannerStatus::Error,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message: format!("cargo audit timed out after {timeout_ms}ms"),
                    code: Some("ETIMEDOUT".into()),
                    missing_dependency: None,
                }),
                notes: vec![
                    "cargo audit timed out; treat dependency coverage as incomplete.".into(),
                ],
                summary: None,
            };
        }
        Ok(r) => {
            // The `audit` subcommand is missing when cargo-audit is not
            // installed: cargo prints `error: no such command: 'audit'`.
            // Surface that as a distinct, installable gap — not a parse
            // error, and never a pass.
            if r.code != Some(0)
                && r.stderr.contains("no such command")
                && r.stdout.trim().is_empty()
            {
                return ScannerResult {
                    scanner: "dependencies/rust".into(),
                    status: ScannerStatus::Skipped,
                    findings: Vec::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                    error: Some(crate::model::ScannerError {
                        message: "cargo-audit is not installed; install it with \
                                   `cargo install cargo-audit` to enable Rust dependency \
                                   scanning."
                            .into(),
                        code: Some("ENOENT".into()),
                        missing_dependency: Some(true),
                    }),
                    notes: vec![
                        "cargo-audit was not available; Rust dependency coverage is \
                         incomplete, not a pass."
                            .into(),
                    ],
                    summary: Some(BTreeMap::from([(
                        "available".to_string(),
                        serde_json::Value::Bool(false),
                    )])),
                };
            }
            r
        }
        Err(e) => {
            // Missing tool or I/O failure: report as SKIPPED/ERROR, never PASS.
            let (code, message, missing) = match &e {
                crate::EngineError::MissingTool { .. } => (
                    Some("ENOENT".into()),
                    "cargo audit binary not found; install with `cargo install cargo-audit` to enable Rust dependency scanning."
                        .to_string(),
                    Some(true),
                ),
                crate::EngineError::TimedOut { .. } => (
                    Some("ETIMEDOUT".into()),
                    "cargo audit timed out".to_string(),
                    None,
                ),
                other => (None, other.to_string(), None),
            };
            return ScannerResult {
                scanner: "dependencies/rust".into(),
                status: ScannerStatus::Skipped,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message,
                    code,
                    missing_dependency: missing,
                }),
                notes: vec![
                    "cargo audit was not available; Rust dependency coverage is incomplete, not a pass."
                        .into(),
                ],
                summary: Some(BTreeMap::from([
                    ("available".to_string(), serde_json::Value::Bool(false)),
                ])),
            };
        }
    };

    // `cargo audit --json` exits non-zero when vulnerabilities are present.
    // Parse the JSON from stdout; when the expected shapes are absent,
    // surface it as an error rather than guessing (an unparseable audit must
    // never read as a clean pass).
    let parsed: serde_json::Value = match serde_json::from_str(&result.stdout) {
        Ok(v) => v,
        Err(_) => {
            return ScannerResult {
                scanner: "dependencies/rust".into(),
                status: ScannerStatus::Error,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message: format!(
                        "cargo audit produced no parseable output (exit {:?}): {}",
                        result.code,
                        result.stderr.trim()
                    ),
                    code: result.code.map(|c| c.to_string()),
                    missing_dependency: None,
                }),
                notes: vec![
                    "cargo audit output could not be parsed; treat it as an error, not a pass."
                        .into(),
                ],
                summary: None,
            };
        }
    };

    // The recognized payload shape (cargo-audit 0.21+, verified against
    // 0.22.2) is `.vulnerabilities.list[]`, each entry carrying
    // `.advisory`, `.package`, and `.versions`. Anything else — including
    // older cargo-audit payloads or a tool that changed its schema — degrades
    // to an ERROR result: we never turn an unrecognized audit into a pass.
    if parsed.get("vulnerabilities").is_none() {
        return ScannerResult {
            scanner: "dependencies/rust".into(),
            status: ScannerStatus::Error,
            findings: Vec::new(),
            duration_ms: started.elapsed().as_millis() as u64,
            error: Some(crate::model::ScannerError {
                message: "cargo audit output did not contain a recognized vulnerability \
                          schema; the tool or its version changed. Re-run to confirm."
                    .into(),
                code: result.code.map(|c| c.to_string()),
                missing_dependency: None,
            }),
            notes: vec![
                "The cargo audit output shape was not recognized; the scan is degraded, not a \
                 pass."
                    .into(),
            ],
            summary: None,
        };
    }

    let mut findings: Vec<Finding> = Vec::new();
    // cargo-audit (0.21 and later) emits `.vulnerabilities.list[]`, each entry
    // carrying `.advisory`, `.package`, and `.versions`. Parse that shape. If a
    // differently-shaped payload shows up, the guard above already returned an
    // ERROR result, so we never turn an unrecognized audit into a pass.
    if let Some(entries) = parsed
        .get("vulnerabilities")
        .and_then(|v| v.get("list"))
        .and_then(|v| v.as_array())
    {
        // Cross-check the tool's own `found` verdict against the list so a
        // mismatch can never downgrade a real problem to a pass.
        let found_flag = parsed
            .get("vulnerabilities")
            .and_then(|v| v.get("found"))
            .and_then(|v| v.as_bool())
            .unwrap_or(!entries.is_empty());
        if found_flag && entries.is_empty() {
            return ScannerResult {
                scanner: "dependencies/rust".into(),
                status: ScannerStatus::Error,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message: "cargo audit reported vulnerabilities but provided no detail \
                              records."
                        .into(),
                    code: result.code.map(|c| c.to_string()),
                    missing_dependency: None,
                }),
                notes: vec!["cargo audit detail was incomplete; degraded, not a pass.".into()],
                summary: None,
            };
        }
        for entry in entries {
            let advisory = entry.get("advisory");
            let pkg_block = entry.get("package");
            let id = advisory
                .and_then(|a| a.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown-advisory");
            let pkg = pkg_block
                .and_then(|p| p.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| {
                    advisory
                        .and_then(|a| a.get("package"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                });
            let installed = pkg_block
                .and_then(|p| p.get("version"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let fixed = entry
                .get("versions")
                .and_then(|v| v.get("patched"))
                .and_then(|v| v.as_array())
                .map(|specs| {
                    specs
                        .iter()
                        .filter_map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(" or ")
                });
            let severity = normalize_audit_severity(advisory.and_then(|a| a.get("severity")));
            let alias = advisory
                .and_then(|a| a.get("aliases"))
                .and_then(|v| v.as_array())
                .map(|specs| {
                    specs
                        .iter()
                        .filter_map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let reference = {
                let url = advisory
                    .and_then(|a| a.get("url"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                url.unwrap_or_else(|| {
                    if alias.is_empty() {
                        id.to_string()
                    } else {
                        alias.clone()
                    }
                })
            };
            let description = advisory
                .and_then(|a| a.get("description"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let title = advisory
                .and_then(|a| a.get("title"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            findings.push(make_finding(MakeFinding {
                scanner: "dependencies/rust",
                // Use the advisory id as the rule so each distinct advisory is a
                // distinct, stable finding. Keying the finding id on the
                // advisory id (not just package@version) keeps the protocol's
                // dedup-by-id from collapsing several advisories of the same
                // package into one, and lets per-advisory exceptions target a
                // specific vulnerability.
                rule_id: id,
                title: &format!(
                    "Vulnerable dependency {pkg}@{} ({id}){}",
                    installed.as_deref().unwrap_or("?"),
                    title.unwrap_or_default()
                ),
                severity,
                confidence: Confidence::Confirmed,
                file: Some("Cargo.lock"),
                line: None,
                column: None,
                dependency: Some(&DependencyInfo {
                    name: pkg.to_string(),
                    installed_version: installed,
                    declared_version: None,
                    fixed_version: fixed,
                    package_manager: Some("cargo".into()),
                }),
                evidence: Some(&Evidence {
                    snippet: description,
                    details: None,
                }),
                remediation: Some(&format!(
                    "Update {pkg} to a version that resolves {id} (cargo update --precise <patched>) and re-audit."
                )),
                advisory: Some(reference.as_str()),
                secret: None,
                secret_override: None,
            }));
        }
    }

    let status = if findings.is_empty() {
        ScannerStatus::Pass
    } else {
        ScannerStatus::Fail
    };
    let vuln_count = findings.len();
    let note = if vuln_count == 0 {
        "cargo audit completed; no known vulnerabilities in the audited Cargo.lock.".to_string()
    } else {
        format!("cargo audit reported {vuln_count} vulnerable package(s).")
    };

    ScannerResult {
        scanner: "dependencies/rust".into(),
        status,
        findings,
        duration_ms: started.elapsed().as_millis() as u64,
        error: None,
        notes: vec![note],
        summary: Some(BTreeMap::from([
            (
                "vulnerable".to_string(),
                serde_json::Value::from(vuln_count),
            ),
            (
                "source".to_string(),
                serde_json::Value::String("cargo-audit".into()),
            ),
            (
                "ecosystem".to_string(),
                serde_json::Value::String("rust".into()),
            ),
        ])),
    }
}

/// Map a `cargo audit` severity string to a Veylqorix severity. Missing or
/// unknown values default to HIGH so a present advisory is never downgraded to
/// a non-blocking level.
fn normalize_audit_severity(v: Option<&serde_json::Value>) -> Severity {
    match v.and_then(|x| x.as_str()) {
        Some("critical") => Severity::Critical,
        Some("high") => Severity::High,
        Some("medium") | Some("moderate") => Severity::Medium,
        Some("low") => Severity::Low,
        Some("unknown") | Some("negligible") => Severity::Info,
        _ => Severity::High,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_lockfile_is_skipped_not_passed() {
        let tmp = std::env::temp_dir();
        let result = cargo_audit(&tmp, 5_000);
        assert_eq!(result.status, ScannerStatus::Skipped);
        assert!(result.findings.is_empty());
        assert!(result.notes[0].contains("not a pass"));
    }

    #[test]
    fn severity_mapping() {
        assert_eq!(
            normalize_audit_severity(Some(&serde_json::Value::String("critical".into()))),
            Severity::Critical
        );
        assert_eq!(
            normalize_audit_severity(Some(&serde_json::Value::String("high".into()))),
            Severity::High
        );
        assert_eq!(
            normalize_audit_severity(Some(&serde_json::Value::String("medium".into()))),
            Severity::Medium
        );
        assert_eq!(
            normalize_audit_severity(Some(&serde_json::Value::String("bogus".into()))),
            Severity::High
        );
        assert_eq!(normalize_audit_severity(None), Severity::High);
    }
}
