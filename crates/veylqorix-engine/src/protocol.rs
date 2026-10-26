//! The JSON-over-stdio protocol between the engine binary and the TypeScript
//! adapter.
//!
//! Wire format: one JSON document per message, on a single logical line. The
//! adapter writes a request to the child's stdin and reads exactly one JSON
//! response from stdout. Both directions are size-capped so a malformed or
//! oversized payload is rejected, not processed.
//!
//! Error model: the binary exits 0 with a response on success, and exits
//! non-zero (without a response) on protocol errors:
//! - 64 malformed request (bad JSON, unknown command, unsupported protocol)
//! - 65 root not found / not a directory
//! - 70 engine internal error
//!
//! The stderr line, when present, is a short human-readable reason. This is
//! how the engine distinguishes *scanner failure* from *a successful scan
//! with findings* from *a successful scan with no findings*: the gate result
//! and exit code in the response carry the decision, and protocol errors are
//! out-of-band, structurally unable to be read as a pass.

use std::io::{BufRead, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::dependencies::cargo_audit;
use crate::exec::{exec, which};
use crate::finding::{make_finding, MakeFinding};
use crate::gate::{evaluate_gate, exit_code_for, strict_exit_code, GateInput};
use crate::model::{
    CheckResult, Confidence, Evidence, Finding, GateDecision, Policy, ProjectDetection,
    ScannerResult, ScannerStatus, Severity,
};
use crate::policy::resolve_policy;
use crate::secrets::{collect_files, secret_scanner_result, SecretScanOptions};

/// The maximum bytes accepted for a single request document.
pub const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// The maximum bytes emitted for a single response document.
pub const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

/// A request to the engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    /// Must equal [`crate::PROTOCOL_VERSION`] or the request is rejected.
    pub protocol_version: u32,
    /// The engine command.
    pub command: Command,
    /// Command-specific arguments.
    pub args: ScanArgs,
}

/// Engine commands.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Command {
    /// Handshake: returns engine + protocol versions without doing work.
    Ping,
    /// Run the engine-performed scanners (secret scan, cargo audit, gitleaks)
    /// and evaluate the gate over their results plus the supplied evidence.
    Scan,
    /// Evaluate the gate only, over supplied scanner evidence. No filesystem
    /// access. Used when the orchestrator already ran its own scanners.
    Evaluate,
}

/// Arguments shared by the engine commands.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanArgs {
    /// Root directory of the project being audited.
    #[serde(default)]
    pub root: Option<String>,
    /// Orchestrator-side project detection, so the engine picks the right
    /// scanners without re-walking the tree.
    #[serde(default)]
    pub detection: Option<ProjectDetection>,
    /// Partial policy overrides on top of the engine defaults.
    #[serde(default)]
    pub policy: Option<Policy>,
    /// Restrict the secret scanner to exactly these root-relative files
    /// (e.g. Git-staged changes).
    #[serde(default)]
    pub staged_files: Option<Vec<String>>,
    /// When true, evaluate with the strict exit-code mapping in the response.
    #[serde(default)]
    pub strict: bool,
    /// Findings produced by orchestrator scanners (e.g. `npm audit`,
    /// `pip-audit`, license checks). The engine merges them into the gate.
    #[serde(default)]
    pub findings: Vec<Finding>,
    /// Completed scanner results produced by orchestrator scanners. The
    /// engine merges their status and findings into the gate input.
    #[serde(default)]
    pub scanner_results: Vec<ScannerResult>,
    /// Completed quality-check results produced by the orchestrator.
    #[serde(default)]
    pub checks: Vec<CheckResult>,
    /// Run the engine's built-in secret scanner.
    #[serde(default)]
    pub run_secrets: bool,
    /// Prefer delegating the secret scan to `gitleaks` when installed; the
    /// built-in offline rule-set always remains available as the fallback.
    #[serde(default)]
    pub prefer_gitleaks: bool,
    /// Run `cargo audit` for Rust projects.
    #[serde(default)]
    pub run_cargo_audit: bool,
    /// Per-tool timeout in milliseconds.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// Stable scan identifier recorded on engine findings.
    #[serde(default)]
    pub scan_id: Option<String>,
}

