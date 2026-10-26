//! Gated end-to-end tests for the external-tool delegation paths:
//! `cargo-audit` (dependency scanning for Rust ecosystems) and `gitleaks`
//! (secret scanning delegation).
//!
//! These exercise the *positive* paths of the engine against the real tools
//! when they are installed, and log an honest skip (never a fake pass) when
//! a tool is unavailable in the environment. The unavailable/missing-tool
//! branches are covered unconditionally by the unit tests in
//! `dependencies.rs` and `exec.rs`.

use std::process::Command;

fn tool_available(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn repo_root() -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().unwrap().parent().unwrap().to_path_buf()
}

fn run_scan(root: &std::path::Path, extra: &str) -> (i32, serde_json::Value) {
    let mut args = serde_json::Map::new();
    args.insert("root".into(), serde_json::json!(root.to_string_lossy()));
    args.insert("runSecrets".into(), serde_json::json!(true));
    if !extra.is_empty() {
        let patch: serde_json::Map<_, _> = serde_json::from_str(extra).expect("extra must be JSON");
        args.extend(patch);
    }
    let request = serde_json::json!({
        "protocolVersion": veylqorix_engine::PROTOCOL_VERSION,
        "command": "scan",
        "args": args,
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_veylqorix-engine"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn engine");
    let mut stdin = child.stdin.take().expect("stdin");
    use std::io::Write;
    // The protocol is one JSON document per line: `serve` blocks on
    // `read_line`, so the request must be newline-terminated (mirroring the
    // TypeScript adapter, which sends `JSON.stringify(request) + '\n'`), and
    // the write end must be released before waiting — a held-open stdin
    // means no EOF and `wait_with_output` would deadlock against the engine.
    stdin
        .write_all(format!("{request}\n").as_bytes())
        .expect("write request");
    drop(stdin);
    let out = child.wait_with_output().expect("wait engine");
    let code = out.status.code().unwrap_or(-1);
    let resp: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&out.stdout).trim_end())
            .unwrap_or(serde_json::Value::Null);
    (code, resp)
}

// ---------------------------------------------------------------------------
// cargo-audit delegation
// ---------------------------------------------------------------------------

#[test]
fn cargo_audit_positive_path_with_vulnerable_lockfile() {
    if !tool_available("cargo", &["audit", "--version"]) {
        eprintln!(
            "SKIP: cargo-audit is not installed in this environment; \
             the unavailable-tool branch is covered by dependencies.rs unit tests."
        );
        return;
    }
    let root = repo_root().join("tests/fixtures/rust-vulnerable");
    let extra = r#"{"runCargoAudit":true,"detection":{"ecosystem":"rust","manifests":["Cargo.toml"],"lockfiles":["Cargo.lock"],"gitRepository":false,"languages":[],"reasons":[]}}"#;
    let (code, resp) = run_scan(&root, extra);
    assert_eq!(
        code, 0,
        "a completed scan exits 0; verdict is in the response"
    );
    let dep = resp["engineScannerResults"]
        .as_array()
        .expect("engine scanner results")
        .iter()
        .find(|s| s["scanner"].as_str() == Some("dependencies/rust"))
        .expect("the cargo-audit scanner result must be present");
    assert_eq!(dep["status"], "FAIL", "vulnerable lockfile must FAIL");
    let findings = dep["findings"].as_array().expect("findings array");
    assert!(
        !findings.is_empty(),
        "cargo-audit found vulnerabilities in the fixture; the engine must report them"
    );
    // Distinct advisories must yield distinct, stable finding ids (no
    // collapsing under dedup).
    let ids: std::collections::HashSet<&str> =
        findings.iter().filter_map(|f| f["id"].as_str()).collect();
    assert_eq!(ids.len(), findings.len(), "finding ids must be distinct");
    // The gate must block on the confirmed HIGH findings.
    assert_eq!(resp["gate"]["result"], "FAIL");
    assert_eq!(resp["exitCode"], 1);
    // Each finding carries the patched-version spec from the advisory.
    for f in findings {
        let fv = f["dependency"]["fixedVersion"].as_str();
        assert!(
            matches!(fv, Some(v) if v.starts_with(">=")),
            "a real patched-version spec is expected, got {fv:?}"
        );
    }
}

#[test]
fn cargo_audit_clean_lockfile_passes() {
    if !tool_available("cargo", &["audit", "--version"]) {
        eprintln!("SKIP: cargo-audit not installed; covered by unit tests.");
        return;
    }
    let root = repo_root().join("tests/fixtures/rust-clean");
    let extra = r#"{"runCargoAudit":true,"detection":{"ecosystem":"rust","manifests":["Cargo.toml"],"lockfiles":["Cargo.lock"],"gitRepository":false,"languages":[],"reasons":[]}}"#;
    let (code, resp) = run_scan(&root, extra);
    assert_eq!(code, 0);
    let dep = resp["engineScannerResults"]
        .as_array()
        .expect("results")
        .iter()
        .find(|s| s["scanner"].as_str() == Some("dependencies/rust"))
        .expect("cargo-audit scanner present");
    assert_eq!(
        dep["status"], "PASS",
        "a clean lockfile audits PASS (not skipped, not errored)"
    );
    assert_eq!(dep["findings"].as_array().unwrap().len(), 0);
}

// ---------------------------------------------------------------------------
// gitleaks delegation
// ---------------------------------------------------------------------------

#[test]
fn gitleaks_positive_path_finds_fixture_secrets() {
    if !tool_available("gitleaks", &["--version"]) {
        eprintln!(
            "SKIP: gitleaks is not installed in this environment; \
             the unavailable branch (SKIPPED note) is covered by the exec \
             MissingTool unit tests."
        );
        return;
    }
    // Build a throwaway fixture in a tempdir — no fake secret is ever
    // committed to the repository.
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(
        dir.path().join("leak.js"),
        "// FAKE TEST SECRET - not a real credential.\n\
         const AWS_KEY = 'AKIA0123456789ABCDEF';\n",
    )
    .expect("write fixture");
    let extra = r#"{"preferGitleaks":true}"#;
    let (code, resp) = run_scan(dir.path(), extra);
    assert_eq!(code, 0);
    let gl = resp["engineScannerResults"]
        .as_array()
        .expect("results")
        .iter()
        .find(|s| s["scanner"].as_str() == Some("secrets/gitleaks"))
        .expect("the gitleaks scanner result must be present");
    assert_eq!(
        gl["status"], "FAIL",
        "gitleaks detected the fake AWS key; the result must be FAIL"
    );
    let findings = gl["findings"].as_array().expect("findings");
    assert!(!findings.is_empty());
    // The raw fake value must be redacted everywhere in the response.
    let raw = resp.to_string();
    assert!(
        !raw.contains("AKIA0123456789ABCDEF"),
        "raw secret leaked: {raw}"
    );
    assert_eq!(resp["gate"]["result"], "FAIL");
    assert_eq!(resp["exitCode"], 1);
}
