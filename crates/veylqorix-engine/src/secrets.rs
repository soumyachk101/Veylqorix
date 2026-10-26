//! The offline secret scanner.
//!
//! A maintained set of high-entropy, vendor-specific secret patterns is applied
//! to the files in scope, and every matched value is masked before it appears
//! in a finding. The scanner runs entirely against local files so that source
//! code never leaves the machine by default.
//!
//! Two execution modes:
//! - **Offline rule-set** (always available, byte-compatible with the
//!   TypeScript scanner in `packages/core/src/scanners/secrets.ts`).
//! - **`gitleaks` delegation** (when the `gitleaks` binary is installed and
//!   the tool is available). Findings are normalized into the same schema and
//!   re-redacted. If `gitleaks` is unavailable, the scanner reports that
//!   explicitly rather than silently passing.
//!
//! Either mode is selected by the orchestrator; the offline rule-set is the
//! authoritative default so results are reproducible on any machine.

use std::collections::BTreeMap;

use crate::finding::{make_finding, MakeFinding};
use crate::model::{Confidence, Evidence, Finding, ScannerResult, ScannerStatus, Severity};
use crate::redact::redact_secret;

/// Secret-scanning options, mirrored from the TypeScript `SecretScanOptions`.
#[derive(Debug, Clone, Default)]
pub struct SecretScanOptions {
    /// Extra file extensions to scan beyond the defaults.
    pub extra_extensions: Vec<String>,
    /// Files and directories to exclude, relative to the audit root.
    pub exclude: Vec<String>,
    /// When set, restrict the scan to exactly these files (relative to root).
    pub files: Option<Vec<String>>,
    /// When true, attempt to delegate to `gitleaks` first; fall back to the
    /// offline rule-set when the tool is unavailable.
    pub prefer_gitleaks: bool,
}

/// The set of file extensions the secret scanner inspects by default.
pub const DEFAULT_EXTENSIONS: &[&str] = &[
    ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".rb", ".php",
    ".cs", ".sh", ".yaml", ".yml", ".json", ".env",
];

/// A single secret-detection rule (offline rule-set).
#[derive(Debug, Clone)]
pub struct SecretRule {
    pub name: &'static str,
    pub description: &'static str,
    /// A Rust regular expression. The first capture group, when present, holds
    /// the secret value; otherwise the whole match is the value.
    pub pattern: &'static str,
    /// Capture group index holding the secret value (0 = whole match).
    pub secret_group: usize,
    pub severity: Severity,
    pub confidence: Confidence,
    pub advisory: Option<&'static str>,
    pub remediation: &'static str,
}

/// The offline rule-set. Patterns mirror the TypeScript rule-set.
pub const RULES: &[SecretRule] = &[
    SecretRule {
        name: "aws-access-key-id",
        description: "AWS access key identifier",
        pattern: r"\b(AKIA[0-9A-Z]{16})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::High,
        advisory: Some(
            "https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys",
        ),
        remediation: "Remove the key from source control, rotate it in the AWS IAM console, and load it from an environment variable or secret manager at runtime.",
    },
    SecretRule {
        name: "github-personal-access-token",
        description: "GitHub personal access token (legacy or fine-grained)",
        pattern: r"\b([a-z]{1,5}\d{20,32})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::Medium,
        advisory: Some(
            "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-tokens",
        ),
        remediation: "Revoke the token in GitHub settings, rotate it, and reference it through the environment instead of hardcoding it.",
    },
    SecretRule {
        name: "github-github-pat-classic",
        description: "Classic GitHub personal access token (ghp_, gho_, etc.)",
        pattern: r"\b(gh[pousr]_[A-Za-z0-9]{36,255})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::High,
        advisory: Some(
            "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-personal-access-tokens",
        ),
        remediation: "Revoke the token, rotate it, and load it from an environment variable.",
    },
    SecretRule {
        name: "slack-token",
        description: "Slack bot or user token",
        pattern: r"\b(xox[baprs]-[A-Za-z0-9-]{10,255})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::High,
        advisory: None,
        remediation: "Revoke the token in the Slack API dashboard and load it from an environment variable.",
    },
    SecretRule {
        name: "private-key-block",
        description: "PEM-encoded private key material",
        pattern: r"-----BEGIN (?:RSA|EC|DSA|OPENSSH|ENCRYPTED)? ?PRIVATE KEY-----",
        secret_group: 0,
        severity: Severity::Critical,
        confidence: Confidence::High,
        advisory: None,
        remediation: "Remove the key from the repository, rotate the key pair, and add the key to git history cleanup if it was committed.",
    },
    SecretRule {
        name: "openai-api-key",
        description: "OpenAI API key",
        pattern: r"\b(sk-[A-Za-z0-9]{20,})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::Medium,
        advisory: None,
        remediation: "Revoke the key in the provider dashboard and load it from an environment variable.",
    },
    SecretRule {
        name: "anthropic-api-key",
        description: "Anthropic API key",
        pattern: r"\b(sk-ant-[A-Za-z0-9_-]{20,})\b",
        secret_group: 1,
        severity: Severity::High,
        confidence: Confidence::Medium,
        advisory: None,
        remediation: "Revoke the key and load it from an environment variable.",
    },
    SecretRule {
        name: "google-api-key",
        description: "Google API key",
        pattern: r"\b(AIza[0-9A-Za-z_-]{35})\b",
        secret_group: 1,
        severity: Severity::Medium,
        confidence: Confidence::Medium,
        advisory: None,
        remediation: "Restrict the key in Google Cloud Console and load it from an environment variable.",
    },
    SecretRule {
        name: "heroku-api-key",
        description: "Heroku API key or account email",
        pattern: r"\b([a-z]{32}@[a-z0-9.-]+\.[a-z]{2,})\b",
        secret_group: 1,
        severity: Severity::Low,
        confidence: Confidence::Low,
        advisory: None,
        remediation: "Confirm whether this is a hardcoded credential and rotate if so.",
    },
];

