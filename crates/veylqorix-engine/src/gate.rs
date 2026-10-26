//! Deterministic quality-gate evaluation and exit-code mapping.
//!
//! Byte-compatible with `packages/core/src/gate/index.ts` (`evaluateGate`,
//! `exitCodeFor`, `strictExitCode`), cross-verified by the differential test
//! suite in `tests/gate-differential.rs` and `tests/unit/gate.test.ts`.
//!
//! Rules:
//! - A finding at a blocking severity blocks the gate.
//! - An exposed secret blocks when `blockOnSecrets` is true.
//! - A failing required check blocks when `blockOnTestFailure` is true.
//! - A scanner execution error blocks when `blockOnScannerError` is true.
//! - An errored required check blocks when `blockOnSkippedCheck` is true; a
//!   *skipped* mandatory scanner is recorded as a blocking reason for
//!   visibility but degrades coverage to INCOMPLETE rather than forcing FAIL
//!   (a degraded audit is never mistaken for a clean pass).
//! - Any active exception suppresses the findings it matches, but the
//!   exception is recorded in the decision so it can be audited.

use std::cmp::Ordering;

use crate::model::{
    AppliedException, CheckResult, CoverageLevel, Finding, GateDecision, GateResult,
    ResolvedPolicy, ScannerResult,
};
use crate::policy::{compare_findings, glob_match, FindingLike};

/// Evaluate the quality gate over a completed audit.
pub fn evaluate_gate(input: GateInput<'_>) -> GateDecision {
    let GateInput {
        findings,
        checks,
        scanners,
        policy,
    } = input;
    let p = &policy.policy;
    let blocking_severities: std::collections::HashSet<crate::model::Severity> =
        p.block_on_severity.iter().copied().collect();

    // Apply exceptions: suppress matched findings, record the suppression.
    let mut applied_exceptions: Vec<AppliedException> = Vec::new();
    let mut suppressed: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for exc in &p.exceptions {
        let matched: Vec<&Finding> = findings
            .iter()
            .filter(|f| finding_matches_exception(exc, f))
            .collect();
        if !matched.is_empty() {
            for f in &matched {
                suppressed.insert(f.id.as_str());
            }
            applied_exceptions.push(AppliedException {
                rule_id: exc.rule_id.clone(),
                reason: exc.reason.clone(),
                suppressed: matched.len() as u32,
            });
        }
    }

    let effective: Vec<&Finding> = findings
        .iter()
        .filter(|f| !suppressed.contains(f.id.as_str()))
        .collect();

    let blocking: Vec<&Finding> = effective
        .iter()
        .filter(|f| {
            blocking_severities.contains(&f.severity)
                || (p.block_on_secrets && f.secret == Some(true))
        })
        .copied()
        .collect();

    let reported: Vec<&Finding> = effective
        .into_iter()
        .filter(|f| !blocking.iter().any(|b| b.id == f.id))
        .collect();

    let scanner_errors: Vec<&ScannerResult> = scanners
        .iter()
        .filter(|s| s.status == crate::model::ScannerStatus::Error)
        .collect();
    let skipped_mandatory: Vec<&ScannerResult> = scanners
        .iter()
        .filter(|s| s.status == crate::model::ScannerStatus::Skipped)
        .collect();
    let failed_checks: Vec<&CheckResult> = checks
        .iter()
        .filter(|c| c.status == crate::model::ScannerStatus::Fail)
        .collect();
    let errored_checks: Vec<&CheckResult> = checks
        .iter()
        .filter(|c| c.status == crate::model::ScannerStatus::Error)
        .collect();

    let mut blocking_reasons: Vec<String> = Vec::new();
    let mut hard_fail_reasons: Vec<String> = Vec::new();
    for f in &blocking {
        // Byte-compatible with the TS reason string:
        // `${secret ? 'Exposed secret' : `${severity} finding`} ${id} (${scanner}/${ruleId}): ${title}`
        let reason = if f.secret == Some(true) {
            format!(
                "Exposed secret {} ({}/{}): {}",
                f.id, f.scanner, f.rule_id, f.title
            )
        } else {
            format!(
                "{} finding {} ({}/{}): {}",
                f.severity, f.id, f.scanner, f.rule_id, f.title
            )
        };
        blocking_reasons.push(reason.clone());
        hard_fail_reasons.push(reason);
    }
    if p.block_on_test_failure {
        for c in &failed_checks {
            let reason = format!("Required check '{}' failed: {}", c.id, c.command);
            blocking_reasons.push(reason.clone());
            hard_fail_reasons.push(reason);
        }
    }
    if p.block_on_scanner_error {
        for s in &scanner_errors {
            let reason = format!(
                "Required scanner '{}' errored: {}",
                s.scanner,
                s.error
                    .as_ref()
                    .map(|e| e.message.clone())
                    .unwrap_or_default()
            );
            blocking_reasons.push(reason.clone());
            hard_fail_reasons.push(reason);
        }
    }
    if p.block_on_skipped_check {
        for c in &errored_checks {
            let reason = format!(
                "Required check '{}' errored: {}",
                c.id,
                c.error
                    .as_ref()
                    .map(|e| e.message.clone())
                    .unwrap_or_default()
            );
            blocking_reasons.push(reason.clone());
            hard_fail_reasons.push(reason);
        }
        for s in &skipped_mandatory {
            blocking_reasons.push(format!(
                "Mandatory scanner '{}' was skipped: {}",
                s.scanner,
                s.notes.first().cloned().unwrap_or_else(|| "no note".into())
            ));
        }
    }

    let completeness_gaps =
        !scanner_errors.is_empty() || !skipped_mandatory.is_empty() || !errored_checks.is_empty();
    let coverage = if !completeness_gaps {
        CoverageLevel::Full
    } else {
        if !skipped_mandatory.is_empty() && !scanner_errors.is_empty() {
            CoverageLevel::Partial
        } else {
            CoverageLevel::Limited
        }
    };

    let mut incomplete_reasons: Vec<String> = Vec::new();
    for s in &scanner_errors {
        incomplete_reasons.push(format!(
            "Scanner '{}' errored: {}",
            s.scanner,
            s.error
                .as_ref()
                .map(|e| e.message.clone())
                .unwrap_or_default()
        ));
    }
    for s in &skipped_mandatory {
        incomplete_reasons.push(format!(
            "Scanner '{}' was skipped: {}",
            s.scanner,
            s.notes.first().cloned().unwrap_or_else(|| "no note".into())
        ));
    }
    for c in &errored_checks {
        incomplete_reasons.push(format!(
            "Check '{}' errored: {}",
            c.id,
            c.error
                .as_ref()
                .map(|e| e.message.clone())
                .unwrap_or_default()
        ));
    }

    let result = if !hard_fail_reasons.is_empty() {
        GateResult::Fail
    } else if completeness_gaps {
        GateResult::Incomplete
    } else {
        GateResult::Pass
    };

    GateDecision {
        result,
        blocking_reasons,
        reported_findings: reported.into_iter().cloned().collect(),
        incomplete_reasons,
        coverage,
        applied_exceptions,
    }
}

