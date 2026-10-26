//! End-to-end tests of the engine binary through its stdio protocol.
//!
//! These spawn the actual `veylqorix-engine` binary (built by cargo for the
//! test run) and verify: the ping handshake, a secret scan of the fixture
//! tree over the protocol, the exit-code mapping, and that a malformed
//! request exits non-zero without ever producing a response (so a failure
//! can never be read as a pass).

use std::io::Write;
use std::process::{Command, Stdio};

type ProtocolDoc = serde_json::Value;

fn bin() -> String {
    // Cargo sets this when running integration tests for a package that has
    // the binary target.
    env!("CARGO_BIN_EXE_veylqorix-engine").to_string()
}

fn run_engine(request: &str) -> (i32, String, String) {
    let mut child = Command::new(bin())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn the engine binary");
    {
        let mut stdin = child.stdin.take().expect("no stdin");
        stdin
            .write_all(request.as_bytes())
            .expect("failed to write request");
    }
    let out = child
        .wait_with_output()
        .expect("failed to wait on the engine");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    )
}

#[test]
fn ping_reports_versions_and_does_no_work() {
    let req = object({
        let mut m = serde_json::Map::new();
        m.insert(
            "protocolVersion".into(),
            serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
        );
        m.insert("command".into(), serde_json::json!("ping"));
        m.insert("args".into(), serde_json::json!({}));
        m
    });
    let (code, stdout, _) = run_engine(&serde_json::to_string(&req).unwrap());
    assert_eq!(code, 0, "ping must exit 0");
    let resp: ProtocolDoc = serde_json::from_str(&stdout).expect("ping returns a JSON response");
    assert_eq!(resp["ok"], serde_json::json!(true));
    assert_eq!(
        resp["protocolVersion"],
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION)
    );
    assert!(resp.get("gate").is_none(), "ping must not evaluate a gate");
}

#[test]
fn secret_scan_of_fixture_fails_gate_and_redacts() {
    let root = repo_root().join("tests/fixtures/secret-repo");
    let mut m = serde_json::Map::new();
    m.insert(
        "protocolVersion".into(),
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
    );
    m.insert("command".into(), serde_json::json!("scan"));
    let mut args = serde_json::Map::new();
    args.insert("root".into(), serde_json::json!(root.to_string_lossy()));
    args.insert("runSecrets".into(), serde_json::json!(true));
    m.insert("args".into(), serde_json::json!(args));

    let (code, stdout, stderr) =
        run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(
        code, 0,
        "a completed scan exits 0 regardless of gate verdict; stderr: {stderr}"
    );
    let resp: ProtocolDoc = serde_json::from_str(&stdout).expect("scan returns a JSON response");
    assert_eq!(resp["gate"]["result"], serde_json::json!("FAIL"));
    assert_eq!(resp["exitCode"], serde_json::json!(1));

    // Exactly the two fixture secrets, redacted.
    let findings = resp["findings"].as_array().expect("findings array");
    let ids: Vec<&str> = findings.iter().filter_map(|f| f["id"].as_str()).collect();
    assert!(
        ids.contains(&"SECRETS-8C5562BA"),
        "expected the AWS key finding, got {ids:?}"
    );
    assert!(
        ids.contains(&"SECRETS-5833D5DA"),
        "expected the ghp_ token finding, got {ids:?}"
    );
    let serialized = stdout.clone();
    assert!(
        !serialized.contains("AKIA0123456789ABCDEF"),
        "raw AWS key leaked: {serialized}"
    );
    assert!(
        !serialized.contains("ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789"),
        "raw ghp_ token leaked"
    );
    assert!(
        serialized.contains("AKIA…CDEF (20 chars, redacted)"),
        "the redacted snippet must be present"
    );
}

#[test]
fn clean_scan_passes_with_exit_0() {
    let root = repo_root().join("tests/fixtures/clean-repo");
    let mut m = serde_json::Map::new();
    m.insert(
        "protocolVersion".into(),
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
    );
    m.insert("command".into(), serde_json::json!("scan"));
    let mut args = serde_json::Map::new();
    args.insert("root".into(), serde_json::json!(root.to_string_lossy()));
    args.insert("runSecrets".into(), serde_json::json!(true));
    m.insert("args".into(), serde_json::json!(args));

    let (code, stdout, stderr) =
        run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(code, 0, "stderr: {stderr}");
    let resp: ProtocolDoc = serde_json::from_str(&stdout).expect("scan returns a JSON response");
    assert_eq!(resp["gate"]["result"], serde_json::json!("PASS"));
    assert_eq!(resp["exitCode"], serde_json::json!(0));
    assert_eq!(resp["findings"].as_array().unwrap().len(), 0);
}