/// Files that must never be walked (mirrors the TypeScript `walk` ignore set).
pub const IGNORED_DIRS: &[&str] = &["node_modules", ".git", "__pycache__", "venv", ".venv"];

/// Whether a file (relative to the audit root) should be scanned.
pub fn should_scan(file: &str, extra_extensions: &[String], exclude: &[String]) -> bool {
    for ex in exclude {
        let prefix = format!("{ex}/");
        if file == ex || file.starts_with(&prefix) {
            return false;
        }
    }
    let lower = file.to_ascii_lowercase();
    // The file's own extension (from its basename) or its `.env`-style name.
    let base = lower.rsplit('/').next().unwrap_or("");
    let extension = base
        .rsplit('.')
        .next()
        .filter(|_| base.contains('.'))
        .unwrap_or("");
    if DEFAULT_EXTENSIONS
        .iter()
        .any(|e| e.trim_start_matches('.') == extension && !extension.is_empty())
    {
        return true;
    }
    if extra_extensions
        .iter()
        .any(|e| lower.ends_with(&e.to_ascii_lowercase()))
    {
        return true;
    }
    base == ".env"
}

/// Scan a set of files (each a `(relative_path, content)` pair) using the
/// offline rule-set and return normalized, redacted findings. This is the
/// core, deterministic matching routine that the differential tests verify
/// against the TypeScript implementation.
pub fn match_rules(files: &[(String, String)]) -> Vec<Finding> {
    let mut findings: Vec<Finding> = Vec::new();
    let mut regexes: Vec<regex::Regex> = Vec::new();
    for rule in RULES {
        regexes.push(
            regex::Regex::new(rule.pattern)
                .unwrap_or_else(|_| panic!("invalid built-in rule regex for {}", rule.name)),
        );
    }

    for (file, content) in files {
        for (rule, re) in RULES.iter().zip(regexes.iter()) {
            for cap in re.captures_iter(content) {
                let whole = cap
                    .get(0)
                    .expect("a regex match always has a whole-match group 0");
                let value = if rule.secret_group > 0 {
                    cap.get(rule.secret_group)
                        .map(|g| g.as_str().to_string())
                        .unwrap_or_else(|| whole.as_str().to_string())
                } else {
                    whole.as_str().to_string()
                };

                let (line, column) = line_column(content, whole.start());
                let evidence = Evidence {
                    snippet: Some(redact_secret(&value)),
                    details: Some(BTreeMap::from([
                        (
                            "rule".to_string(),
                            serde_json::Value::String(rule.name.to_string()),
                        ),
                        (
                            "description".to_string(),
                            serde_json::Value::String(rule.description.to_string()),
                        ),
                    ])),
                };
                findings.push(make_finding(MakeFinding {
                    scanner: "secrets",
                    rule_id: rule.name,
                    title: &format!("{} detected in {file}", rule.description),
                    severity: rule.severity,
                    confidence: rule.confidence,
                    file: Some(file.as_str()),
                    line: Some(line),
                    column: Some(column),
                    dependency: None,
                    evidence: Some(&evidence),
                    remediation: Some(rule.remediation),
                    advisory: rule.advisory,
                    secret: Some(true),
                    secret_override: None,
                }));
            }
        }
    }
    findings
}

