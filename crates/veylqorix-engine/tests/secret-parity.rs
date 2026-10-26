//! Secret-scanner parity: the Rust scanner must produce the same finding ids,
//! line/column, and redacted snippets as the TypeScript scanner on the same
//! fixtures. Golden values were captured from `packages/core` and are asserted
//! here so the two implementations stay locked together.

use veylqorix_engine::redact::redact_secret;
use veylqorix_engine::secrets::{match_rules, should_scan};

/// Contents of `tests/fixtures/secret-repo/config.js` (the fake, committed
/// test secrets — never a real credential).
const SECRET_FIXTURE: &str = "\
// FAKE TEST SECRET - not a real credential, safe to commit.
const AWS_KEY = 'AKIA0123456789ABCDEF';
const GITHUB_TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789';
module.exports = { AWS_KEY, GITHUB_TOKEN };
";

#[test]
fn secret_fixture_yields_the_ts_golden_findings() {
    let files = vec![("config.js".to_string(), SECRET_FIXTURE.to_string())];
    let findings = match_rules(&files);

    let by_rule: std::collections::HashMap<&str, &veylqorix_engine::model::Finding> =
        findings.iter().map(|f| (f.rule_id.as_str(), f)).collect();

    let aws = by_rule
        .get("aws-access-key-id")
        .expect("the aws-access-key-id rule must fire on the fixture");
    // Golden vector captured from the TypeScript scanner.
    assert_eq!(aws.id, "SECRETS-8C5562BA");
    assert_eq!(aws.location.as_ref().unwrap().line, Some(2));
    assert_eq!(aws.location.as_ref().unwrap().column, Some(18));
    assert_eq!(
        aws.evidence.as_ref().unwrap().snippet.as_deref(),
        Some("AKIA…CDEF (20 chars, redacted)")
    );
    assert_eq!(aws.secret, Some(true));
    assert_eq!(aws.severity, veylqorix_engine::model::Severity::High);

    let ghp = by_rule
        .get("github-github-pat-classic")
        .expect("the ghp_ classic token rule must fire on the fixture");
    assert_eq!(ghp.id, "SECRETS-5833D5DA");
    assert_eq!(ghp.location.as_ref().unwrap().line, Some(3));
    assert_eq!(ghp.location.as_ref().unwrap().column, Some(23));
    assert_eq!(
        ghp.evidence.as_ref().unwrap().snippet.as_deref(),
        Some("ghp_…6789 (50 chars, redacted)")
    );
}

#[test]
fn no_raw_secret_leaks_into_any_finding() {
    let files = vec![("config.js".to_string(), SECRET_FIXTURE.to_string())];
    let findings = match_rules(&files);
    let serialized = serde_json::to_string(&findings).unwrap();
    // The raw fake values must never appear in the findings (redacted).
    assert!(!serialized.contains("AKIA0123456789ABCDEF"));
    assert!(!serialized.contains("ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789"));
}

#[test]
fn clean_content_yields_no_findings() {
    let files = vec![("app.ts".to_string(), "export const add = 1;\n".into())];
    let findings = match_rules(&files);
    assert!(findings.is_empty());
}

#[test]
fn should_scan_extends_and_excludes() {
    let extra: Vec<String> = vec![".toml".into()];
    let exclude: Vec<String> = vec!["vendor".into()];
    assert!(should_scan("src/app.ts", &extra, &exclude));
    assert!(should_scan("Cargo.toml", &extra, &exclude));
    assert!(should_scan(".env", &Vec::new(), &Vec::new()));
    assert!(!should_scan("vendor/x.ts", &extra, &exclude));
    assert!(!should_scan("README.md", &Vec::new(), &Vec::new()));
}

#[test]
fn redaction_matches_ts_format() {
    assert_eq!(
        redact_secret("AKIA0123456789ABCDEF"),
        "AKIA…CDEF (20 chars, redacted)"
    );
    assert_eq!(redact_secret("short1"), "****");
}
