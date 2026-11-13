//! Human-readable diagnostics, with the offending expression and a caret
//! line under the span.

use mg_core::{Diagnostic, Severity};
use serde_json::Value as J;

/// Resolves a JSON Pointer (RFC 6901).
pub fn resolve<'a>(doc: &'a J, ptr: &str) -> Option<&'a J> {
    if ptr.is_empty() {
        return Some(doc);
    }
    doc.pointer(ptr)
}

pub fn format_diag(d: &Diagnostic, doc: Option<&J>) -> String {
    let sev = match d.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
    };
    let at = if d.at.is_empty() { "/" } else { &d.at };
    let mut s = format!("{sev}[{}] {at}", d.code.as_str());
    if let Some((a, b)) = d.span {
        s.push_str(&format!(" [{a}..{b}]"));
    }
    s.push_str(": ");
    s.push_str(&d.message);
    if let Some(J::String(src)) = doc.and_then(|doc| resolve(doc, &d.at)) {
        if !src.contains('\n') && src.chars().count() <= 300 {
            s.push_str("\n    ");
            s.push_str(src);
            if let Some((a, b)) = d.span {
                let a = a as usize;
                let width = (b as usize).saturating_sub(a).max(1);
                s.push_str("\n    ");
                s.push_str(&" ".repeat(a));
                s.push_str(&"^".repeat(width));
            }
        }
    }
    if let Some(h) = &d.hint {
        s.push_str("\n    hint: ");
        s.push_str(h);
    }
    s
}

pub fn summary(diags: &[Diagnostic]) -> String {
    let e = diags.iter().filter(|d| d.is_error()).count();
    let w = diags.len() - e;
    format!("{e} error{}, {w} warning{}", if e == 1 { "" } else { "s" }, if w == 1 { "" } else { "s" })
}
