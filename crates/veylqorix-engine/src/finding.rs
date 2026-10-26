//! Normalized finding construction with deterministic, stable identifiers.
//!
//! A finding id is derived from stable inputs only (scanner, rule, location,
//! dependency name, version). Identical findings across two runs must
//! produce the same id so reports diff cleanly. The id format and the SHA-1
//! prefix are byte-compatible with the TypeScript implementation in
//! `packages/core/src/finding.ts` (cross-verified against golden vectors in
//! the test suite).

use crate::model::{DependencyInfo, Evidence, Finding, Location};
use digest::Digest;

/// The SHA-1 digest width (hex chars) used for finding ids.
const DIGEST_HEX_LEN: usize = 8;

/// Deterministic, collision-resistant finding id from stable inputs.
///
/// The basis is `scanner|ruleId|location|dependencyName|version` joined by
/// `|`, SHA-1 hashed, first 8 hex chars uppercased, prefixed with the
/// scanner name (uppercased, non-alphanumeric runs collapsed to `-`,
/// truncated to 12 chars).
pub fn finding_id(
    scanner: &str,
    rule_id: &str,
    location: Option<&str>,
    dependency_name: Option<&str>,
    version: Option<&str>,
) -> String {
    let basis = format!(
        "{}|{}|{}|{}|{}",
        scanner,
        rule_id,
        location.unwrap_or(""),
        dependency_name.unwrap_or(""),
        version.unwrap_or("")
    );
    let digest = {
        let mut hasher = sha1::Sha1::new();
        hasher.update(basis.as_bytes());
        let full_hex: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        // The TypeScript implementation takes the first 8 hex characters of
        // the digest (4 bytes), not 8 bytes.
        full_hex[..DIGEST_HEX_LEN].to_uppercase()
    };
    // Prefix: the scanner name uppercased with non-alphanumeric runs collapsed
    // to a single `-`, truncated to 12 chars (byte-compatible with the TS
    // implementation).
    let prefix = {
        let mut out = String::new();
        let mut prev_dash = false;
        for ch in scanner.to_uppercase().chars() {
            if ch.is_ascii_alphanumeric() {
                out.push(ch);
                prev_dash = false;
            } else if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        }
        out
    };
    let prefix: String = prefix.chars().take(12).collect();
    format!("{prefix}-{digest}")
}

fn version_for(dependency: Option<&DependencyInfo>) -> Option<&str> {
    dependency
        .and_then(|d| d.installed_version.as_deref())
        .or_else(|| dependency.and_then(|d| d.fixed_version.as_deref()))
}

/// Build a `Finding` from partial inputs, filling in a deterministic id.
/// Findings are produced by scanners and normalized here so that no scanner
/// can emit a finding without the required fields.
pub fn make_finding(input: MakeFinding<'_>) -> Finding {
    let id = finding_id(
        input.scanner,
        input.rule_id,
        input.file,
        input.dependency.as_ref().map(|d| d.name.as_str()),
        version_for(input.dependency),
    );
    let location = input.file.map(|file| Location {
        file: file.to_string(),
        line: input.line,
        column: input.column,
    });
    Finding {
        id,
        title: input.title.to_string(),
        scanner: input.scanner.to_string(),
        rule_id: input.rule_id.to_string(),
        severity: input.severity,
        confidence: input.confidence,
        location,
        dependency: input.dependency.cloned(),
        evidence: input.evidence.cloned(),
        remediation: input.remediation.map(|s| s.to_string()),
        advisory: input.advisory.map(|s| s.to_string()),
        secret: input.secret.or(input.secret_override),
        scan_id: None,
        found_at: None,
        verification: None,
    }
}

/// Partial inputs for [`make_finding`].
#[derive(Debug)]
pub struct MakeFinding<'a> {
    pub scanner: &'a str,
    pub rule_id: &'a str,
    pub title: &'a str,
    pub severity: crate::model::Severity,
    pub confidence: crate::model::Confidence,
    pub file: Option<&'a str>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub dependency: Option<&'a DependencyInfo>,
    pub evidence: Option<&'a Evidence>,
    pub remediation: Option<&'a str>,
    pub advisory: Option<&'a str>,
    /// Explicit `secret` flag.
    pub secret: Option<bool>,
    /// Convenience: set `secret: Some(true)` when this finding is a leak.
    pub secret_override: Option<bool>,
}
