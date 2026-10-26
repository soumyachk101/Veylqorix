//! Golden vectors: byte-compatibility with the TypeScript implementation.
//!
//! These values were captured from `packages/core` and must not drift: the
//! finding id and redaction formats are part of the report contract, and
//! reports diff cleanly across engines only when they stay identical.

use veylqorix_engine::finding::{finding_id, make_finding, MakeFinding};
use veylqorix_engine::model::{Confidence, Evidence, Severity};
use veylqorix_engine::redact::redact_secret;

#[test]
fn finding_id_matches_ts_golden_vectors() {
    // Golden vector captured from `packages/core/src/finding.ts`.
    assert_eq!(
        finding_id(
            "dependencies",
            "npm-audit",
            None,
            Some("lodash"),
            Some("4.17.20")
        ),
        "DEPENDENCIES-D2886960"
    );
    assert_eq!(
        finding_id(
            "secrets",
            "aws-access-key-id",
            Some("config.js"),
            None,
            None
        ),
        "SECRETS-8C5562BA"
    );
    assert_eq!(
        finding_id(
            "quality",
            "insecure-code",
            Some("src/app.py"),
            Some("os"),
            None
        ),
        "QUALITY-8A1FB7CE"
    );
}

#[test]
fn make_finding_fills_the_stable_id() {
    let f = make_finding(MakeFinding {
        scanner: "secrets",
        rule_id: "aws-access-key-id",
        title: "AWS access key identifier detected in config.js",
        severity: Severity::High,
        confidence: Confidence::High,
        file: Some("config.js"),
        line: Some(2),
        column: Some(18),
        dependency: None,
        evidence: Some(&Evidence {
            snippet: Some(redact_secret("AKIA0123456789ABCDEF")),
            details: None,
        }),
        remediation: None,
        advisory: None,
        secret: Some(true),
        secret_override: None,
    });
    assert_eq!(f.id, "SECRETS-8C5562BA");
    assert_eq!(f.location.as_ref().unwrap().file, "config.js");
    assert_eq!(f.location.as_ref().unwrap().line, Some(2));
}

#[test]
fn deterministic_across_runs() {
    // Two identical invocations must produce the same id (no timestamps in
    // the basis).
    let a = finding_id("x", "y", Some("f.ts"), None, None);
    let b = finding_id("x", "y", Some("f.ts"), None, None);
    assert_eq!(a, b);
}
