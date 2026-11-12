//! Type strings (`grid<bool>`, `list<Meteor>`, `int?`), `{"enum": [...]}`
//! objects, inline record objects, and the `types` section.

use std::rc::Rc;

use mg_core::ast::Span;
use mg_core::diag::{Code, Diagnostic};
use mg_core::types::Type;
use serde_json::Value as J;

use crate::check::{dym, Checker};
use crate::ptr;

const PRIMS: &[&str] = &["bool", "int", "float", "string", "ivec2", "vec2", "list", "set", "map", "grid"];

struct TyErr {
    code: Code,
    span: Span,
    msg: String,
    hint: Option<String>,
}

struct TyParser<'a> {
    cs: Vec<char>,
    pos: usize,
    ck: &'a mut Checker,
    at: &'a str,
}

impl<'a> TyParser<'a> {
    fn ws(&mut self) {
        while self.pos < self.cs.len() && self.cs[self.pos].is_whitespace() {
            self.pos += 1;
        }
    }
    fn peek(&mut self) -> Option<char> {
        self.ws();
        self.cs.get(self.pos).copied()
    }
    fn err(&self, start: usize, end: usize, msg: impl Into<String>) -> TyErr {
        TyErr { code: Code::Parse, span: (start as u32, end as u32), msg: msg.into(), hint: None }
    }
    fn ty(&mut self) -> Result<Type, TyErr> {
        let start = {
            self.ws();
            self.pos
        };
        let mut t = self.base()?;
        if self.peek() == Some('?') {
            self.pos += 1;
            if matches!(t, Type::Option(_)) {
                return Err(self.err(start, self.pos, "nested optionals (T??) are not allowed"));
            }
            t = Type::option(t);
            if self.peek() == Some('?') {
                return Err(self.err(start, self.pos + 1, "nested optionals (T??) are not allowed"));
            }
        }
        Ok(t)
    }
    /// `{name: type, ...}` inside a type string.
    fn record(&mut self) -> Result<Type, TyErr> {
        let open = self.pos;
        self.pos += 1;
        let mut fields: Vec<(Rc<str>, Type)> = Vec::new();
        loop {
            if self.peek() == Some('}') {
                self.pos += 1;
                return Ok(Type::record(fields));
            }
            self.ws();
            let start = self.pos;
            while self.pos < self.cs.len() && (self.cs[self.pos].is_ascii_alphanumeric() || self.cs[self.pos] == '_') {
                self.pos += 1;
            }
            if start == self.pos {
                return Err(self.err(start, start + 1, "expected a field name in the record type"));
            }
            let name: String = self.cs[start..self.pos].iter().collect();
            if fields.iter().any(|(n, _)| **n == *name) {
                return Err(TyErr {
                    code: Code::Duplicate,
                    span: (start as u32, self.pos as u32),
                    msg: format!("field '{name}' appears twice"),
                    hint: None,
                });
            }
            if self.peek() != Some(':') {
                return Err(self.err(self.pos, self.pos + 1, format!("expected ':' after field '{name}'")));
            }
            self.pos += 1;
            let t = self.ty()?;
            fields.push((Rc::from(name.as_str()), t));
            match self.peek() {
                Some(',') => self.pos += 1,
                Some('}') => {}
                _ => return Err(self.err(self.pos, self.pos + 1, format!("expected '}}' to close '{{' at {open}"))),
            }
        }
    }

    fn base(&mut self) -> Result<Type, TyErr> {
        self.ws();
        if self.cs.get(self.pos) == Some(&'{') {
            return self.record();
        }
        let start = self.pos;
        while self.pos < self.cs.len() && (self.cs[self.pos].is_ascii_alphanumeric() || self.cs[self.pos] == '_') {
            self.pos += 1;
        }
        if start == self.pos {
            let found = self.cs.get(self.pos).map(|c| format!("'{c}'")).unwrap_or_else(|| "the end".into());
            return Err(self.err(start, (self.pos + 1).min(self.cs.len()), format!("expected a type name, found {found}")));
        }
        let name: String = self.cs[start..self.pos].iter().collect();
        let end = self.pos;
        let generic = matches!(name.as_str(), "list" | "set" | "grid" | "map");
        if generic {
            if self.peek() != Some('<') {
                let n = if name == "map" { "<K, V>" } else { "<T>" };
                return Err(TyErr {
                    code: Code::Parse,
                    span: (start as u32, end as u32),
                    msg: format!("'{name}' needs an element type, like {name}{n}"),
                    hint: None,
                });
            }
            self.pos += 1;
            let a = self.ty()?;
            let t = if name == "map" {
                if self.peek() != Some(',') {
                    return Err(self.err(self.pos, self.pos + 1, "map needs two types: map<K, V>"));
                }
                self.pos += 1;
                let b = self.ty()?;
                Type::map(a, b)
            } else {
                match name.as_str() {
                    "list" => Type::list(a),
                    "set" => Type::set(a),
                    _ => Type::grid(a),
                }
            };
            if self.peek() != Some('>') {
                return Err(self.err(self.pos, self.pos + 1, format!("expected '>' to close '{name}<'")));
            }
            self.pos += 1;
            return Ok(t);
        }
        Ok(match name.as_str() {
            "bool" => Type::Bool,
            "int" => Type::Int,
            "float" => Type::Float,
            "string" => Type::Str,
            "ivec2" => Type::IVec2,
            "vec2" => Type::Vec2,
            _ => {
                let span = (start as u32, end as u32);
                return match self.ck.named_type(&name, self.at, Some(span)) {
                    Some(t) => Ok(t),
                    None => {
                        let hint = match name.as_str() {
                            "str" | "text" => Some("use 'string'".to_string()),
                            "number" | "num" | "double" => Some("use 'int' or 'float'".to_string()),
                            "boolean" => Some("use 'bool'".to_string()),
                            "array" | "vec" => Some("use list<T>".to_string()),
                            _ => {
                                let mut c: Vec<&str> = PRIMS.to_vec();
                                c.extend(self.ck.type_names.iter().map(|n| &**n));
                                dym(&name, c)
                            }
                        };
                        Err(TyErr { code: Code::UnknownName, span, msg: format!("unknown type '{name}'"), hint })
                    }
                };
            }
        })
    }
}

