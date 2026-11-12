//! Surface AST for expression strings, as produced by the parser in `mg-lang`.
//!
//! Spans are character offsets (`char` indices, not bytes) into the original
//! expression string, half-open `[start, end)`. Diagnostics report them as-is.

use std::rc::Rc;

pub type Span = (u32, u32);
pub type Name = Rc<str>;

#[derive(Clone, Debug, PartialEq)]
pub struct Expr {
    pub kind: ExprKind,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ExprKind {
    Int(i64),
    Float(f64),
    /// `150ms`, `2s`: always milliseconds. Type `int`.
    Duration(i64),
    Bool(bool),
    Str(Name),
    None,
    /// Plain identifier: local, `event`, state, function, constant (`up`, `now`...).
    Ident(Name),
    /// `$name`: presentation token. Only valid inside presentation.
    Token(Name),
    /// `base.field`. The second span covers just the field name.
    Field(Box<Expr>, Name, Span),
    /// `base[index]`
    Index(Box<Expr>, Box<Expr>),
    /// `name(args)`. The callee must be a plain identifier; the parser reports
    /// `E_PARSE` otherwise. The span covers just the callee name.
    Call(Name, Span, Vec<Expr>),
    Unary(UnOp, Box<Expr>),
    Binary(BinOp, Box<Expr>, Box<Expr>),
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    /// `let name = value in body`
    Let(Name, Span, Box<Expr>, Box<Expr>),
    /// `x => body` or `(a, b) => body`. Only legal as a call argument.
    Lambda(Vec<(Name, Span)>, Box<Expr>),
    List(Vec<Expr>),
    Record(Vec<RecordItem>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum RecordItem {
    Field(Name, Span, Expr),
    /// `...expr`
    Spread(Expr),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum UnOp {
    Neg,
    Not,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    /// Short-circuit.
    And,
    /// Short-circuit.
    Or,
}

impl BinOp {
    pub fn symbol(self) -> &'static str {
        match self {
            BinOp::Add => "+",
            BinOp::Sub => "-",
            BinOp::Mul => "*",
            BinOp::Div => "/",
            BinOp::Mod => "%",
            BinOp::Eq => "==",
            BinOp::Ne => "!=",
            BinOp::Lt => "<",
            BinOp::Le => "<=",
            BinOp::Gt => ">",
            BinOp::Ge => ">=",
            BinOp::And => "and",
            BinOp::Or => "or",
        }
    }
}
