//! Expression parser (spec A6 grammar). Produces `mg_core::ast::Expr` with
//! character spans.
//!
//! ```text
//! expr    := lambda | 'let' IDENT '=' expr 'in' expr | 'if' expr 'then' expr 'else' expr | or
//! or      := and ('or' and)*
//! and     := not ('and' not)*
//! not     := 'not' not | cmp
//! cmp     := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?
//! sum     := prod (('+'|'-') prod)*
//! prod    := unary (('*'|'/'|'%') unary)*
//! unary   := '-' unary | postfix
//! postfix := atom ('.' IDENT | '[' expr ']' | '(' args ')')*
//! atom    := NUMBER | DURATION | STRING | 'true' | 'false' | 'none' | '$' IDENT | IDENT
//!          | '[' args ']' | '{' fields '}' | '(' expr ')'
//! lambda  := IDENT '=>' expr | '(' IDENT (',' IDENT)* ')' '=>' expr
//! fields  := (IDENT ':' expr | '...' expr) (',' ...)*
//! ```

use std::rc::Rc;

use mg_core::ast::{BinOp, Expr, ExprKind, RecordItem, Span, UnOp};

use crate::lexer::{lex, Tok, Token};

/// A parse error with a character span into the source string.
#[derive(Clone, Debug, PartialEq)]
pub struct ParseError {
    pub span: (u32, u32),
    pub message: String,
    pub hint: Option<String>,
}

/// Parses one expression string. The whole string must be consumed.
pub fn parse_expr(src: &str) -> Result<Expr, ParseError> {
    let toks = lex(src)?;
    let mut p = Parser { toks: &toks, pos: 0 };
    if matches!(p.peek(), Tok::Eof) {
        return Err(ParseError { span: (0, p.span().1), message: "empty expression".into(), hint: None });
    }
    let e = p.expr()?;
    match p.peek() {
        Tok::Eof => Ok(e),
        Tok::Assign => Err(p.error_here("unexpected '='", Some("use '==' to compare"))),
        Tok::Arrow => Err(p.error_here("unexpected '=>'", Some("lambdas can only be passed to calls, like map(xs, x => x + 1)"))),
        t => {
            let msg = format!("unexpected {} after the end of the expression", t.describe());
            Err(p.error_here(&msg, None))
        }
    }
}

type PResult<T> = Result<T, ParseError>;

struct Parser<'a> {
    toks: &'a [Token],
    pos: usize,
}

