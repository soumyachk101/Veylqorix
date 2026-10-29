//! Deterministic policy resolution: merge overrides on top of the default
//! policy, drop expired/undocumented exceptions, cap active exceptions at
//! `maxExceptions`, and record derivation notes.
//!
//! Behavior is byte-compatible with `resolvePolicy` in
//! `packages/core/src/policy.ts` (cross-verified by the differential test
//! suite). Exceptions that lack a documented reason or have expired are
//! silently dropped from the resolved policy — an exception is never a
//! way to hide a finding without an auditable justification.

use std::time::SystemTime;

use crate::model::{Policy, PolicyException, ResolvedPolicy, Severity};

/// The default policy: critical/high and secrets block, medium/low report.
///
/// This is a function (not a `const`) because `Policy` owns `Vec` fields; the
/// values it returns are the documented defaults and are stable across builds.
pub fn default_policy() -> Policy {
    Policy {
        block_on_severity: vec![Severity::Critical, Severity::High],
        block_on_secrets: true,
        block_on_test_failure: true,
        block_on_scanner_error: true,
        block_on_skipped_check: true,
        report_on_severity: vec![Severity::Medium, Severity::Low],
        max_exceptions: 5,
        exceptions: Vec::new(),
    }
}

/// Whether an exception is still active: it must have a documented reason and
/// must not be past its optional expiry.
fn is_exception_active(exc: &PolicyException, now: &str) -> bool {
    if let Some(expires) = &exc.expires {
        // Same ordering the TS implementation uses: string compare against an
        // ISO-8601 `now`. ISO-8601 UTC strings sort lexicographically the same
        // way they sort chronologically, so this is correct for well-formed
        // inputs.
        if expires.as_str() < now {
            return false;
        }
    }
    !exc.reason.trim().is_empty()
}

/// Parse an ISO-8601 instant to a comparable string. Used only to *produce*
/// `now` in the same shape the TS implementation compares against.
fn now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Deterministic, UTC, second-precision ISO-8601. Sub-second precision is
    // irrelevant for exception expiry comparisons.
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let (y, mo, d) = civil_from_days(days as i64);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    format!("{y:04}-{mo:02}-{d:02}T{hour:02}:{minute:02}:{second:02}.000Z")
}

/// Howard Hinnant's civil-from-days algorithm (UTC).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 11 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// Merge user overrides on top of the defaults and validate exceptions.
///
/// `input` is an optional partial policy. Only fields that are explicitly
/// present win over the defaults — a `None` field keeps the default, matching
/// the field-by-field merge in the TypeScript `resolvePolicy`.
pub fn resolve_policy(input: Option<&Policy>) -> ResolvedPolicy {
    let mut policy = default_policy();
    if let Some(p) = input {
        policy.block_on_severity = p.block_on_severity.clone();
        policy.block_on_secrets = p.block_on_secrets;
        policy.block_on_test_failure = p.block_on_test_failure;
        policy.block_on_scanner_error = p.block_on_scanner_error;
        policy.block_on_skipped_check = p.block_on_skipped_check;
        policy.report_on_severity = p.report_on_severity.clone();
        policy.max_exceptions = p.max_exceptions;
        policy.exceptions = p.exceptions.clone();
    }

    let now = now_iso8601();
    let policy = {
        let mut p = policy;
        p.exceptions = p
            .exceptions
            .iter()
            .filter(|e| is_exception_active(e, &now))
            .cloned()
            .collect();
        p
    };

    let active = policy.exceptions.len();
    let notes = finalize_notes(&policy, active);
    let mut policy = policy;
    if active > policy.max_exceptions as usize {
        policy.exceptions.truncate(policy.max_exceptions as usize);
    }

    ResolvedPolicy { policy, notes }
}

fn finalize_notes(policy: &Policy, active_exceptions: usize) -> Vec<String> {
    let mut notes: Vec<String> = Vec::new();
    if policy.block_on_severity.is_empty() && policy.report_on_severity.is_empty() {
        notes.push(
            "No severities are configured to block or report; the gate will pass unless a scanner errors."
                .to_string(),
        );
    }
    if active_exceptions > policy.max_exceptions as usize {
        notes.push(format!(
            "Policy exceeded maxExceptions ({active_exceptions} active of {}); keeping the first {} in document order.",
            policy.max_exceptions, policy.max_exceptions
        ));
    }
    if active_exceptions > 0 {
        notes.push(format!(
            "{active_exceptions} documented exception(s) are active and will be recorded in the gate decision."
        ));
    }
    notes
}

/// The minimum finding shape required for deterministic ordering.
#[derive(Debug, Clone)]
pub struct FindingLike<'a> {
    pub severity: Severity,
    pub confidence: crate::model::Confidence,
    pub rule_id: &'a str,
    pub file: Option<&'a str>,
}