/// Inputs for [`evaluate_gate`].
pub struct GateInput<'a> {
    pub findings: &'a [Finding],
    pub checks: &'a [CheckResult],
    pub scanners: &'a [ScannerResult],
    pub policy: &'a ResolvedPolicy,
}

fn finding_matches_exception(exc: &crate::model::PolicyException, finding: &Finding) -> bool {
    if exc.rule_id != finding.rule_id {
        return false;
    }
    if let Some(glob) = &exc.path_glob {
        let file = finding
            .location
            .as_ref()
            .map(|l| l.file.as_str())
            .unwrap_or("");
        if !glob_match(glob, file) {
            return false;
        }
    }
    true
}

/// Deterministic exit code for a gate decision.
///
/// 0 = PASS, 1 = FAIL (blocking reasons present), 2 = INCOMPLETE (no blocking
/// reasons but coverage was degraded).
pub fn exit_code_for(decision: &GateDecision, coverage: CoverageLevel) -> i32 {
    match decision.result {
        GateResult::Fail => 1,
        GateResult::Incomplete => 2,
        GateResult::Pass => {
            if coverage == CoverageLevel::Limited || coverage == CoverageLevel::None {
                2
            } else {
                0
            }
        }
    }
}

/// Strict exit-code mapping: ANY recorded blocking reason forces 1, and ANY
/// completeness gap forces 2, regardless of the policy flags.
pub fn strict_exit_code(decision: &GateDecision, coverage: CoverageLevel) -> i32 {
    if !decision.blocking_reasons.is_empty() {
        return 1;
    }
    if !decision.incomplete_reasons.is_empty()
        || coverage == CoverageLevel::Limited
        || coverage == CoverageLevel::None
    {
        return 2;
    }
    0
}