fn mk(kind: ExprKind, span: Span) -> Expr {
    Expr { kind, span }
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &'a Tok {
        &self.toks[self.pos].tok
    }
    fn peek_at(&self, k: usize) -> &'a Tok {
        let i = (self.pos + k).min(self.toks.len() - 1);
        &self.toks[i].tok
    }
    fn span(&self) -> Span {
        self.toks[self.pos].span
    }
    fn bump(&mut self) -> &'a Token {
        let t = &self.toks[self.pos];
        if self.pos + 1 < self.toks.len() {
            self.pos += 1;
        }
        t
    }
    fn error_here(&self, message: &str, hint: Option<&str>) -> ParseError {
        ParseError { span: self.span(), message: message.to_string(), hint: hint.map(|s| s.to_string()) }
    }
    fn expected(&self, what: &str) -> ParseError {
        let found = self.peek();
        let hint = match found {
            Tok::Assign => Some("use '==' to compare"),
            _ => None,
        };
        self.error_here(&format!("expected {what}, found {}", found.describe()), hint)
    }
    fn eat(&mut self, t: &Tok) -> bool {
        if self.peek() == t {
            self.bump();
            true
        } else {
            false
        }
    }
    fn expect_close(&mut self, close: Tok, open_span: Span, open: &str) -> PResult<Span> {
        if self.peek() == &close {
            return Ok(self.bump().span);
        }
        let found = self.peek().describe();
        Err(ParseError {
            span: self.span(),
            message: format!("expected '{}' to close '{}' at {}, found {}", close.symbol(), open, open_span.0, found),
            hint: None,
        })
    }

    fn expr(&mut self) -> PResult<Expr> {
        match self.peek() {
            Tok::Ident(_) if self.peek_at(1) == &Tok::Arrow => self.lambda(),
            Tok::LParen if self.is_lambda_params() => self.lambda(),
            Tok::Let => self.let_expr(),
            Tok::If => self.if_expr(),
            _ => self.or(),
        }
    }

    /// `(` IDENT (`,` IDENT)* `)` `=>`
    fn is_lambda_params(&self) -> bool {
        let mut k = 1;
        loop {
            match self.peek_at(k) {
                Tok::Ident(_) => k += 1,
                _ => return false,
            }
            match self.peek_at(k) {
                Tok::Comma => k += 1,
                Tok::RParen => return self.peek_at(k + 1) == &Tok::Arrow,
                _ => return false,
            }
        }
    }

    fn lambda(&mut self) -> PResult<Expr> {
        let start = self.span().0;
        let mut params = Vec::new();
        if self.eat(&Tok::LParen) {
            loop {
                let t = self.bump();
                if let Tok::Ident(n) = &t.tok {
                    params.push((n.clone(), t.span));
                }
                if self.eat(&Tok::RParen) {
                    break;
                }
                self.bump(); // comma (validated by is_lambda_params)
            }
        } else {
            let t = self.bump();
            if let Tok::Ident(n) = &t.tok {
                params.push((n.clone(), t.span));
            }
        }
        self.bump(); // =>
        if matches!(self.peek(), Tok::Eof) {
            return Err(self.error_here("expected the lambda body after '=>'", None));
        }
        let body = self.expr()?;
        let end = body.span.1;
        Ok(mk(ExprKind::Lambda(params, Box::new(body)), (start, end)))
    }

    fn let_expr(&mut self) -> PResult<Expr> {
        let start = self.bump().span.0;
        let (name, nspan) = match self.peek() {
            Tok::Ident(n) => {
                let n = n.clone();
                (n, self.bump().span)
            }
            _ => return Err(self.expected("a name after 'let'")),
        };
        if !self.eat(&Tok::Assign) {
            if self.peek() == &Tok::EqEq {
                return Err(self.error_here("expected '=' after 'let name'", Some("write let x = value in body")));
            }
            return Err(self.expected(&format!("'=' after 'let {name}'")));
        }
        let value = self.expr()?;
        if !self.eat(&Tok::In) {
            let e = self.expected("'in' after the let value");
            return Err(ParseError { hint: Some("write let x = value in body".into()), ..e });
        }
        let body = self.expr()?;
        let end = body.span.1;
        Ok(mk(ExprKind::Let(name, nspan, Box::new(value), Box::new(body)), (start, end)))
    }

    fn if_expr(&mut self) -> PResult<Expr> {
        let start = self.bump().span.0;
        let cond = self.expr()?;
        if !self.eat(&Tok::Then) {
            let e = self.expected("'then'");
            return Err(ParseError { hint: Some("write if cond then a else b".into()), ..e });
        }
        let a = self.expr()?;
        if !self.eat(&Tok::Else) {
            let e = self.expected("'else'");
            return Err(ParseError { hint: Some("every if needs an else branch: if cond then a else b".into()), ..e });
        }
        let b = self.expr()?;
        let end = b.span.1;
        Ok(mk(ExprKind::If(Box::new(cond), Box::new(a), Box::new(b)), (start, end)))
    }

    fn or(&mut self) -> PResult<Expr> {
        let mut l = self.and()?;
        while self.eat(&Tok::Or) {
            let r = self.and()?;
            let span = (l.span.0, r.span.1);
            l = mk(ExprKind::Binary(BinOp::Or, Box::new(l), Box::new(r)), span);
        }
        Ok(l)
    }

    fn and(&mut self) -> PResult<Expr> {
        let mut l = self.not()?;
        while self.eat(&Tok::And) {
            let r = self.not()?;
            let span = (l.span.0, r.span.1);
            l = mk(ExprKind::Binary(BinOp::And, Box::new(l), Box::new(r)), span);
        }
        Ok(l)
    }

    fn not(&mut self) -> PResult<Expr> {
        if self.peek() == &Tok::Not {
            let start = self.bump().span.0;
            let e = self.not()?;
            let end = e.span.1;
            return Ok(mk(ExprKind::Unary(UnOp::Not, Box::new(e)), (start, end)));
        }
        self.cmp()
    }

    fn cmp_op(&self) -> Option<BinOp> {
        Some(match self.peek() {
            Tok::EqEq => BinOp::Eq,
            Tok::Ne => BinOp::Ne,
            Tok::Lt => BinOp::Lt,
            Tok::Le => BinOp::Le,
            Tok::Gt => BinOp::Gt,
            Tok::Ge => BinOp::Ge,
            _ => return None,
        })
    }

    fn cmp(&mut self) -> PResult<Expr> {
        let l = self.sum()?;
        if let Some(op) = self.cmp_op() {
            self.bump();
            let r = self.sum()?;
            if self.cmp_op().is_some() {
                return Err(self.error_here(
                    "comparisons can't be chained",
                    Some("combine them with 'and', like a < b and b < c"),
                ));
            }
            let span = (l.span.0, r.span.1);
            return Ok(mk(ExprKind::Binary(op, Box::new(l), Box::new(r)), span));
        }
        if self.peek() == &Tok::Assign {
            return Err(self.error_here("unexpected '='", Some("use '==' to compare")));
        }
        Ok(l)
    }

    fn sum(&mut self) -> PResult<Expr> {
        let mut l = self.prod()?;
        loop {
            let op = match self.peek() {
                Tok::Plus => BinOp::Add,
                Tok::Minus => BinOp::Sub,
                _ => return Ok(l),
            };
            self.bump();
            let r = self.prod()?;
            let span = (l.span.0, r.span.1);
            l = mk(ExprKind::Binary(op, Box::new(l), Box::new(r)), span);
        }
    }

    fn prod(&mut self) -> PResult<Expr> {
        let mut l = self.unary()?;
        loop {
            let op = match self.peek() {
                Tok::Star => BinOp::Mul,
                Tok::Slash => BinOp::Div,
                Tok::Percent => BinOp::Mod,
                _ => return Ok(l),
            };
            self.bump();
            let r = self.unary()?;
            let span = (l.span.0, r.span.1);
            l = mk(ExprKind::Binary(op, Box::new(l), Box::new(r)), span);
        }
    }

    fn unary(&mut self) -> PResult<Expr> {
        if self.peek() == &Tok::Minus {
            let start = self.bump().span.0;
            let e = self.unary()?;
            let span = (start, e.span.1);
            // Fold negative numeric literals.
            return Ok(match e.kind {
                ExprKind::Int(n) => mk(ExprKind::Int(n.wrapping_neg()), span),
                ExprKind::Float(f) => mk(ExprKind::Float(-f), span),
                ExprKind::Duration(d) => mk(ExprKind::Duration(-d), span),
                kind => mk(ExprKind::Unary(UnOp::Neg, Box::new(Expr { kind, span: e.span })), span),
            });
        }
        self.postfix()
    }

    fn postfix(&mut self) -> PResult<Expr> {
        let mut e = self.atom()?;
        loop {
            match self.peek() {
                Tok::Dot => {
                    self.bump();
                    let t = self.bump();
                    let name = match &t.tok {
                        Tok::Ident(n) => n.clone(),
                        other => {
                            return Err(ParseError {
                                span: t.span,
                                message: format!("expected a field name after '.', found {}", other.describe()),
                                hint: None,
                            })
                        }
                    };
                    let span = (e.span.0, t.span.1);
                    e = mk(ExprKind::Field(Box::new(e), name, t.span), span);
                }
                Tok::LBrack => {
                    let open = self.bump().span;
                    let idx = self.expr()?;
                    let close = self.expect_close(Tok::RBrack, open, "[")?;
                    let span = (e.span.0, close.1);
                    e = mk(ExprKind::Index(Box::new(e), Box::new(idx)), span);
                }
                Tok::LParen => {
                    let open = self.span();
                    let (name, nspan) = match &e.kind {
                        ExprKind::Ident(n) => (n.clone(), e.span),
                        _ => {
                            return Err(ParseError {
                                span: open,
                                message: "only named functions can be called".into(),
                                hint: Some("call a function or builtin by name, like len(xs)".into()),
                            })
                        }
                    };
                    self.bump();
                    let (args, close) = self.args(Tok::RParen, open, "(")?;
                    e = mk(ExprKind::Call(name, nspan, args), (nspan.0, close.1));
                }
                _ => return Ok(e),
            }
        }
    }

    /// Comma-separated expressions up to `close` (trailing comma allowed).
    fn args(&mut self, close: Tok, open: Span, open_sym: &str) -> PResult<(Vec<Expr>, Span)> {
        let mut out = Vec::new();
        loop {
            if self.peek() == &close {
                return Ok((out, self.bump().span));
            }
            if self.peek() == &Tok::Eof {
                return Err(ParseError {
                    span: self.span(),
                    message: format!("expected '{}' to close '{}' at {}, found the end of the expression", close.symbol(), open_sym, open.0),
                    hint: None,
                });
            }
            out.push(self.expr()?);
            if !self.eat(&Tok::Comma) {
                let s = self.expect_close(close, open, open_sym)?;
                return Ok((out, s));
            }
        }
    }

    fn atom(&mut self) -> PResult<Expr> {
        let t = self.bump();
        let span = t.span;
        Ok(match &t.tok {
            Tok::Int(n) => mk(ExprKind::Int(*n), span),
            Tok::Float(f) => mk(ExprKind::Float(*f), span),
            Tok::Dur(d) => mk(ExprKind::Duration(*d), span),
            Tok::Str(s) => mk(ExprKind::Str(s.clone()), span),
            Tok::True => mk(ExprKind::Bool(true), span),
            Tok::False => mk(ExprKind::Bool(false), span),
            Tok::None => mk(ExprKind::None, span),
            Tok::Ident(n) => mk(ExprKind::Ident(n.clone()), span),
            Tok::Token(n) => mk(ExprKind::Token(n.clone()), span),
            Tok::LBrack => {
                let (items, close) = self.args(Tok::RBrack, span, "[")?;
                mk(ExprKind::List(items), (span.0, close.1))
            }
            Tok::LBrace => self.record(span)?,
            Tok::LParen => {
                let inner = self.expr()?;
                let close = self.expect_close(Tok::RParen, span, "(")?;
                // Keep the inner node but widen its span to include the parens.
                Expr { kind: inner.kind, span: (span.0, close.1) }
            }
            Tok::Eof => {
                return Err(ParseError { span, message: "unexpected end of expression".into(), hint: None });
            }
            other => {
                self.pos -= 1;
                let hint = match other {
                    Tok::Assign => Some("use '==' to compare"),
                    Tok::Arrow => Some("lambdas look like x => x + 1 or (a, b) => a + b"),
                    _ => None,
                };
                return Err(ParseError {
                    span,
                    message: format!("expected an expression, found {}", other.describe()),
                    hint: hint.map(|s| s.to_string()),
                });
            }
        })
    }

    fn record(&mut self, open: Span) -> PResult<Expr> {
        let mut items = Vec::new();
        loop {
            if self.peek() == &Tok::RBrace {
                let close = self.bump().span;
                return Ok(mk(ExprKind::Record(items), (open.0, close.1)));
            }
            if self.peek() == &Tok::Ellipsis {
                self.bump();
                let e = self.expr()?;
                items.push(RecordItem::Spread(e));
            } else {
                let t = self.bump();
                let name: Rc<str> = match &t.tok {
                    Tok::Ident(n) => n.clone(),
                    Tok::Str(s) => s.clone(),
                    Tok::Eof => {
                        return Err(ParseError {
                            span: t.span,
                            message: format!("expected '}}' to close '{{' at {}, found the end of the expression", open.0),
                            hint: None,
                        })
                    }
                    other => {
                        return Err(ParseError {
                            span: t.span,
                            message: format!("expected a field name, found {}", other.describe()),
                            hint: Some("records look like {x: 1, y: 2} or {...rec, y: 3}".into()),
                        })
                    }
                };
                let nspan = t.span;
                if !self.eat(&Tok::Colon) {
                    let e = self.expected(&format!("':' after field '{name}'"));
                    return Err(ParseError { hint: Some("records look like {x: 1, y: 2}".into()), ..e });
                }
                let e = self.expr()?;
                items.push(RecordItem::Field(name, nspan, e));
            }
            if !self.eat(&Tok::Comma) {
                let close = self.expect_close(Tok::RBrace, open, "{")?;
                return Ok(mk(ExprKind::Record(items), (open.0, close.1)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compact S-expression printer for tests.
    fn sx(e: &Expr) -> String {
        match &e.kind {
            ExprKind::Int(n) => n.to_string(),
            ExprKind::Float(f) => format!("{f:?}"),
            ExprKind::Duration(d) => format!("{d}ms"),
            ExprKind::Bool(b) => b.to_string(),
            ExprKind::Str(s) => format!("'{s}'"),
            ExprKind::None => "none".into(),
            ExprKind::Ident(n) => n.to_string(),
            ExprKind::Token(n) => format!("${n}"),
            ExprKind::Field(b, n, _) => format!("(. {} {n})", sx(b)),
            ExprKind::Index(b, i) => format!("([] {} {})", sx(b), sx(i)),
            ExprKind::Call(n, _, a) => format!("({n}{})", a.iter().map(|x| format!(" {}", sx(x))).collect::<String>()),
            ExprKind::Unary(UnOp::Neg, x) => format!("(neg {})", sx(x)),
            ExprKind::Unary(UnOp::Not, x) => format!("(not {})", sx(x)),
            ExprKind::Binary(op, a, b) => format!("({} {} {})", op.symbol(), sx(a), sx(b)),
            ExprKind::If(c, a, b) => format!("(if {} {} {})", sx(c), sx(a), sx(b)),
            ExprKind::Let(n, _, v, b) => format!("(let {n} {} {})", sx(v), sx(b)),
            ExprKind::Lambda(ps, b) => {
                format!("(fn [{}] {})", ps.iter().map(|p| p.0.to_string()).collect::<Vec<_>>().join(" "), sx(b))
            }
            ExprKind::List(items) => format!("[{}]", items.iter().map(sx).collect::<Vec<_>>().join(" ")),
            ExprKind::Record(items) => format!(
                "{{{}}}",
                items
                    .iter()
                    .map(|i| match i {
                        RecordItem::Field(n, _, e) => format!("{n}: {}", sx(e)),
                        RecordItem::Spread(e) => format!("...{}", sx(e)),
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }

    fn p(s: &str) -> String {
        sx(&parse_expr(s).unwrap_or_else(|e| panic!("parse {s:?}: {e:?}")))
    }
    fn perr(s: &str) -> ParseError {
        parse_expr(s).expect_err(s)
    }

    #[test]
    fn precedence() {
        assert_eq!(p("1 + 2 * 3"), "(+ 1 (* 2 3))");
        assert_eq!(p("1 - 2 - 3"), "(- (- 1 2) 3)");
        assert_eq!(p("not a == b"), "(not (== a b))");
        assert_eq!(p("not a and b"), "(and (not a) b)");
        assert_eq!(p("a or b and c"), "(or a (and b c))");
        assert_eq!(p("a < b + 1"), "(< a (+ b 1))");
        assert_eq!(p("-x.y"), "(neg (. x y))");
        assert_eq!(p("-3"), "-3");
        assert_eq!(p("a % 2 == 0"), "(== (% a 2) 0)");
        assert_eq!(p("(1 + 2) * 3"), "(* (+ 1 2) 3)");
        assert_eq!(p("not not a"), "(not (not a))");
    }

    #[test]
    fn postfix_and_calls() {
        assert_eq!(p("snake[0] + dir"), "(+ ([] snake 0) dir)");
        assert_eq!(p("a.b.c[1].d"), "(. ([] (. (. a b) c) 1) d)");
        assert_eq!(p("len(snake) - 1"), "(- (len snake) 1)");
        assert_eq!(p("f()"), "(f)");
        assert_eq!(p("merge_line(map(l, c => b[c])).cells"), "(. (merge_line (map l (fn [c] ([] b c)))) cells)");
        assert_eq!(p("$tiles[2]"), "([] $tiles 2)");
        assert_eq!(p("[1, 2, 3,]"), "[1 2 3]");
    }

    #[test]
    fn literals() {
        assert_eq!(p("150ms"), "150ms");
        assert_eq!(p("2s"), "2000ms");
        assert_eq!(p("1.5s"), "1500ms");
        assert_eq!(p("0.5"), "0.5");
        assert_eq!(p("1e3"), "1000.0");
        assert_eq!(p(r"'it\'s'"), "'it's'");
        assert_eq!(p(r"'a\\b'"), r"'a\b'");
        assert_eq!(p("\"dq\""), "'dq'");
        assert_eq!(p("none"), "none");
        assert_eq!(p("{x: 1, y: true}"), "{x: 1, y: true}");
        assert_eq!(p("{...m, y: m.y + 1}"), "{...m, y: (+ (. m y) 1)}");
        assert_eq!(p("[]"), "[]");
    }

    #[test]
    fn lambdas_let_if() {
        assert_eq!(p("x => x + 1"), "(fn [x] (+ x 1))");
        assert_eq!(p("(acc, v) => acc + v"), "(fn [acc v] (+ acc v))");
        assert_eq!(p("(a) => a"), "(fn [a] a)");
        // Parenthesized expression, not lambda params.
        assert_eq!(p("(a) + 1"), "(+ a 1)");
        assert!(perr("(a, b)").message.contains("expected ')' to close '(' at 0"));
        assert_eq!(p("(x) => (x)"), "(fn [x] x)");
        assert_eq!(p("let x = 1 in x + 2"), "(let x 1 (+ x 2))");
        assert_eq!(p("if a then 1 else if b then 2 else 3"), "(if a 1 (if b 2 3))");
        assert_eq!(
            p("grid_map(b, (v, p) => if p == c or contains(neighbors4(p), c) then not v else v)"),
            "(grid_map b (fn [v p] (if (or (== p c) (contains (neighbors4 p) c)) (not v) v)))"
        );
        assert_eq!(p("fold(xs, 0, (a, x) => a + x)"), "(fold xs 0 (fn [a x] (+ a x)))");
    }

    #[test]
    fn spans() {
        let e = parse_expr("score + r.gained * 2").unwrap();
        assert_eq!(e.span, (0, 20));
        let ExprKind::Binary(_, l, r) = &e.kind else { panic!() };
        assert_eq!(l.span, (0, 5));
        assert_eq!(r.span, (8, 20));
        let ExprKind::Binary(_, rl, _) = &r.kind else { panic!() };
        let ExprKind::Field(_, _, fs) = &rl.kind else { panic!() };
        assert_eq!(*fs, (10, 16));
        let e = parse_expr("len(snake)").unwrap();
        let ExprKind::Call(_, ns, _) = &e.kind else { panic!() };
        assert_eq!(*ns, (0, 3));
        assert_eq!(e.span, (0, 10));
        // Spans are chars, not bytes.
        let e = parse_expr("'héé' + x").unwrap();
        let ExprKind::Binary(_, _, r) = &e.kind else { panic!() };
        assert_eq!(r.span, (8, 9));
    }

    #[test]
    fn errors() {
        let e = perr("f(1, 2");
        assert!(e.message.contains("expected ')' to close '(' at 1"), "{}", e.message);
        let e = perr("(1 + 2");
        assert_eq!(e.message, "expected ')' to close '(' at 0, found the end of the expression");
        let e = perr("a = b");
        assert_eq!(e.hint.as_deref(), Some("use '==' to compare"));
        assert_eq!(e.span, (2, 3));
        let e = perr("a && b");
        assert_eq!(e.hint.as_deref(), Some("use 'and'"));
        let e = perr("if a then b");
        assert!(e.message.contains("expected 'else'"), "{}", e.message);
        let e = perr("a < b < c");
        assert!(e.message.contains("chained"));
        let e = perr("'abc");
        assert!(e.message.contains("unterminated string"));
        let e = perr("1 2");
        assert!(e.message.contains("after the end"), "{}", e.message);
        assert_eq!(e.span, (2, 3));
        let e = perr("(a + b)(c)");
        assert!(e.message.contains("only named functions"));
        let e = perr("3x");
        assert!(e.message.contains("unexpected 'x'"));
        let e = perr("1.5ms");
        assert!(e.message.contains("whole number"));
        let e = perr("");
        assert_eq!(e.message, "empty expression");
        let e = perr("a +");
        assert_eq!(e.message, "unexpected end of expression");
        let e = perr("{x 1}");
        assert!(e.message.contains("':' after field 'x'"));
        let e = perr("!a");
        assert_eq!(e.hint.as_deref(), Some("use 'not' for negation"));
        let e = perr("[1, 2");
        assert!(e.message.contains("expected ']' to close '[' at 0"));
    }
}