/// A successful engine response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol_version: u32,
    pub engine_version: String,
    pub schema_version: u32,
    pub ok: bool,
    /// The gate decision (present for `scan` / `evaluate`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<GateDecision>,
    /// Default exit-code mapping (0 PASS / 1 FAIL / 2 INCOMPLETE).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    /// Strict exit-code mapping, when the caller asked for it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strict_exit_code: Option<i32>,
    /// All normalized findings in scope for the gate (orchestrator + engine),
    /// sorted deterministically.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub findings: Option<Vec<Finding>>,
    /// Scanner results contributed by the engine for this run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_scanner_results: Option<Vec<ScannerResult>>,
    pub notes: Vec<String>,
}

/// Exit codes used by the binary for out-of-band protocol errors.
pub mod exit {
    /// Malformed request or unsupported protocol version.
    pub const MALFORMED: i32 = 64;
    /// The audit root does not exist or is not a directory.
    pub const ROOT_NOT_FOUND: i32 = 65;
    /// Engine internal error.
    pub const INTERNAL: i32 = 70;
}

/// Validate a raw request document: JSON must parse, the protocol version
/// must match, and known fields must be sane.
pub fn parse_request(raw: &str) -> Result<Request, String> {
    let req: Request =
        serde_json::from_str(raw).map_err(|e| format!("request is not valid engine JSON: {e}"))?;
    if req.protocol_version != crate::PROTOCOL_VERSION {
        return Err(format!(
            "unsupported protocol version {} (this engine speaks {})",
            req.protocol_version,
            crate::PROTOCOL_VERSION
        ));
    }
    Ok(req)
}

/// Execute a validated request and produce a response document.
///
/// Errors here are out-of-band: the caller prints them to stderr and exits
/// non-zero. A scanner *failure* inside a scan is never an error out of this
/// function — it is a SKIPPED/ERROR scanner result in the response, so the
/// gate can degrade coverage instead of pretending.
pub fn execute(req: &Request) -> Result<Response, (i32, String)> {
    match req.command {
        Command::Ping => Ok(Response {
            protocol_version: crate::PROTOCOL_VERSION,
            engine_version: crate::ENGINE_VERSION.to_string(),
            schema_version: crate::model::SCHEMA_VERSION,
            ok: true,
            gate: None,
            exit_code: None,
            strict_exit_code: None,
            findings: None,
            engine_scanner_results: None,
            notes: vec!["engine ready".to_string()],
        }),
        Command::Evaluate => evaluate_only(req),
        Command::Scan => scan(req),
    }
}

/// Gate-only evaluation over supplied evidence (no filesystem access).
fn evaluate_only(req: &Request) -> Result<Response, (i32, String)> {
    let resolved = resolve_policy(req.args.policy.as_ref());
    let merged_findings = merge_findings(req.args.findings.clone());
    let gate = evaluate_gate(GateInput {
        findings: &merged_findings,
        checks: &req.args.checks,
        scanners: &req.args.scanner_results,
        policy: &resolved,
    });
    let exit_code = exit_code_for(&gate, gate.coverage);
    let strict = if req.args.strict {
        Some(strict_exit_code(&gate, gate.coverage))
    } else {
        None
    };
    let sorted = sort_all(&merged_findings);
    Ok(Response {
        protocol_version: crate::PROTOCOL_VERSION,
        engine_version: crate::ENGINE_VERSION.to_string(),
        schema_version: crate::model::SCHEMA_VERSION,
        ok: true,
        gate: Some(gate),
        exit_code: Some(exit_code),
        strict_exit_code: strict,
        findings: Some(sorted),
        engine_scanner_results: None,
        notes: resolved.notes.clone(),
    })
}

