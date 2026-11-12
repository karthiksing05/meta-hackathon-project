//! Diagnostics (spec B2). Every check reports these instead of panicking, and
//! the validator keeps going to report as many as it can. They are what the
//! authoring AI reads to repair its output, so messages must be specific and
//! `at` must point at the exact JSON field.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Code {
    /// Malformed JSON, wrong JSON shape, or an expression that doesn't parse.
    Parse,
    /// Missing or wrong `format` tag.
    Format,
    UnknownName,
    TypeMismatch,
    NotAssignable,
    RandomInPure,
    Recursion,
    UnknownInput,
    UnknownEvent,
    BadPayload,
    ShadowsState,
    NoEndCondition,
    /// A required field is missing, or an unknown field appears where only a
    /// fixed set is allowed.
    BadField,
    /// Lambda used outside a call argument, or with the wrong arity.
    BadLambda,
    /// Name declared twice (state, function, type, input, event, record field).
    Duplicate,
    /// Presentation-specific problems (bad node kind, bad prop, bad token, bad color).
    Presentation,
    /// Error raised while running (simulation or live play).
    Runtime,
    /// An engine limit was exceeded at load time or run time.
    Limit,
    UnreachableRule,
    UnusedState,
    /// Any other warning.
    Lint,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::Parse => "E_PARSE",
            Code::Format => "E_FORMAT",
            Code::UnknownName => "E_UNKNOWN_NAME",
            Code::TypeMismatch => "E_TYPE_MISMATCH",
            Code::NotAssignable => "E_NOT_ASSIGNABLE",
            Code::RandomInPure => "E_RANDOM_IN_PURE",
            Code::Recursion => "E_RECURSION",
            Code::UnknownInput => "E_UNKNOWN_INPUT",
            Code::UnknownEvent => "E_UNKNOWN_EVENT",
            Code::BadPayload => "E_BAD_PAYLOAD",
            Code::ShadowsState => "E_SHADOWS_STATE",
            Code::NoEndCondition => "E_NO_END_CONDITION",
            Code::BadField => "E_BAD_FIELD",
            Code::BadLambda => "E_BAD_LAMBDA",
            Code::Duplicate => "E_DUPLICATE",
            Code::Presentation => "E_PRESENTATION",
            Code::Runtime => "E_RUNTIME",
            Code::Limit => "E_LIMIT",
            Code::UnreachableRule => "W_UNREACHABLE_RULE",
            Code::UnusedState => "W_UNUSED_STATE",
            Code::Lint => "W_LINT",
        }
    }

    pub fn severity(self) -> Severity {
        if self.as_str().starts_with("W_") {
            Severity::Warning
        } else {
            Severity::Error
        }
    }
}

impl Serialize for Code {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    pub code: Code,
    pub severity: Severity,
    /// JSON Pointer (RFC 6901) to the field, e.g. `/rules/1/do/0/to`.
    pub at: String,
    /// Character range `[start, end)` inside the expression string, when the
    /// problem is inside an expression.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<(u32, u32)>,
    pub message: String,
    /// "did you mean ...?" and other repair hints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl Diagnostic {
    pub fn new(code: Code, at: impl Into<String>, message: impl Into<String>) -> Self {
        Diagnostic { code, severity: code.severity(), at: at.into(), span: None, message: message.into(), hint: None }
    }
    pub fn with_span(mut self, span: (u32, u32)) -> Self {
        self.span = Some(span);
        self
    }
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }
    pub fn is_error(&self) -> bool {
        self.severity == Severity::Error
    }
}

/// Builds a JSON Pointer from path segments, escaping `~` and `/`.
pub fn pointer<I, S>(segments: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out = String::new();
    for s in segments {
        out.push('/');
        for c in s.as_ref().chars() {
            match c {
                '~' => out.push_str("~0"),
                '/' => out.push_str("~1"),
                c => out.push(c),
            }
        }
    }
    out
}

/// Levenshtein distance, for "did you mean" hints.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// Best "did you mean" candidate: smallest edit distance, at most
/// `max(1, len/3)` edits. Ties keep the first candidate.
pub fn suggest<'a, I>(name: &str, candidates: I) -> Option<&'a str>
where
    I: IntoIterator<Item = &'a str>,
{
    let limit = (name.chars().count() / 3).max(1);
    let mut best: Option<(usize, &'a str)> = None;
    for c in candidates {
        let d = edit_distance(name, c);
        if d <= limit && best.is_none_or(|(bd, _)| d < bd) {
            best = Some((d, c));
        }
    }
    best.map(|(_, c)| c)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pointers_and_hints() {
        assert_eq!(pointer(["rules", "1", "do", "0", "to"]), "/rules/1/do/0/to");
        assert_eq!(pointer(["a/b", "c~d"]), "/a~1b/c~0d");
        assert_eq!(suggest("snak", ["snake", "score"]), Some("snake"));
        assert_eq!(suggest("zzzz", ["snake"]), None);
        let d = Diagnostic::new(Code::TypeMismatch, "/x", "m").with_span((1, 2));
        let j = serde_json::to_string(&d).unwrap();
        assert!(j.contains("\"E_TYPE_MISMATCH\""), "{j}");
    }
}
