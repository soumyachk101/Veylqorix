//! Veylqorix engine binary.
//!
//! Reads one JSON request from stdin and writes one JSON response to stdout,
//! or exits non-zero with a stderr reason on protocol errors. The protocol is
//! bounded (input and output caps), versioned, and never treats an error as a
//! pass:
//!
//! - exit 0: a response document was written (the gate decision, findings, and
//!   scanner statuses are in the document).
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
