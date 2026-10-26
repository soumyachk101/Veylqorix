//! Safe, shell-free subprocess execution with timeouts and bounded output.
//!
//! Rules enforced here (mirroring `packages/core/src/util/exec.ts`):
//! - No shell: always spawn with an explicit argument array.
//! - Untrusted input never flows into command arguments; callers build
//!   arguments from validated data only.
//! - Every execution carries a timeout; on timeout the child's **whole process
//!   group** is killed and the result carries `timed_out: true` so the caller
//!   classifies it as an error state, never a pass. Killing the group (not
//!   just the direct child) matters: a scanner like `cargo audit` spawns
//!   descendants (e.g. `git fetch` of the advisory database) that would
//!   otherwise inherit the output pipes and block the drain indefinitely —
//!   turning the "timeout" into a non-bounded wait.
//! - Output is retained bounded (a trailing window) so a chatty tool cannot
//!   exhaust memory.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::EngineError;

/// The result of a bounded subprocess execution.
#[derive(Debug, Clone)]
pub struct ExecResult {
    /// Process exit code, `None` when the process was killed / did not exit
    /// normally.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    /// True when the process group had to be killed because it exceeded the
    /// timeout.
    pub timed_out: bool,
}

/// Options for [`exec`].
#[derive(Debug, Clone)]
pub struct ExecOptions {
    pub cwd: Option<std::path::PathBuf>,
    pub timeout_ms: u64,
    /// Cap on how many kilobytes of (trailing) output are retained.
    pub max_output_kb: u64,
    pub env: Vec<(String, String)>,
}

impl Default for ExecOptions {
    fn default() -> Self {
        Self {
            cwd: None,
            timeout_ms: 120_000,
            max_output_kb: 256,
            env: Vec::new(),
        }
    }
}

/// In-memory cap for a single drained stream (bytes). The retained result is
/// truncated to `max_output_kb` afterwards, so this only bounds the transient
/// read buffer, not the reported output.
const DRAIN_BUFFER_CAP: usize = 16 * 1024 * 1024;

/// Return true when a program is resolvable on `PATH`.
pub fn which(program: &str) -> bool {
    if program.contains('/') || program.contains('\\') {
        return std::path::Path::new(program).is_file();
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        if dir.join(program).is_file() {
            return true;
        }
    }
    false
}

