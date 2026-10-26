//! Differential gate tests: mirror the scenarios in `tests/unit/gate.test.ts`
//! and assert the Rust engine produces the same gate results, reasons, and
//! exit codes. These keep the two implementations locked to each other.

use veylqorix_engine::gate::{evaluate_gate, exit_code_for, GateInput};
use veylqorix_engine::model::{
    CheckResult, Confidence, CoverageLevel, Finding, GateResult, Location, Policy, PolicyException,
    ScannerError, ScannerResult, ScannerStatus, Severity,
};
use veylqorix_engine::policy::{default_policy, resolve_policy};

fn finding(id: &str, mut mutate: impl FnMut(&mut Finding)) -> Finding {
    let mut f = Finding {
        id: id.into(),
        title: "Test finding".into(),
        scanner: "dependencies".into(),
        rule_id: "test-rule".into(),
        severity: Severity::Medium,
        confidence: Confidence::High,
        location: None,
        dependency: None,
        evidence: None,
        remediation: None,
        advisory: None,
        secret: None,
        scan_id: None,
        found_at: None,
        verification: None,
    };
    mutate(&mut f);
    f
}

fn scanner(name: &str, status: ScannerStatus, notes: Vec<String>) -> ScannerResult {
    ScannerResult {
        scanner: name.into(),
        status,
        findings: Vec::new(),
        duration_ms: 0,
        error: None,
        notes,
        summary: None,
    }
}

fn check(id: &str, status: ScannerStatus) -> CheckResult {
    CheckResult {
        id: id.into(),
        command: "echo test".into(),
        status,
        duration_ms: 0,
        output: None,
        error: None,
        reason: None,
    }
}

fn run(
    findings: &[Finding],
    checks: &[CheckResult],
    scanners: &[ScannerResult],
    policy: Option<&Policy>,
) -> (GateResult, Vec<String>, Vec<String>, CoverageLevel, i32) {
    let resolved = resolve_policy(policy);
    let gate = evaluate_gate(GateInput {
        findings,
        checks,
        scanners,
        policy: &resolved,
    });
    let code = exit_code_for(&gate, gate.coverage);
    (
        gate.result,
        gate.blocking_reasons,
        gate.incomplete_reasons,
        gate.coverage,
        code,
    )
}

#[test]
fn clean_audit_passes_with_exit_0() {
    let scanners = [
        scanner("dependencies", ScannerStatus::Pass, vec!["ok".into()]),
        scanner("secrets", ScannerStatus::Pass, vec!["ok".into()]),
    ];
    let (result, blocking, incomplete, coverage, code) = run(&[], &[], &scanners, None);
    assert_eq!(result, GateResult::Pass);
    assert!(blocking.is_empty());
    assert!(incomplete.is_empty());
    assert_eq!(coverage, CoverageLevel::Full);
    assert_eq!(code, 0);
}

#[test]
fn high_finding_fails_gate_with_exit_1() {
    let f = finding("TEST-HIGH", |f| f.severity = Severity::High);
    let scanners = [scanner(
        "dependencies",
        ScannerStatus::Fail,
        vec!["".into()],
    )];
    let (result, blocking, _incomplete, _coverage, code) =
        run(std::slice::from_ref(&f), &[], &scanners, None);
    assert_eq!(result, GateResult::Fail);
    assert_eq!(blocking.len(), 1);
    assert!(blocking[0].contains("HIGH finding"));
    assert_eq!(code, 1);
}

#[test]
fn secret_blocks_by_default_and_is_reported_when_flag_off() {
    let f = finding("TEST-SEC", |f| {
        f.secret = Some(true);
        f.severity = Severity::Low;
    });
    let scanners = [scanner("secrets", ScannerStatus::Fail, vec!["".into()])];
    let (result, blocking, _, _, code) = run(std::slice::from_ref(&f), &[], &scanners, None);
    assert_eq!(result, GateResult::Fail);
    assert!(blocking[0].contains("Exposed secret"));
    assert_eq!(code, 1);

    let policy = Policy {
        block_on_secrets: false,
        ..default_policy()
    };
    let (result, _blocking, _incomplete, _coverage, code) =
        run(std::slice::from_ref(&f), &[], &scanners, Some(&policy));
    assert_eq!(result, GateResult::Pass);
    assert_eq!(code, 0);
}

#[test]
fn scanner_error_incomplete_when_flag_off_and_exit_2() {
    let mut s = scanner("dependencies", ScannerStatus::Error, vec!["".into()]);
    s.error = Some(ScannerError {
        message: "npm audit blew up".into(),
        code: None,
        missing_dependency: None,
    });
    let policy = Policy {
        block_on_scanner_error: false,
        ..default_policy()
    };
    let (result, _blocking, incomplete, coverage, code) =
        run(&[], &[], std::slice::from_ref(&s), Some(&policy));
    assert_eq!(result, GateResult::Incomplete);
    assert_ne!(coverage, CoverageLevel::Full);
    assert_eq!(code, 2);
    assert_eq!(incomplete.len(), 1);
    assert!(incomplete[0].contains("errored"));
}