/// Compute the 1-based line and column for a byte offset in a string.
///
/// The TypeScript scanner counts columns in *characters* (string indices),
/// so this converts the byte offset to a char offset first to stay
/// byte-compatible on multibyte content.
fn line_column(content: &str, byte_offset: usize) -> (u32, u32) {
    let head = &content[..byte_offset];
    let line = head.bytes().filter(|b| *b == b'\n').count() + 1;
    let last_break = head.rfind('\n').map(|i| i + 1).unwrap_or(0);
    // Column is the character count after the last newline (not the byte
    // count), matching `String.prototype.length` semantics in JS.
    let column = content[last_break..byte_offset].chars().count() + 1;
    (line as u32, column as u32)
}

/// Build a `ScannerResult` for the secret scanner from a list of scanned files.
pub fn secret_scanner_result(files: &[(String, String)], source: &str) -> ScannerResult {
    let started = std::time::Instant::now();
    let findings = match_rules(files);
    let files_scanned = files.len() as u64;
    let status = if findings.iter().any(|f| f.secret == Some(true)) {
        ScannerStatus::Fail
    } else {
        ScannerStatus::Pass
    };
    let mut notes: Vec<String> = Vec::new();
    if findings.is_empty() {
        notes.push(format!(
            "Scanned {files_scanned} file(s); no known secret patterns matched ({source}). This does not guarantee the absence of secrets."
        ));
    } else {
        notes.push(format!(
            "Scanned {files_scanned} file(s); {} potential secret(s) detected and redacted ({source}).",
            findings.len()
        ));
    }
    let summary = Some(BTreeMap::from([
        (
            "filesScanned".to_string(),
            serde_json::Value::from(files_scanned),
        ),
        (
            "detected".to_string(),
            serde_json::Value::from(findings.len()),
        ),
        (
            "source".to_string(),
            serde_json::Value::String(source.to_string()),
        ),
    ]));

    ScannerResult {
        scanner: "secrets".into(),
        status,
        findings,
        duration_ms: started.elapsed().as_millis() as u64,
        error: None,
        notes,
        summary,
    }
}

/// Walk a directory tree, returning `(relative_posix_path, content)` pairs
/// for files that [`should_scan`] accepts. Respects the ignore set and a max
/// depth. Binary or oversized files are skipped.
pub fn collect_files(
    root: &std::path::Path,
    options: &SecretScanOptions,
    only_files: &Option<Vec<String>>,
) -> Result<Vec<(String, String)>, crate::EngineError> {
    let mut files: Vec<(String, String)> = Vec::new();
    let mut queue: std::collections::VecDeque<(std::path::PathBuf, u32)> =
        std::collections::VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));
    const MAX_DEPTH: u32 = 8;

    while let Some((dir, depth)) = queue.pop_front() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let abs = entry.path();
            let relative = abs
                .strip_prefix(root)
                .ok()
                .map(|p| p.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
                .unwrap_or(name.clone());
            if IGNORED_DIRS.iter().any(|d| name == *d) {
                continue;
            }
            if name.starts_with('.') {
                // Hidden files/dirs are skipped unless explicitly in the
                // requested set (e.g. `.env`), matching the TS scanner which
                // walks with `includeHidden` for the secret scope.
                let requested = only_files
                    .as_ref()
                    .map(|fs| fs.iter().any(|f| f == &relative))
                    .unwrap_or(false);
                if !requested {
                    continue;
                }
            }
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if depth < MAX_DEPTH {
                    queue.push_back((abs, depth + 1));
                }
                continue;
            }
            if !should_scan(&relative, &options.extra_extensions, &options.exclude) {
                continue;
            }
            if let Some(requested) = only_files {
                if !requested.iter().any(|f| f == &relative) {
                    continue;
                }
            }
            let content = match std::fs::read_to_string(&abs) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if content.chars().count() > 2_000_000 || content.contains('\0') {
                continue;
            }
            files.push((relative, content));
        }
    }
    Ok(files)
}
