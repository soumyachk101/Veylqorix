//! Fixture-driven engine parity tests.
//!
//! Reuse the shared `tests/fixtures/*/fixture.json` files as the single source
//! of truth for differential parity. Each engine-side assertion here mirrors
//! what `tests/engine-differential.test.ts` pins on the TypeScript side, so a
//! drift between the two implementations fails on both.
//!
//! - `diff` fixtures feed their `evaluate`-command input through
//!   [`parse_request`] + [`execute`] and assert the same verdict / exitCode /
//!   strictExitCode / coverage / finding records the TS gate must produce.
//! - `protocol` fixtures assert the closest unit-level structured-error
//!   behavior (64/65) the binary emits on stdout; the binary-level frame is
//!   pinned separately in `protocol-e2e.rs`.
//! - `redaction` fixtures assert byte-identical `redact_secret` golden vectors.

use std::path::Path;

use veylqorix_engine::model::{CoverageLevel, GateResult, Severity};
use veylqorix_engine::protocol::{execute, parse_request, ErrorKind, Request};

fn repo_root() -> std::path::PathBuf {
    // `CARGO_MANIFEST_DIR` is `<repo>/crates/veylqorix-engine`; two `parent()`
    // calls reach the repo root (same pattern as `protocol-e2e.rs`).
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .expect("crates dir")
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn load_fixture(name: &str) -> serde_json::Value {
    let file = repo_root()
        .join("tests/fixtures")
        .join(name)
        .join("fixture.json");
    let doc = std::fs::read_to_string(&file)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", file.display()));
    serde_json::from_str(&doc).expect("fixture is valid JSON")
}

/// Build an `evaluate` request document from a `diff` fixture's input.
///
/// `input` carries `findings` / `checks` / `scannerResults`; the engine wire
/// already names the last `scannerResults`, so the mapping is the identity for
/// those documented keys plus an optional `policy` override and `strict`.
fn evaluate_request(fixture: &serde_json::Value) -> serde_json::Value {
    let mut args = fixture["input"].clone();
    if let Some(policy) = fixture.get("policy") {
        args["policy"] = policy.clone();
    }
    let strict = fixture
        .get("strict")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    args["strict"] = serde_json::json!(strict);
    serde_json::json!({
        "protocolVersion": veylqorix_engine::PROTOCOL_VERSION,
        "command": "evaluate",
        "args": args
    })
}

/// The engine-side check a `diff` fixture pins: verdict, exit codes, coverage,
/// and the finding records it lists.
fn assert_diff_expectations(fixture: &serde_json::Value) {
    let raw = evaluate_request(fixture);
    let req: Request = parse_request(&raw.to_string()).unwrap_or_else(|(kind, msg)| {
        panic!(
            "fixture '{}' request must parse: {msg} ({kind:?})",
            fixture["name"]
        )
    });
    let resp = execute(&req).unwrap_or_else(|(kind, msg)| {
        panic!(
            "fixture '{}' evaluate must succeed: {msg} ({kind:?})",
            fixture["name"]
        )
    });

    let expect = &fixture["expect"];
    let gate = resp
        .gate
        .as_ref()
        .expect("a completed evaluate carries a gate decision");

    if let Some(v) = expect.get("verdict") {
        let verdict = match gate.result {
            GateResult::Pass => "PASS",
            GateResult::Fail => "FAIL",
            GateResult::Incomplete => "INCOMPLETE",
        };
        assert_eq!(
            verdict,
            v.as_str().expect("fixture verdict must be a string"),
            "verdict must match the fixture expectation"
        );
        if expect
            .get("neverPass")
            .and_then(|x| x.as_bool())
            .unwrap_or(false)
        {
            assert_ne!(
                verdict, "PASS",
                "a never-pass fixture must never read as a clean pass"
            );
        }
    }

    if let Some(code) = expect.get("exitCode") {
        assert_eq!(
            resp.exit_code
                .expect("a completed evaluate carries an exit code"),
            code.as_i64().expect("exitCode is a number") as i32,
            "soft exit code must match"
        );
    }
    if let Some(strict) = expect.get("strictExitCode") {
        assert_eq!(
            resp.strict_exit_code,
            Some(strict.as_i64().expect("strictExitCode is a number") as i32),
            "strict exit code must match (present because the fixture sets strict: true)"
        );
    }

    if let Some(cov) = expect.get("coverage") {
        let coverage = match gate.coverage {
            CoverageLevel::Full => "FULL",
            CoverageLevel::Partial => "PARTIAL",
            CoverageLevel::Limited => "LIMITED",
            CoverageLevel::None => "NONE",
        };
        assert_eq!(
            coverage,
            cov.as_str().expect("fixture coverage must be a string"),
            "coverage must match the fixture expectation"
        );
    }

    let all_findings = resp.findings.clone().unwrap_or_default();
    if let Some(ids) = expect.get("findingIds").and_then(|v| v.as_array()) {
        for id in ids {
            let id_str = id.as_str().unwrap();
            assert!(
                all_findings.iter().any(|f| f.id == id_str),
                "expected finding id {id_str} to be present, got: {}",
                all_findings
                    .iter()
                    .map(|f| f.id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
    if let Some(sev) = expect.get("severityOf").and_then(|v| v.as_object()) {
        for (id, expected_sev) in sev {
            let f = all_findings
                .iter()
                .find(|f| f.id == *id)
                .unwrap_or_else(|| panic!("finding {id} not present for severityOf check"));
            let got = match f.severity {
                Severity::Critical => "CRITICAL",
                Severity::High => "HIGH",
                Severity::Medium => "MEDIUM",
                Severity::Low => "LOW",
                Severity::Info => "INFO",
            };
            assert_eq!(
                got,
                expected_sev
                    .as_str()
                    .expect("severityOf value must be a string"),
                "severity of {id} must match the fixture"
            );
        }
    }

    if let Some(phrases) = expect
        .get("blockingReasonContains")
        .and_then(|v| v.as_array())
    {
        for phrase in phrases {
            let p = phrase.as_str().unwrap();
            assert!(
                gate.blocking_reasons.iter().any(|r| r.contains(p)),
                "expected a blocking reason containing '{p}'; got: {:?}",
                gate.blocking_reasons
            );
        }
    }
    if let Some(phrases) = expect.get("incompleteContains").and_then(|v| v.as_array()) {
        for phrase in phrases {
            let p = phrase.as_str().unwrap();
            assert!(
                gate.incomplete_reasons.iter().any(|r| r.contains(p)),
                "expected an incomplete reason containing '{p}'; got: {:?}",
                gate.incomplete_reasons
            );
        }
    }

    if let Some(ids) = expect.get("reportContains").and_then(|v| v.as_array()) {
        let document = serde_json::to_string(&resp).expect("response serializes");
        for id in ids {
            let id_str = id.as_str().unwrap();
            assert!(
                document.contains(id_str),
                "expected {id_str} to appear in the engine report document"
            );
        }
    }
}

#[test]
fn diff_fixtures_match_the_ts_gate_expectations() {
    let diff_fixtures = [
        "secrets-present",
        "secrets-absent",
        "dependency-results",
        "empty-findings",
        "policy-with-expired-exception",
        "verdict-pass",
        "verdict-fail",
        "verdict-incomplete",
        "scanner-missing-binary",
        "scanner-timeout",
        "scanner-unexpected-exit",
    ];
    for name in diff_fixtures {
        let fixture = load_fixture(name);
        assert_eq!(
            fixture["kind"].as_str(),
            Some("diff"),
            "fixture {name} must be a diff fixture"
        );
        assert_diff_expectations(&fixture);
    }
}

#[test]
fn malformed_findings_are_rejected_as_malformed_not_a_decision() {
    // The strict serde enum / required-field model rejects the whole request
    // document: `severity: "EXTREME"` is not a valid enum, a missing `ruleId`
    // is a required-field error, and a negative line / wrong-typed location is
    // a type error. No gate decision is produced. The binary-level exit-64
    // frame is pinned in `protocol-e2e.rs`.
    let fixture = load_fixture("malformed-findings");
    let raw = evaluate_request(&fixture);
    let result = parse_request(&raw.to_string());
    assert!(
        result.is_err(),
        "the malformed-findings request must not parse (strict enum + required ruleId)"
    );
    if let Err((kind, msg)) = result {
        assert_eq!(
            kind,
            ErrorKind::Malformed,
            "a malformed document is Malformed: {msg}"
        );
        assert_eq!(
            kind.exit_code(),
            fixture["expect"]["rustExitCode"]
                .as_i64()
                .expect("expected 64") as i32,
            "the exit-code mapping of a malformed document is 64"
        );
    }
}

#[test]
fn invalid_protocol_version_is_rejected_as_malformed() {
    // Closest unit-level behavior: `parse_request` rejects a protocolVersion it
    // does not speak. The binary-level exit-64 error frame (ok:false,
    // malformed-request, no gate) is pinned in `protocol-e2e.rs`.
    let fixture = load_fixture("invalid-protocol-version");
    assert_eq!(
        fixture["requestProtocolVersion"].as_u64(),
        Some(99),
        "the fixture drives the version check with 99"
    );
    let raw = format!(
        r#"{{"protocolVersion":{},"command":"ping","args":{{}}}}"#,
        fixture["requestProtocolVersion"]
    );
    let result = parse_request(&raw);
    assert!(result.is_err(), "a wrong protocol version must not parse");
    if let Err((kind, msg)) = result {
        assert_eq!(
            kind,
            ErrorKind::Malformed,
            "an unsupported version is Malformed: {msg}"
        );
        assert_eq!(
            kind.exit_code(),
            fixture["expectedRustExitCode"]
                .as_i64()
                .expect("expected 64") as i32,
            "the exit-code mapping of an unsupported version is 64"
        );
        // The frame fields the fixture's expect pins.
        let expect = &fixture["expect"]["errorFrame"];
        assert_eq!(
            kind.as_str(),
            expect["code"].as_str().expect("errorFrame.code"),
            "error-frame code"
        );
        assert!(
            !expect["ok"].as_bool().expect("errorFrame.ok"),
            "the frame must be ok:false"
        );
    }
}

#[test]
fn root_confinement_scan_of_a_missing_root_yields_root_not_found() {
    let fixture = load_fixture("root-confinement");
    assert_eq!(
        fixture["scanRoot"].as_str(),
        Some("tests/fixtures/does-not-exist"),
        "the fixture points at a missing audit root"
    );
    let root = repo_root()
        .join(fixture["scanRoot"].as_str().expect("scanRoot"))
        .to_string_lossy()
        .to_string();
    let raw = serde_json::json!({
        "protocolVersion": veylqorix_engine::PROTOCOL_VERSION,
        "command": "scan",
        "args": { "root": root, "runSecrets": true }
    });
    let req: Request = parse_request(&raw.to_string()).expect("a well-formed scan request parses");
    let result = execute(&req);
    assert!(result.is_err(), "a missing root must not evaluate a gate");
    if let Err((kind, msg)) = result {
        assert_eq!(
            kind,
            ErrorKind::RootNotFound,
            "a missing root is RootNotFound: {msg}"
        );
        assert_eq!(
            kind.exit_code(),
            fixture["expectedRustExitCode"]
                .as_i64()
                .expect("expected 65") as i32,
            "the exit-code mapping of a missing root is 65"
        );
        // The structured frame the fixture pins: ok:false, root-not-found, no gate.
        let expect = &fixture["expect"]["errorFrame"];
        assert_eq!(
            kind.as_str(),
            expect["code"].as_str().expect("errorFrame.code"),
            "error-frame code"
        );
        assert!(
            !expect["ok"].as_bool().expect("errorFrame.ok"),
            "the frame must be ok:false"
        );
    }
}

#[test]
fn redaction_values_match_the_shared_golden_vectors() {
    // Byte-compatibility with `redactSecret` in `packages/core`. The vectors
    // come from the `redaction-values` fixture so a redaction drift fails on
    // both sides at once.
    let fixture = load_fixture("redaction-values");
    use veylqorix_engine::redact::redact_secret;
    for case in fixture["cases"].as_array().expect("the fixture has cases") {
        let input = case["input"].as_str().expect("case.input");
        let expected = case["expected"].as_str().expect("case.expected");
        let got = redact_secret(input);
        assert_eq!(
            got.as_str(),
            expected,
            "redaction drift for input {input:?} — a security-visibility regression"
        );
        if fixture["expect"]["neverContainsRaw"]
            .as_bool()
            .unwrap_or(false)
            && input.len() > 8
        {
            assert!(
                !got.contains(input),
                "the raw value must not survive the mask for {input:?}"
            );
        }
    }
}