/// Run the engine's built-in scanners and evaluate the gate over their
/// results plus the supplied orchestrator evidence.
fn scan(req: &Request) -> Result<Response, (i32, String)> {
    let args = &req.args;
    let root = args.root.as_ref().ok_or_else(|| {
        (
            exit::MALFORMED,
            "`root` is required for the scan command".to_string(),
        )
    })?;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err((
            exit::ROOT_NOT_FOUND,
            format!("audit root '{root}' does not exist or is not a directory"),
        ));
    }
    let timeout_ms = args.timeout_ms.unwrap_or(120_000);
    let mut engine_results: Vec<ScannerResult> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    if args.run_secrets {
        let options = SecretScanOptions {
            prefer_gitleaks: args.prefer_gitleaks,
            ..Default::default()
        };
        let mut staged: Option<Vec<String>> = None;
        if let Some(files) = &args.staged_files {
            if !files.is_empty() {
                staged = Some(files.clone());
            }
        }
        // Optional gitleaks delegation: the offline rule-set is authoritative
        // for reproducibility; gitleaks, when requested and available, adds
        // its own findings on top. An unavailable gitleaks is recorded, not
        // silenced.
        if args.prefer_gitleaks && which("gitleaks") {
            let res = gitleaks_scan(root_path, timeout_ms);
            notes.push(gitleaks_note(&res));
            if res.status == ScannerStatus::Pass || res.status == ScannerStatus::Fail {
                engine_results.push(res);
            }
        }
        let files = collect_files(root_path, &options, &staged).map_err(|e| {
            (
                exit::INTERNAL,
                format!("secret scan could not read the audit root: {e}"),
            )
        })?;
        let source = if args.prefer_gitleaks && which("gitleaks") {
            "offline-rules+gitleaks"
        } else {
            "offline-rules"
        };
        engine_results.push(secret_scanner_result(&files, source));
    }

    // The orchestrator (TypeScript adapter) enables cargo audit when it
    // detects a Rust project; the engine executes it when asked. The
    // no-lockfile and missing-binary cases inside `cargo_audit` still
    // surface as SKIPPED, never PASS.
    if args.run_cargo_audit {
        let result = cargo_audit(root_path, timeout_ms);
        notes.push(cargo_note(&result));
        engine_results.push(result);
    }

    // Merge orchestrator + engine scanner evidence into the gate input. The
    // engine's own scanner findings must be evaluated by the gate just like
    // the orchestrator's — otherwise a secret the engine found would not
    // block, which would be a silent gap.
    let mut all_scanners = args.scanner_results.clone();
    all_scanners.extend(engine_results.clone());
    let mut merged_findings = merge_findings(args.findings.clone());
    for scanner in &engine_results {
        merged_findings.extend(scanner.findings.clone());
    }
    merged_findings = merge_findings(merged_findings); // de-dup by stable id

    let resolved = resolve_policy(args.policy.as_ref());
    notes.extend(resolved.notes.clone());
    let gate = evaluate_gate(GateInput {
        findings: &merged_findings,
        checks: &args.checks,
        scanners: &all_scanners,
        policy: &resolved,
    });
    let exit_code = exit_code_for(&gate, gate.coverage);
    let strict = if args.strict {
        Some(strict_exit_code(&gate, gate.coverage))
    } else {
        None
    };

    // Stamp engine-produced findings with the scan id + timestamp so reports
    // can correlate them; orchestrator findings already carry their own.
    let mut sorted = sort_all(&merged_findings);
    if let Some(scan_id) = &args.scan_id {
        let now = iso_now();
        for f in &mut sorted {
            if f.scan_id.is_none() {
                f.scan_id = Some(scan_id.clone());
                f.found_at = Some(now.clone());
            }
        }
    }

    Ok(Response {
        protocol_version: crate::PROTOCOL_VERSION,
        engine_version: crate::ENGINE_VERSION.to_string(),
        schema_version: crate::model::SCHEMA_VERSION,
        ok: true,
        gate: Some(gate),
        exit_code: Some(exit_code),
        strict_exit_code: strict,
        findings: Some(sorted),
        engine_scanner_results: Some(engine_results),
        notes,
    })
}