/// Deterministic comparator kept public for reports.
pub fn findings_ordering(a: &Finding, b: &Finding) -> Ordering {
    let a_like = FindingLike {
        severity: a.severity,
        confidence: a.confidence,
        rule_id: &a.rule_id,
        file: a.location.as_ref().map(|l| l.file.as_str()),
    };
    let b_like = FindingLike {
        severity: b.severity,
        confidence: b.confidence,
        rule_id: &b.rule_id,
        file: b.location.as_ref().map(|l| l.file.as_str()),
    };
    compare_findings(&a_like, &b_like)
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use crate::model::{
        CheckResult, Confidence, Finding, Policy, PolicyException, ScannerResult, ScannerStatus,
        Severity,
    };
    use crate::policy::resolve_policy;

    fn finding(overrides: fn(&mut Finding)) -> Finding {
        let mut f = Finding {
            id: "TEST-00000001".into(),
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
        overrides(&mut f);
        f
    }

    fn scanner(name: &str, status: ScannerStatus) -> ScannerResult {
        ScannerResult {
            scanner: name.into(),
            status,
            findings: Vec::new(),
            duration_ms: 0,
            error: None,
            notes: vec![format!("{name} {}", status)],
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

    fn evaluate(args: EvalArgs) -> (GateDecision, i32) {
        let resolved = resolve_policy(args.policy.as_ref());
        let gate = evaluate_gate(GateInput {
            findings: args.findings.as_slice(),
            checks: args.checks.as_slice(),
            scanners: args.scanners.as_slice(),
            policy: &resolved,
        });
        let code = exit_code_for(&gate, gate.coverage);
        (gate, code)
    }

    #[derive(Default)]
    struct EvalArgs {
        findings: Vec<Finding>,
        checks: Vec<CheckResult>,
        scanners: Vec<ScannerResult>,
        policy: Option<Policy>,
    }

    #[test]
    fn clean_audit_passes_with_exit_0() {
        let mut a = EvalArgs::default();
        a.scanners = vec![
            scanner("dependencies", ScannerStatus::Pass),
            scanner("secrets", ScannerStatus::Pass),
        ];
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Pass);
        assert_eq!(gate.blocking_reasons, Vec::<String>::new());
        assert_eq!(gate.coverage, CoverageLevel::Full);
        assert_eq!(code, 0);
    }

    #[test]
    fn high_finding_fails_gate_with_exit_1() {
        let mut a = EvalArgs::default();
        let f = finding(|f| {
            f.id = "TEST-HIGH".into();
            f.severity = Severity::High;
        });
        a.findings.push(f);
        a.scanners
            .push(scanner("dependencies", ScannerStatus::Fail));
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Fail);
        assert_eq!(gate.blocking_reasons.len(), 1);
        assert!(gate.blocking_reasons[0].contains("HIGH finding"));
        assert_eq!(code, 1);
    }

    #[test]
    fn suppressed_critical_does_not_block_and_is_recorded() {
        let mut a = EvalArgs::default();
        let f = finding(|f| {
            f.id = "TEST-CRIT".into();
            f.severity = Severity::Critical;
            f.rule_id = "vuln-x".into();
            f.location = Some(crate::model::Location {
                file: "src/app.js".into(),
                line: None,
                column: None,
            });
        });
        a.findings.push(f);
        a.scanners
            .push(scanner("dependencies", ScannerStatus::Fail));
        a.policy = Some(Policy {
            exceptions: vec![PolicyException {
                rule_id: "vuln-x".into(),
                reason: "accepted risk until rewrite".into(),
                expires: None,
                path_glob: None,
            }],
            ..crate::policy::default_policy()
        });
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Pass);
        assert_eq!(code, 0);
        assert_eq!(gate.applied_exceptions.len(), 1);
        assert_eq!(gate.applied_exceptions[0].suppressed, 1);
        assert!(gate.reported_findings.is_empty());
    }

    #[test]
    fn secret_blocks_when_block_on_secrets_true() {
        let mut a = EvalArgs::default();
        let f = finding(|f| {
            f.id = "TEST-SEC".into();
            f.secret = Some(true);
            f.severity = Severity::Low;
            f.rule_id = "leak".into();
        });
        a.findings.push(f);
        a.scanners.push(scanner("secrets", ScannerStatus::Fail));
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Fail);
        assert_eq!(code, 1);
        assert!(gate.blocking_reasons[0].contains("Exposed secret"));
    }

    #[test]
    fn secret_does_not_block_when_flag_false_but_is_reported() {
        let mut a = EvalArgs::default();
        let f = finding(|f| {
            f.id = "TEST-SEC".into();
            f.secret = Some(true);
            f.severity = Severity::Low;
        });
        a.findings.push(f);
        a.scanners.push(scanner("secrets", ScannerStatus::Fail));
        a.policy = Some(Policy {
            block_on_secrets: false,
            ..crate::policy::default_policy()
        });
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Pass);
        assert_eq!(code, 0);
        assert_eq!(gate.reported_findings.len(), 1);
    }

    #[test]
    fn scanner_error_incomplete_when_flag_off() {
        let mut a = EvalArgs::default();
        let mut s = scanner("dependencies", ScannerStatus::Error);
        s.error = Some(crate::model::ScannerError {
            message: "npm audit blew up".into(),
            code: None,
            missing_dependency: None,
        });
        a.scanners.push(s);
        a.policy = Some(Policy {
            block_on_scanner_error: false,
            ..crate::policy::default_policy()
        });
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Incomplete);
        assert_ne!(gate.coverage, CoverageLevel::Full);
        assert_eq!(code, 2);
        assert_eq!(gate.incomplete_reasons.len(), 1);
    }

    #[test]
    fn scanner_error_blocks_when_flag_on() {
        let mut a = EvalArgs::default();
        let mut s = scanner("dependencies", ScannerStatus::Error);
        s.error = Some(crate::model::ScannerError {
            message: "npm audit blew up".into(),
            code: None,
            missing_dependency: None,
        });
        a.scanners.push(s);
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Fail);
        assert!(gate.blocking_reasons[0].contains("errored"));
        assert_eq!(code, 1);
    }

    #[test]
    fn skipped_mandatory_scanner_is_incomplete_never_pass() {
        let mut a = EvalArgs::default();
        a.scanners.push(scanner("secrets", ScannerStatus::Pass));
        let mut s = scanner("dependencies", ScannerStatus::Skipped);
        s.notes = vec!["offline; npm audit requires network".into()];
        a.scanners.push(s);
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Incomplete);
        assert_eq!(code, 2);
        assert!(gate.incomplete_reasons[0].contains("was skipped"));
        assert_eq!(gate.blocking_reasons.len(), 1);
    }

    #[test]
    fn failing_required_check_blocks() {
        let mut a = EvalArgs::default();
        a.checks.push(check("tests", ScannerStatus::Fail));
        a.scanners = vec![
            scanner("dependencies", ScannerStatus::Pass),
            scanner("secrets", ScannerStatus::Pass),
        ];
        let (gate, code) = evaluate(a);
        assert_eq!(gate.result, GateResult::Fail);
        assert_eq!(code, 1);
        assert!(gate.blocking_reasons[0].contains("check 'tests' failed"));
    }

    #[test]
    fn exit_code_mapping() {
        let clean: EvalArgs = EvalArgs::default();
        let (g, _c) = evaluate(clean);
        assert_eq!(exit_code_for(&g, g.coverage), 0);
        let mut fail: EvalArgs = EvalArgs::default();
        let f = finding(|f| {
            f.id = "TEST-HI".into();
            f.severity = Severity::High;
        });
        fail.findings.push(f);
        fail.scanners
            .push(scanner("dependencies", ScannerStatus::Fail));
        let (g, _) = evaluate(fail);
        assert_eq!(exit_code_for(&g, g.coverage), 1);
        let mut inc: EvalArgs = EvalArgs::default();
        let mut s = scanner("dependencies", ScannerStatus::Skipped);
        s.notes = vec!["offline".into()];
        inc.scanners.push(s);
        let (g, _) = evaluate(inc);
        assert_eq!(exit_code_for(&g, g.coverage), 2);
    }

    #[test]
    fn strict_exit_never_zero_when_degraded() {
        let mut a = EvalArgs::default();
        let mut s = scanner("dependencies", ScannerStatus::Skipped);
        s.notes = vec!["offline".into()];
        a.scanners.push(s);
        a.policy = Some(Policy {
            block_on_skipped_check: false,
            ..crate::policy::default_policy()
        });
        let (gate, _) = evaluate(a);
        assert_eq!(strict_exit_code(&gate, gate.coverage), 2);
    }
}