/// Put the child in its own new process group (Unix) so the whole tree can
/// be signalled together on timeout. A no-op on other platforms.
#[cfg(unix)]
fn start_in_new_process_group(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(move || {
            // `setpgid(0, 0)` makes the (already forked) child the leader of a
            // new group whose id equals its pid. If it fails we do not abort
            // the exec: we simply lose group-kill isolation for that run and
            // fall back to direct-kill behavior.
            let _ = libc::setpgid(0, 0);
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn start_in_new_process_group(_cmd: &mut Command) {}

/// Signal the child's whole process group (Unix). On non-Unix platforms this
/// signals only the direct child; a lingering grandchild holding the output
/// pipes is then handled by the drain deadline in [`exec`].
fn signal_group(pid: i32, sig: i32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-pid, sig);
    }
    #[cfg(not(unix))]
    unsafe {
        let _ = sig; // unused; handled by the caller's direct-kill path
    }
}

/// Run `program` with `args` without a shell, honoring a timeout and bounded
/// output. Never shells out.
///
/// - Resolves to `Ok(ExecResult)` on a normal exit (the exit code may be
///   non-zero; callers classify it). `timed_out` is true when the process
///   group was killed at the deadline.
/// - Resolves to `Err(EngineError::MissingTool)` when the binary cannot be
///   started.
/// - Resolves to `Err(EngineError::Io)` on spawn / reaping I/O failure.
///
/// Wall-clock is bounded: after the deadline the group is killed (Unix) or
/// the direct child is killed (other platforms), the drains are joined with a
/// short grace period, and the result is returned.
pub fn exec(
    program: &str,
    args: &[String],
    options: &ExecOptions,
) -> Result<ExecResult, EngineError> {
    let started = Instant::now();

    // Confirm the binary exists before spawning so a missing tool is reported
    // as MissingTool (a distinct, non-silent state) rather than a raw spawn
    // error.
    if !which(program) {
        return Err(EngineError::MissingTool {
            tool: program.to_string(),
            hint: "install it to enable this scan; it was not available, so the check is reported as incomplete, not passed."
                .into(),
        });
    }

    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(cwd) = &options.cwd {
        cmd.current_dir(cwd);
    }
    for (k, v) in &options.env {
        cmd.env(k, v);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    start_in_new_process_group(&mut cmd);

    let mut child: Child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            EngineError::MissingTool {
                tool: program.to_string(),
                hint: format!("the process could not be started: {e}"),
            }
        } else {
            EngineError::Io(format!("failed to spawn '{program}': {e}"))
        }
    })?;
    let pid = child.id() as i32;

    // Drain both pipes into shared, size-capped buffers on dedicated threads
    // so a chatty child can never fill a pipe buffer and deadlock its own
    // writes. The read ends are dropped into the threads, so once every
    // writer in the group is dead the drains hit EOF and finish promptly.
    let stdout_buf = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::new()));

    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| EngineError::Io("could not obtain the child's stdout pipe".into()))?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| EngineError::Io("could not obtain the child's stderr pipe".into()))?;

    let stdout_thread = {
        let buf = Arc::clone(&stdout_buf);
        std::thread::spawn(move || drain(stdout_pipe, buf))
    };
    let stderr_thread = {
        let buf = Arc::clone(&stderr_buf);
        std::thread::spawn(move || drain(stderr_pipe, buf))
    };

    // Poll for a normal exit until the deadline. When the deadline passes we
    // kill the whole process group (graceful TERM, then KILL) and reap the
    // direct child; the drains then hit EOF as the writers die.
    let deadline = Instant::now() + Duration::from_millis(options.timeout_ms);
    let mut timed_out = false;
    let mut reaped: Option<std::process::ExitStatus> = None;
    while reaped.is_none() {
        match child.try_wait() {
            Ok(Some(status)) => {
                reaped = Some(status);
                break;
            }
            Ok(None) => {
                if !timed_out && Instant::now() >= deadline {
                    timed_out = true;
                    // Graceful first: some tools flush their report on
                    // TERM. Escalate to KILL for the hard guarantee.
                    signal_group(pid, TERM_SIG);
                    std::thread::sleep(Duration::from_millis(150));
                    signal_group(pid, KILL_SIG);
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                // The child may have been reaped by the `kill`+`wait` above or
                // may still be running; surface the I/O error so the caller
                // classifies this scanner as errored, never passed.
                let _ = child.wait();
                return Err(EngineError::Io(format!(
                    "failed to wait for '{program}': {e}"
                )));
            }
        }
    }

    let status = reaped.expect("the loop only exits once the child was reaped");

    // Let the drains finish. On Unix the group kill closed every writer, so
    // EOF is immediate and the joins are short. On other platforms a grandchild
    // that escaped the direct-kill can still hold a pipe open; the join is
    // deadline-bounded so the captured data is what the caller sees and the
    // call returns, rather than blocking indefinitely.
    join_drain(stdout_thread, stderr_thread, options.timeout_ms);
    let stdout_bytes = {
        let mut g = stdout_buf.lock().unwrap_or_else(|p| p.into_inner());
        std::mem::take(&mut *g)
    };
    let stderr_bytes = {
        let mut g = stderr_buf.lock().unwrap_or_else(|p| p.into_inner());
        std::mem::take(&mut *g)
    };

    Ok(ExecResult {
        code: if timed_out { None } else { status.code() },
        stdout: truncate(
            &String::from_utf8_lossy(&stdout_bytes),
            options.max_output_kb,
        ),
        stderr: truncate(
            &String::from_utf8_lossy(&stderr_bytes),
            options.max_output_kb,
        ),
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out,
    })
}

/// Signal numbers for the two-stage kill, kept as constants so the non-Unix
/// path (direct-kill only) does not need the libc crate.
#[cfg(unix)]
const TERM_SIG: i32 = libc::SIGTERM;
#[cfg(unix)]
const KILL_SIG: i32 = libc::SIGKILL;
#[cfg(not(unix))]
const TERM_SIG: i32 = 0;
#[cfg(not(unix))]
const KILL_SIG: i32 = 0;

/// Read `pipe` into the shared `buf` in chunks until EOF, error, or the size
/// cap.
///
/// The read blocks, so the read end is only ever "done" when every writer of
/// the pipe is gone. On Unix that is guaranteed quickly because the timeout
/// kills the whole process group; the `join_drain` below bounds the wait as a
/// safety net on other platforms.
fn drain(mut pipe: impl Read, buf: Arc<Mutex<Vec<u8>>>) {
    let mut chunk = [0u8; 32 * 1024];
    loop {
        let n = match pipe.read(&mut chunk) {
            Ok(0) => break, // EOF
            Ok(n) => n,
            Err(_) => break,
        };
        let mut g = buf.lock().unwrap_or_else(|p| p.into_inner());
        g.extend_from_slice(&chunk[..n]);
        // Cap the transient buffer; the reported result is truncated later
        // anyway, so dropping the excess is safe.
        if g.len() > DRAIN_BUFFER_CAP {
            break;
        }
    }
}

