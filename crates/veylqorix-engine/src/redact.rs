//! Secret-safe evidence handling.
//!
//! Scanners must never place a raw credential into a finding, a report, or a
//! log. [`redact_secret`] is the single masking function used by the secret
//! scanner and by the deep-redaction pass applied to any text that flows back
//! to a caller. It is byte-compatible with the TypeScript `redactSecret` in
//! `packages/core/src/scanners/secrets.ts` (verified against golden vectors).

/// Mask a matched secret value, keeping just enough characters to identify it
/// without reproducing it.
///
/// - Values of 8 characters or fewer are replaced entirely with `****`.
/// - Longer values keep the first 4 and last 4 characters and are annotated
///   with their length: `abcd…wxyz (N chars, redacted)`.
pub fn redact_secret(value: &str) -> String {
    if value.len() <= 8 {
        return "****".to_string();
    }
    let start = head_chars(value, 4);
    let tail = tail_chars(value, 4);
    let len = char_len(value);
    format!("{start}…{tail} ({len} chars, redacted)")
}

/// Number of UTF-8 characters in `s`.
fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// First `n` characters of `s`.
fn head_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Last `n` characters of `s`.
fn tail_chars(s: &str, n: usize) -> String {
    let len = char_len(s);
    s.chars().skip(len.saturating_sub(n)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_long_values_like_the_ts_implementation() {
        // Golden vector cross-checked against `packages/core` output.
        assert_eq!(
            redact_secret("AKIA0123456789ABCDEF"),
            "AKIA…CDEF (20 chars, redacted)"
        );
        assert_eq!(
            redact_secret("ghp_0123456789abcdefghijklmnopqrstuvwxyz0123456789"),
            "ghp_…6789 (50 chars, redacted)"
        );
    }

    #[test]
    fn masks_short_values_entirely() {
        assert_eq!(redact_secret("short1"), "****");
        assert_eq!(redact_secret(""), "****");
    }

    #[test]
    fn never_returns_the_full_value() {
        let value = "AKIA0123456789ABCDEF";
        let redacted = redact_secret(value);
        assert!(!redacted.contains(value));
        assert!(redacted.contains("redacted"));
    }

    #[test]
    fn handles_multibyte_char_boundaries() {
        // 10 chars with multibyte runes must not panic or slice mid-codepoint.
        let value = "éééééééééé";
        let redacted = redact_secret(value);
        assert!(redacted.contains("redacted"));
        assert!(!redacted.contains(value));
    }
}