#[test]
fn evaluate_command_never_touches_the_filesystem() {
    // Pure gate evaluation: a supplied scanner ERROR with blockOnScannerError
    // must yield FAIL + exit 1, with no root required.
    let mut m = serde_json::Map::new();
    m.insert(
        "protocolVersion".into(),
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
    );
    m.insert("command".into(), serde_json::json!("evaluate"));
    let mut args = serde_json::Map::new();
    args.insert(
        "scannerResults".into(),
        serde_json::json!([
            {
                "scanner": "dependencies",
                "status": "ERROR",
                "findings": [],
                "durationMs": 0,
                "error": { "message": "npm audit blew up" },
                "notes": []
            }
        ]),
    );
    m.insert("args".into(), serde_json::json!(args));

    let (code, stdout, _) = run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(code, 0);
    let resp: ProtocolDoc = serde_json::from_str(&stdout).unwrap();
    assert_eq!(resp["gate"]["result"], serde_json::json!("FAIL"));
    assert_eq!(resp["exitCode"], serde_json::json!(1));
}

#[test]
fn malformed_request_exits_64_with_no_response() {
    let (code, stdout, stderr) = run_engine("this is not JSON");
    assert_eq!(code, 64, "malformed request must exit 64; stderr: {stderr}");
    assert!(
        stdout.trim().is_empty(),
        "no response document may be written"
    );
    assert!(stderr.contains("veylqorix-engine"));
}

#[test]
fn unsupported_protocol_version_exits_64() {
    let mut m = serde_json::Map::new();
    m.insert("protocolVersion".into(), serde_json::json!(99));
    m.insert("command".into(), serde_json::json!("ping"));
    m.insert("args".into(), serde_json::json!({}));
    let (code, stdout, stderr) =
        run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(code, 64, "stderr: {stderr}");
    assert!(stdout.trim().is_empty());
}

#[test]
fn missing_root_exits_65() {
    let mut m = serde_json::Map::new();
    m.insert(
        "protocolVersion".into(),
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
    );
    m.insert("command".into(), serde_json::json!("scan"));
    let mut args = serde_json::Map::new();
    args.insert(
        "root".into(),
        serde_json::json!(repo_root().join("does-not-exist-xyz")),
    );
    m.insert("args".into(), serde_json::json!(args));
    let (code, stdout, stderr) =
        run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(code, 65, "stderr: {stderr}");
    assert!(stdout.trim().is_empty(), "no response on a missing root");
}

#[test]
fn staged_scope_restricts_the_scan() {
    // Scan the secret fixture but *exclude* the file via staged files: the
    // engine must scan nothing and report a clean PASS, proving scoping works
    // end-to-end.
    let root = repo_root().join("tests/fixtures/secret-repo");
    let mut m = serde_json::Map::new();
    m.insert(
        "protocolVersion".into(),
        serde_json::json!(veylqorix_engine::PROTOCOL_VERSION),
    );
    m.insert("command".into(), serde_json::json!("scan"));
    let mut args = serde_json::Map::new();
    args.insert("root".into(), serde_json::json!(root.to_string_lossy()));
    args.insert("runSecrets".into(), serde_json::json!(true));
    args.insert("stagedFiles".into(), serde_json::json!(["nonexistent.txt"]));
    m.insert("args".into(), serde_json::json!(args));
    let (code, stdout, stderr) =
        run_engine(&serde_json::to_string(&ProtocolDoc::Object(m)).unwrap());
    assert_eq!(code, 0, "stderr: {stderr}");
    let resp: ProtocolDoc = serde_json::from_str(&stdout).unwrap();
    assert_eq!(resp["gate"]["result"], serde_json::json!("PASS"));
    assert_eq!(resp["findings"].as_array().unwrap().len(), 0);
}

/// Locate the repository root from the crate manifest, so the integration
/// tests run no matter where `cargo test` is invoked from.
///
/// `CARGO_MANIFEST_DIR` is `<repo>/crates/veylqorix-engine`, so two `parent()`
/// calls reach the repo root.
fn repo_root() -> std::path::PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent() // crates/veylqorix-engine -> crates/
        .unwrap()
        .parent() // crates/ -> <repo root>
        .unwrap()
        .to_path_buf()
}

use std::path::Path;

fn object(m: serde_json::Map<String, serde_json::Value>) -> ProtocolDoc {
    ProtocolDoc::Object(m)
}
