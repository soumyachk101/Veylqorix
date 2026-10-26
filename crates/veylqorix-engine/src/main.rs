//! Veylqorix engine binary.
//!
//! Reads one JSON request from stdin and writes one JSON response to stdout.
//! On protocol errors it writes a structured *error frame* (a response
//! document with `ok: false` and an `error` object) to stdout, a short
//! human-readable reason to stderr, and exits non-zero. The exit code is
//! authoritative: an error frame can never be read as a pass. stdout is
//! reserved strictly for protocol JSON in both directions; diagnostics go to
//! stderr only:
//!
//! - exit 0: a successful response document was written (the gate decision,
//!   findings, and scanner statuses are in the document).
//! - exit 64: malformed request / unsupported protocol version.
//! - exit 65: the audit root does not exist.
//! - exit 70: engine internal error.
//!
//! A *scanner* that is unavailable inside a scan never causes one of these
//! exits: it is recorded as a SKIPPED/ERROR scanner result so the gate can
//! degrade coverage honestly.

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first().map(String::as_str).unwrap_or("");
    if matches!(first, "--version" | "-V") {
        println!("{}", veylqorix_engine::banner());
        return;
    }
    if matches!(first, "--help" | "help" | "-h") {
        println!("{}", veylqorix_engine::banner());
        println!();
        println!("Usage:");
        println!("  veylqorix-engine < request.json     run one scan command");
        println!("  veylqorix-engine --version           print engine and protocol versions");
        println!();
        println!("Commands (request JSON `command`):");
        println!("  ping      report engine and protocol versions without doing work");
        println!("  scan      run the engine's built-in scanners and evaluate the gate");
        println!("  evaluate  evaluate the gate over supplied scanner evidence only");
        return;
    }
    if !args.is_empty() {
        eprintln!("veylqorix-engine: unrecognized argument '{first}'; the engine reads one JSON document on stdin. Run with --help.");
        std::process::exit(veylqorix_engine::protocol::exit::MALFORMED);
    }

    let code = veylqorix_engine::protocol::serve();
    // `serve` already wrote any stderr reason. Flush stdout so a partial
    // response is never lost on a non-zero exit.
    let _ = std::io::stdout().flush();
    std::process::exit(code);
}