/// Minimal `*`, `?`, and `**` glob used to scope exceptions to paths.
///
/// Byte-compatible with `globMatch` in `packages/core/src/policy.ts`:
/// `*` stays within a path segment, `**` crosses segments, and `?` matches a
/// single character.
pub fn glob_match(pattern: &str, value: &str) -> bool {
    use regex::Regex;
    const SENTINEL: char = '\u{1}';
    // Step 1: escape regex metacharacters, preserving the glob wildcards
    // `*` and `?` (which are not regex metacharacters here).
    let mut escaped = String::with_capacity(pattern.len());
    for c in pattern.chars() {
        match c {
            '.' | '+' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                escaped.push('\\');
                escaped.push(c);
            }
            _ => escaped.push(c),
        }
    }
    // Step 2: translate globs exactly as the TS implementation does.
    let regex = escaped
        .replace("**", SENTINEL.to_string().as_str())
        .replace('*', "[^/]*")
        .replace(SENTINEL, ".*")
        .replace('?', ".");
    let re = match Regex::new(&format!("^{regex}$")) {
        Ok(re) => re,
        Err(_) => return false,
    };
    re.is_match(value)
}

#[cfg(test)]
mod glob_tests {
    use super::glob_match;

    #[test]
    fn matches_simple_and_double_star_globs() {
        assert!(glob_match("src/**/*.ts", "src/a/b/c.ts"));
        assert!(!glob_match("*.js", "a/b.js"));
        assert!(glob_match("tests/fix*.ts", "tests/fixture.ts"));
    }
}

/// Compare two findings using the deterministic ordering used when sorting
/// reports and when exceptions are applied to specific findings.
///
/// Byte-compatible with `compareFindings` in `packages/core/src/policy.ts`:
/// descending severity, then ascending confidence, then ascending ruleId,
/// then ascending location file.
pub fn compare_findings(a: &FindingLike<'_>, b: &FindingLike<'_>) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    // Descending severity (higher order = more severe = first).
    let sev = b.severity.order().cmp(&a.severity.order());
    if sev != Ordering::Equal {
        return sev;
    }
    let conf = a.confidence.order().cmp(&b.confidence.order());
    if conf != Ordering::Equal {
        return conf;
    }
    let rule = a.rule_id.cmp(b.rule_id);
    if rule != Ordering::Equal {
        return rule;
    }
    a.file.unwrap_or("").cmp(b.file.unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Confidence, PolicyException, Severity};

    fn active() -> PolicyException {
        PolicyException {
            rule_id: "r".into(),
            reason: "why".into(),
            expires: None,
            path_glob: None,
        }
    }

    #[test]
    fn applies_documented_defaults() {
        let resolved = resolve_policy(None);
        assert_eq!(
            resolved.policy.block_on_severity,
            default_policy().block_on_severity
        );
        assert!(resolved.policy.block_on_secrets);
        assert!(resolved.policy.block_on_scanner_error);
        assert_eq!(resolved.policy.max_exceptions, 5);
    }

    #[test]
    fn drops_expired_exceptions() {
        let expired = PolicyException {
            rule_id: "old".into(),
            reason: "stale".into(),
            expires: Some("2000-01-01T00:00:00.000Z".into()),
            path_glob: None,
        };
        let live = {
            let mut e = active();
            e.rule_id = "live".into();
            e
        };
        let p = Policy {
            exceptions: vec![expired.clone(), live.clone()],
            ..default_policy()
        };
        let resolved = resolve_policy(Some(&p));
        let rule_ids: Vec<&str> = resolved
            .policy
            .exceptions
            .iter()
            .map(|e| e.rule_id.as_str())
            .collect();
        assert_eq!(rule_ids, vec!["live"]);
    }

    #[test]
    fn drops_undocumented_exceptions() {
        let undocumented = PolicyException {
            rule_id: "x".into(),
            reason: "   ".into(),
            expires: None,
            path_glob: None,
        };
        let p = Policy {
            exceptions: vec![undocumented],
            ..default_policy()
        };
        let resolved = resolve_policy(Some(&p));
        assert!(resolved.policy.exceptions.is_empty());
    }

    #[test]
    fn caps_exceptions_at_max() {
        let many: Vec<PolicyException> = (0..5)
            .map(|i| {
                let mut e = active();
                e.rule_id = format!("r{i}");
                e
            })
            .collect();
        let p = Policy {
            max_exceptions: 2,
            exceptions: many,
            ..default_policy()
        };
        let resolved = resolve_policy(Some(&p));
        assert_eq!(resolved.policy.exceptions.len(), 2);
        assert!(resolved.notes.join(" ").contains("maxExceptions"));
    }

    #[test]
    fn compare_findings_orders_deterministically() {
        let a = FindingLike {
            severity: Severity::High,
            confidence: Confidence::High,
            rule_id: "x",
            file: Some("a.ts"),
        };
        let b = FindingLike {
            severity: Severity::Low,
            confidence: Confidence::High,
            rule_id: "x",
            file: Some("a.ts"),
        };
        assert_eq!(compare_findings(&a, &b), std::cmp::Ordering::Less); // High before Low
    }
}