/// Gitleaks delegation: run `gitleaks detect` on the repository and normalize
/// its JSON findings into the shared schema, re-redacting every secret value.
fn gitleaks_scan(root: &Path, timeout_ms: u64) -> ScannerResult {
    let started = std::time::Instant::now();
    // `gitleaks detect` against a plain directory (no git history) with a JSON
    // report to stdout. Exit code: 0 = clean, 1 = leaks found (default
    // `--exit-code`), 2 = the tool errored. These flag names match the
    // current gitleaks CLI (v8+); verified against gitleaks 8.30.1.
    let args = vec![
        "detect".into(),
        "--no-git".into(),
        "--no-banner".into(),
        "--no-color".into(),
        "-s".into(),
        root.to_string_lossy().into(),
        "-f".into(),
        "json".into(),
        "-r".into(),
        "-".into(),
    ];
    let opts = crate::exec::ExecOptions {
        cwd: Some(root.to_path_buf()),
        timeout_ms,
        ..crate::exec::ExecOptions::default()
    };
    let result = match exec("gitleaks", &args, &opts) {
        Ok(r) if r.timed_out => {
            return ScannerResult {
                scanner: "secrets/gitleaks".into(),
                status: ScannerStatus::Error,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message: format!("gitleaks timed out after {timeout_ms}ms"),
                    code: Some("ETIMEDOUT".into()),
                    missing_dependency: None,
                }),
                notes: vec![
                    "gitleaks did not complete; secret coverage is degraded, not a pass.".into(),
                ],
                summary: None,
            };
        }
        Ok(r) => r,
        Err(e) => {
            return ScannerResult {
                scanner: "secrets/gitleaks".into(),
                status: ScannerStatus::Skipped,
                findings: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(crate::model::ScannerError {
                    message: e.to_string(),
                    code: Some("ENOENT".into()),
                    missing_dependency: Some(true),
                }),
                notes: vec![
                    "gitleaks is unavailable; falling back to the built-in offline rule-set."
                        .into(),
                ],
                summary: None,
            };
        }
    };
    // gitleaks exits 0 with zero leaks, 1 with leaks, 2 on error.
    let parsed = if result.stdout.trim().is_empty() {
        serde_json::Value::Array(Vec::new())
    } else {
        serde_json::from_str::<serde_json::Value>(&result.stdout)
            .unwrap_or(serde_json::Value::Array(Vec::new()))
    };
    let leaks = parsed.as_array().cloned().unwrap_or_default();
    let mut findings: Vec<Finding> = Vec::new();
    for leak in &leaks {
        let root_str = root.to_string_lossy();
        let rule = leak
            .get("RuleID")
            .and_then(|v| v.as_str())
            .unwrap_or("gitleaks");
        let file = leak
            .get("File")
            .and_then(|v| v.as_str())
            .unwrap_or(&root_str);
        let line = leak.get("StartLine").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let secret = leak.get("Secret").and_then(|v| v.as_str()).unwrap_or("");
        let desc = leak
            .get("Description")
            .and_then(|v| v.as_str())
            .unwrap_or("Secret detected");
        // gitleaks reports paths relative to the repo it was invoked on; make
        // them root-relative so findings match the orchestrator's convention.
        let rel_file = file
            .strip_prefix(root_str.as_ref())
            .map(|p| p.trim_start_matches('/').to_string())
            .unwrap_or_else(|| file.to_string());
        findings.push(make_finding(MakeFinding {
            scanner: "secrets/gitleaks",
            rule_id: rule,
            title: &format!("{desc} detected in {rel_file}"),
            severity: Severity::High,
            confidence: Confidence::High,
            file: Some(&rel_file),
            line: if line == 0 { None } else { Some(line) },
            column: None,
            dependency: None,
            evidence: Some(&Evidence {
                snippet: Some(crate::redact::redact_secret(secret)),
                details: Some(std::collections::BTreeMap::from([
                    ("rule".to_string(), serde_json::Value::String(rule.to_string())),
                    ("description".to_string(), serde_json::Value::String(desc.to_string())),
                ])),
            }),
            remediation: Some("Rotate this credential and remove it from the repository; load it from a secret manager at runtime."),
            advisory: None,
            secret: Some(true),
            secret_override: None,
        }));
    }
    let status = if result.code == Some(2) {
        ScannerStatus::Error
    } else if !findings.is_empty() {
        ScannerStatus::Fail
    } else {
        ScannerStatus::Pass
    };
    let leak_count = findings.len();
    let mut scanner = ScannerResult {
        scanner: "secrets/gitleaks".into(),
        status,
        findings,
        duration_ms: started.elapsed().as_millis() as u64,
        error: if status == ScannerStatus::Error {
            Some(crate::model::ScannerError {
                message: result.stderr.trim().to_string(),
                code: result.code.map(|c| c.to_string()),
                missing_dependency: None,
            })
        } else {
            None
        },
        notes: vec![format!(
            "gitleaks reported {leak_count} leak(s) across the scanned tree."
        )],
        summary: Some(std::collections::BTreeMap::from([
            ("leaks".to_string(), serde_json::Value::from(leak_count)),
            (
                "source".to_string(),
                serde_json::Value::String("gitleaks".into()),
            ),
        ])),
    };
    if status == ScannerStatus::Pass {
        scanner.notes = vec!["gitleaks completed; no secret patterns matched.".into()];
    }
    scanner
}

