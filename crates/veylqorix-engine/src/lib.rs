//! Veylqorix security engine.
//!
//! This crate implements the security-decision core of Veylqorix:
//!
//! - typed scan configuration and a bounded JSON-over-stdio protocol
//! - deterministic policy resolution (defaults, overrides, auditable,
//!   expiring exceptions, exception caps)
//! - gate evaluation with PASS / FAIL / INCOMPLETE decisions
//! - deterministic exit-code mapping (0 / 1 / 2)
//! - normalized, schema-versioned finding representations with stable ids
//! - an offline secret scanner with deterministic redaction, with optional
//!   delegation to `gitleaks` when it is installed
//! - `cargo-audit` dependency scanning for Rust projects when available
//! - safe, shell-free subprocess execution with timeouts and bounded output
//!
//! The engine is invoked as a subprocess by the TypeScript core (`runAudit`
//! adapter) and is never a placeholder: every decision it returns is derived
//! from the actual scan evidence it is given, and unavailable external tools
//! surface as explicit SKIPPED/ERROR scanner results, never as passes.

pub mod dependencies;
pub mod exec;
pub mod finding;
pub mod gate;
pub mod model;
pub mod policy;
pub mod protocol;
pub mod redact;
pub mod secrets;

pub use model::{
    AppliedException, CheckResult, Confidence, CoverageLevel, Evidence, Finding, GateDecision,
    GateResult, Location, Policy, PolicyException, ProjectDetection, ResolvedPolicy, ScannerError,
    ScannerResult, ScannerStatus, Severity,
};
pub use protocol::{banner, execute, parse_request, serve};

/// The engine protocol version spoken by the `scan` command.
pub const PROTOCOL_VERSION: u32 = 1;

/// The engine version, reported to callers for compatibility checks.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A structured, non-silent engine error. Each variant describes a distinct
/// failure class so callers never have to guess what went wrong.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// The request document itself was malformed (bad JSON, unknown fields).
    InvalidRequest(String),
    /// A scanner could not run because an external tool is missing.
    MissingTool { tool: String, hint: String },
    /// An external tool was executed but timed out.
    TimedOut { tool: String, timeout_ms: u64 },
    /// An external tool exited with an error.
    ToolFailed { tool: String, message: String },
    /// An I/O failure reading or writing the audited tree.
    Io(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::InvalidRequest(m) => write!(f, "invalid request: {m}"),
            EngineError::MissingTool { tool, hint } => {
                write!(f, "external tool '{tool}' is unavailable; {hint}")
            }
            EngineError::TimedOut { tool, timeout_ms } => {
                write!(f, "external tool '{tool}' timed out after {timeout_ms}ms")
            }
            EngineError::ToolFailed { tool, message } => {
                write!(f, "external tool '{tool}' failed: {message}")
            }
            EngineError::Io(m) => write!(f, "I/O error: {m}"),
        }
    }
}