#[test]
fn scanner_error_blocks_when_flag_on_and_exit_1_wins() {
    let mut s = scanner("dependencies", ScannerStatus::Error, vec!["".into()]);
    s.error = Some(ScannerError {
        message: "npm audit blew up".into(),
        code: None,
        missing_dependency: None,
    });
    let (result, blocking, _incomplete, _coverage, code) =
        run(&[], &[], std::slice::from_ref(&s), None);
    assert_eq!(result, GateResult::Fail);
    assert!(blocking[0].contains("errored"));
    assert_eq!(code, 1);
}

#[test]
fn skipped_mandatory_scanner_is_incomplete_and_exit_2_never_pass() {
    let scanners = [
        scanner("secrets", ScannerStatus::Pass, vec!["ok".into()]),
        scanner(
            "dependencies",
            ScannerStatus::Skipped,
            vec!["offline; npm audit requires network".into()],
        ),
    ];
    let (result, blocking, incomplete, _coverage, code) = run(&[], &[], &scanners, None);
    assert_eq!(result, GateResult::Incomplete);
    assert_eq!(code, 2);
    assert!(incomplete[0].contains("was skipped"));
    assert_eq!(blocking.len(), 1);
}

#[test]
fn skipped_scanner_without_block_flag_still_exit_2_via_coverage() {
    let scanners = [scanner(
        "dependencies",
        ScannerStatus::Skipped,
        vec!["offline".into()],
    )];
    let policy = Policy {
        block_on_skipped_check: false,
        ..default_policy()
    };
    let (result, blocking, _incomplete, coverage, code) = run(&[], &[], &scanners, Some(&policy));
    assert_eq!(result, GateResult::Incomplete);
    assert!(blocking.is_empty());
    assert_ne!(coverage, CoverageLevel::Full);
    assert_eq!(code, 2);
}

#[test]
fn failing_check_blocks_when_flag_on() {
    let checks = [check("tests", ScannerStatus::Fail)];
    let scanners = [scanner(
        "dependencies",
        ScannerStatus::Pass,
        vec!["".into()],
    )];
    let (result, blocking, _incomplete, _coverage, code) = run(&[], &checks, &scanners, None);
    assert_eq!(result, GateResult::Fail);
    assert_eq!(code, 1);
    assert!(blocking[0].contains("check 'tests' failed"));
}

#[test]
fn report_only_policy_keeps_reported_findings_and_passes() {
    let med = finding("TEST-MED", |f| f.severity = Severity::Medium);
    let low = finding("TEST-LOW", |f| f.severity = Severity::Low);
    let scanners = [
        scanner("dependencies", ScannerStatus::Pass, vec!["".into()]),
        scanner("secrets", ScannerStatus::Pass, vec!["".into()]),
    ];
    let policy = Policy {
        block_on_severity: vec![],
        report_on_severity: vec![Severity::Medium, Severity::Low],
        ..default_policy()
    };
    let (result, _blocking, _incomplete, _coverage, code) =
        run(&[med.clone(), low.clone()], &[], &scanners, Some(&policy));
    assert_eq!(result, GateResult::Pass);
    assert_eq!(code, 0);
}

#[test]
fn exception_suppresses_and_records() {
    let f = finding("TEST-CRIT", |f| {
        f.severity = Severity::Critical;
        f.rule_id = "vuln-x".into();
        f.location = Some(Location {
            file: "src/app.js".into(),
            line: None,
            column: None,
        });
    });
    let scanners = [scanner(
        "dependencies",
        ScannerStatus::Fail,
        vec!["".into()],
    )];
    let policy = Policy {
        exceptions: vec![PolicyException {
            rule_id: "vuln-x".into(),
            reason: "accepted risk until rewrite".into(),
            expires: None,
            path_glob: None,
        }],
        ..default_policy()
    };
    let resolved = resolve_policy(Some(&policy));
    let gate = evaluate_gate(GateInput {
        findings: std::slice::from_ref(&f),
        checks: &[],
        scanners: &scanners,
        policy: &resolved,
    });
    assert_eq!(gate.result, GateResult::Pass);
    assert_eq!(gate.applied_exceptions.len(), 1);
    assert_eq!(gate.applied_exceptions[0].suppressed, 1);
    assert!(gate.reported_findings.is_empty());
    assert_eq!(exit_code_for(&gate, gate.coverage), 0);
}