fn gitleaks_note(res: &ScannerResult) -> String {
    match res.status {
        ScannerStatus::Skipped => {
            "gitleaks requested but unavailable; offline rule-set used as the fallback.".into()
        }
        ScannerStatus::Error => "gitleaks did not complete; secret coverage is degraded.".into(),
        _ => "gitleaks findings were merged into the secret scan.".into(),
    }
}

fn cargo_note(res: &ScannerResult) -> String {
    match res.status {
        ScannerStatus::Skipped => res.notes.first().cloned().unwrap_or_default(),
        ScannerStatus::Error => {
            "cargo audit did not complete; Rust dependency coverage is degraded, not a pass.".into()
        }
        ScannerStatus::Fail => format!(
            "cargo audit found {} vulnerable package(s).",
            res.findings.len()
        ),
        ScannerStatus::Pass => {
            "cargo audit completed; no known vulnerabilities in the Rust lockfile.".into()
        }
    }
}

/// Merge orchestrator findings; de-duplicate by stable finding id so the gate
/// never evaluates the same finding twice when both sides report it.
fn merge_findings(mut findings: Vec<Finding>) -> Vec<Finding> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    findings.retain(|f| seen.insert(f.id.clone()));
    findings
}

/// Deterministic ordering for the response: severity, then confidence, then
/// rule, then file, then id.
fn sort_all(findings: &[Finding]) -> Vec<Finding> {
    let mut sorted = findings.to_vec();
    sorted.sort_by(crate::gate::findings_ordering);
    sorted
}

fn iso_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let (y, mo, d) = civil_from_days(days);
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

/// Read one request document from stdin (capped), execute it, and write one
/// response document to stdout (capped). Used by the binary.
///
/// Returns the process exit code.
pub fn serve() -> i32 {
    let mut input = String::new();
    match std::io::stdin().lock().read_line(&mut input) {
        Ok(0) => {
            eprintln!("veylqorix-engine: empty request; expected one JSON document on stdin");
            return exit::MALFORMED;
        }
        Ok(n) if n > MAX_INPUT_BYTES => {
            eprintln!("veylqorix-engine: request exceeds the {MAX_INPUT_BYTES}-byte input cap");
            return exit::MALFORMED;
        }
        Ok(_) => {}
        Err(e) => {
            eprintln!("veylqorix-engine: failed to read request: {e}");
            return exit::INTERNAL;
        }
    }
    let req = match parse_request(&input) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("veylqorix-engine: {msg}");
            return exit::MALFORMED;
        }
    };
    let response = match execute(&req) {
        Ok(r) => r,
        Err((code, msg)) => {
            eprintln!("veylqorix-engine: {msg}");
            return code;
        }
    };
    let doc = match serde_json::to_string(&response) {
        Ok(d) if d.len() <= MAX_OUTPUT_BYTES => d,
        _ => {
            eprintln!(
                "veylqorix-engine: response exceeds the {MAX_OUTPUT_BYTES}-byte output cap; aborting"
            );
            return exit::INTERNAL;
        }
    };
    let mut stdout = std::io::stdout();
    if let Err(e) = writeln!(stdout, "{doc}") {
        eprintln!("veylqorix-engine: failed to write response: {e}");
        return exit::INTERNAL;
    }
    0
}

/// Print a short usage line and the versions.
pub fn banner() -> String {
    format!(
        "veylqorix-engine {version} (protocol {protocol}, schema {schema})",
        version = crate::ENGINE_VERSION,
        protocol = crate::PROTOCOL_VERSION,
        schema = crate::model::SCHEMA_VERSION,
    )
}