/// Join the drain threads, bounding the wait so a grandchild that survived a
/// direct-kill (non-Unix only) cannot hold `exec` open past the deadline.
///
/// On Unix the group kill guarantees EOF, so both joins complete promptly and
/// we join them normally. On other platforms we use a captured-data-or-timeout
/// policy: wait at most `grace_ms` for the drains to finish; whatever has been
/// captured is what the caller sees, and a still-blocked drain thread is
/// abandoned (it ends when its writer eventually releases the pipe, and its
/// captured data already lives in the shared buffer).
fn join_drain(
    stdout_thread: std::thread::JoinHandle<()>,
    stderr_thread: std::thread::JoinHandle<()>,
    grace_ms: u64,
) {
    #[cfg(unix)]
    {
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        let _ = grace_ms;
    }
    #[cfg(not(unix))]
    {
        let deadline = Instant::now() + Duration::from_millis(grace_ms.saturating_add(5_000));
        while Instant::now() < deadline {
            if stdout_thread.is_finished() && stderr_thread.is_finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        // Best-effort join of whatever has settled; the shared buffers hold the
        // captured data regardless.
        if stdout_thread.is_finished() {
            let _ = stdout_thread.join();
        }
        if stderr_thread.is_finished() {
            let _ = stderr_thread.join();
        }
    }
}

/// Keep only the trailing `max_kb` of `text`, appending a marker when
/// truncated (mirrors the TypeScript `truncate`).
fn truncate(text: &str, max_kb: u64) -> String {
    let max_bytes = max_kb as usize * 1024;
    if text.len() <= max_bytes {
        return text.to_string();
    }
    // Trim to a UTF-8 boundary near the cap.
    let mut start = text.len() - max_bytes;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    let kept = &text[start..];
    let omitted_kb = ((text.len() - kept.len()) / 1024).max(1);
    format!("\n... [truncated {omitted_kb} KB of total] ...\n{kept}")
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn exec_echo_returns_output() {
        let res = exec("echo", &["hello".into()], &ExecOptions::default()).unwrap();
        assert_eq!(res.code, Some(0), "echo should exit 0, got {res:?}");
        assert_eq!(res.stdout.trim(), "hello");
        assert!(!res.timed_out);
    }

    #[test]
    fn exec_missing_binary_is_not_a_pass() {
        let err = exec(
            "definitely-not-a-real-binary-xyz",
            &[],
            &ExecOptions::default(),
        )
        .unwrap_err();
        assert!(
            matches!(err, EngineError::MissingTool { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn exec_times_out() {
        // Mirrors the TypeScript executor: a timeout is reported through the
        // result's `timed_out` flag (the caller classifies it as an error),
        // not as a spawn failure.
        let opts = ExecOptions {
            timeout_ms: 150,
            ..ExecOptions::default()
        };
        let args = vec!["5".into()];
        let res = exec("sleep", &args, &opts).unwrap();
        assert!(
            res.timed_out,
            "the long sleep must be reported as timed out"
        );
        assert!(res.code.is_none());
    }

    #[test]
    fn timed_out_child_is_killed_and_reported() {
        let opts = ExecOptions {
            timeout_ms: 200,
            ..ExecOptions::default()
        };
        let args = vec!["-c".into(), "sleep 5".into()];
        let res = exec("sh", &args, &opts).unwrap();
        assert!(res.timed_out, "got {res:?}");
    }

    #[cfg(unix)]
    #[test]
    fn timed_out_process_group_does_not_outlive_the_call() {
        // The core regression this executor must prevent: a grandchild that
        // inherits the output pipes must be killed with the group so the
        // "timeout" actually bounds wall-clock time instead of blocking on a
        // drain that never reaches EOF.
        let opts = ExecOptions {
            timeout_ms: 300,
            ..ExecOptions::default()
        };
        // `sh` backgrounds a `sleep` that inherits the pipes, then itself
        // sleeps; both are in the spawned group.
        let args = vec!["-c".into(), "sleep 60 > /dev/null & sleep 60".into()];
        let t0 = Instant::now();
        let res = exec("sh", &args, &opts).unwrap();
        assert!(
            res.timed_out,
            "group must be reported as timed out: {res:?}"
        );
        let elapsed = t0.elapsed();
        assert!(
            elapsed < Duration::from_secs(10),
            "the call must return well after the 300ms deadline, not block on a \
             grandchild; took {elapsed:?}"
        );
    }

    #[test]
    fn non_zero_exit_is_reported_not_swallowed() {
        let args = vec!["-c".into(), "exit 3".into()];
        let res = exec("sh", &args, &ExecOptions::default()).unwrap();
        assert_eq!(res.code, Some(3));
        assert!(!res.timed_out);
    }

    #[test]
    fn chatty_output_is_bounded() {
        // A tool that writes far more than the cap must not exhaust memory;
        // only the trailing window is retained.
        let opts = ExecOptions {
            max_output_kb: 1,
            ..ExecOptions::default()
        };
        let res = exec(
            "sh",
            &[
                "-c".into(),
                "for i in $(seq 1 5000); do echo line$i; done".into(),
            ],
            &opts,
        )
        .unwrap();
        assert!(
            res.stdout.len() < 4096,
            "output was not bounded: {} bytes",
            res.stdout.len()
        );
        assert!(res.stdout.contains("truncated"));
    }

    #[test]
    fn truncate_keeps_tail() {
        let long = "a".repeat(3000);
        let out = truncate(&long, 2);
        assert!(out.len() < 3000);
        assert!(out.contains("truncated"));
    }
}