impl Checker {
    /// Resolves a name declared in `types`, on demand (so declaration order
    /// doesn't matter). Returns `None` if the name isn't declared. Reports
    /// cycles as `E_RECURSION`.
    pub fn named_type(&mut self, name: &str, at: &str, span: Option<Span>) -> Option<Type> {
        if let Some(t) = self.types.get(name) {
            return Some(t.clone());
        }
        let (raw, raw_at) = self.raw_types.get(name).cloned()?;
        if self.resolving.iter().any(|n| &**n == name) {
            let mut cyc: Vec<&str> = self.resolving.iter().map(|n| &**n).collect();
            cyc.push(name);
            let msg = format!("type '{name}' contains itself: {}", cyc.join(" → "));
            let mut d = Diagnostic::new(Code::Recursion, at, msg);
            d.span = span;
            self.push_diag(d);
            return Some(Type::Unknown);
        }
        self.resolving.push(Rc::from(name));
        let t = self.type_decl(&raw, &raw_at);
        self.resolving.pop();
        self.types.insert(Rc::from(name), t.clone());
        Some(t)
    }

    /// A declaration in `types`: record object, `{"enum": [...]}`, or a type string.
    fn type_decl(&mut self, v: &J, at: &str) -> Type {
        self.resolve_type(v, at)
    }

    /// A type written in the file: a type string, `{"enum": [...]}`, or an
    /// inline record object.
    pub fn resolve_type(&mut self, v: &J, at: &str) -> Type {
        match v {
            J::String(s) => self.type_str(s, at),
            J::Object(m) if m.contains_key("enum") => {
                if m.len() > 1 {
                    for k in m.keys().filter(|k| *k != "enum") {
                        self.err_at(Code::BadField, &ptr(at, k), format!("unexpected key '{k}' in an enum type"), None);
                    }
                }
                let eat = ptr(at, "enum");
                let Some(J::Array(items)) = m.get("enum") else {
                    self.err_at(Code::Parse, &eat, "enum must be a list of strings, like {\"enum\": [\"a\", \"b\"]}", None);
                    return Type::Unknown;
                };
                let mut members: Vec<Rc<str>> = Vec::with_capacity(items.len());
                for (i, it) in items.iter().enumerate() {
                    match it {
                        J::String(s) => {
                            if members.iter().any(|m| **m == **s) {
                                self.err_at(Code::Duplicate, &ptr(&eat, &i.to_string()), format!("enum member '{s}' appears twice"), None);
                            } else {
                                members.push(Rc::from(s.as_str()));
                            }
                        }
                        _ => self.err_at(Code::Parse, &ptr(&eat, &i.to_string()), "enum members must be strings", None),
                    }
                }
                if members.is_empty() {
                    self.err_at(Code::Parse, &eat, "an enum needs at least one member", None);
                    return Type::Unknown;
                }
                Type::Enum(Rc::from(members))
            }
            J::Object(m) => {
                let mut fields = Vec::with_capacity(m.len());
                for (k, fv) in m {
                    let t = self.resolve_type(fv, &ptr(at, k));
                    fields.push((Rc::from(k.as_str()), t));
                }
                Type::record(fields)
            }
            _ => {
                self.err_at(
                    Code::Parse,
                    at,
                    "expected a type: a string like \"int\" or \"list<Card>\", {\"enum\": [...]}, or a record object",
                    None,
                );
                Type::Unknown
            }
        }
    }

    pub fn type_str(&mut self, s: &str, at: &str) -> Type {
        let mut p = TyParser { cs: s.chars().collect(), pos: 0, ck: self, at };
        let r = p.ty().and_then(|t| {
            if let Some(c) = p.peek() {
                let pos = p.pos;
                Err(p.err(pos, pos + 1, format!("unexpected '{c}' after the type")))
            } else {
                Ok(t)
            }
        });
        match r {
            Ok(t) => t,
            Err(e) => {
                let mut d = Diagnostic::new(e.code, at, e.msg).with_span(e.span);
                d.hint = e.hint;
                self.push_diag(d);
                Type::Unknown
            }
        }
    }
}
