//! Tokenizer for expression strings. Spans are `char` offsets.

use std::rc::Rc;

use crate::parser::ParseError;

#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    Int(i64),
    Float(f64),
    Dur(i64),
    Str(Rc<str>),
    Ident(Rc<str>),
    Token(Rc<str>),
    Let,
    In,
    If,
    Then,
    Else,
    True,
    False,
    None,
    Not,
    And,
    Or,
    LParen,
    RParen,
    LBrack,
    RBrack,
    LBrace,
    RBrace,
    Comma,
    Dot,
    Colon,
    Ellipsis,
    Arrow,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    EqEq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Assign,
    Eof,
}

impl Tok {
    pub fn describe(&self) -> String {
        match self {
            Tok::Int(n) => format!("number {n}"),
            Tok::Float(f) => format!("number {f}"),
            Tok::Dur(ms) => format!("duration {ms}ms"),
            Tok::Str(s) => format!("string '{s}'"),
            Tok::Ident(s) => format!("'{s}'"),
            Tok::Token(s) => format!("'${s}'"),
            Tok::Eof => "the end of the expression".to_string(),
            t => format!("'{}'", t.symbol()),
        }
    }

    pub fn symbol(&self) -> &'static str {
        match self {
            Tok::Let => "let",
            Tok::In => "in",
            Tok::If => "if",
            Tok::Then => "then",
            Tok::Else => "else",
            Tok::True => "true",
            Tok::False => "false",
            Tok::None => "none",
            Tok::Not => "not",
            Tok::And => "and",
            Tok::Or => "or",
            Tok::LParen => "(",
            Tok::RParen => ")",
            Tok::LBrack => "[",
            Tok::RBrack => "]",
            Tok::LBrace => "{",
            Tok::RBrace => "}",
            Tok::Comma => ",",
            Tok::Dot => ".",
            Tok::Colon => ":",
            Tok::Ellipsis => "...",
            Tok::Arrow => "=>",
            Tok::Plus => "+",
            Tok::Minus => "-",
            Tok::Star => "*",
            Tok::Slash => "/",
            Tok::Percent => "%",
            Tok::EqEq => "==",
            Tok::Ne => "!=",
            Tok::Lt => "<",
            Tok::Le => "<=",
            Tok::Gt => ">",
            Tok::Ge => ">=",
            Tok::Assign => "=",
            _ => "?",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Token {
    pub tok: Tok,
    pub span: (u32, u32),
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}
fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn err(start: usize, end: usize, message: impl Into<String>, hint: Option<&str>) -> ParseError {
    ParseError { span: (start as u32, end as u32), message: message.into(), hint: hint.map(|h| h.to_string()) }
}

pub fn keyword(s: &str) -> Option<Tok> {
    Some(match s {
        "let" => Tok::Let,
        "in" => Tok::In,
        "if" => Tok::If,
        "then" => Tok::Then,
        "else" => Tok::Else,
        "true" => Tok::True,
        "false" => Tok::False,
        "none" => Tok::None,
        "not" => Tok::Not,
        "and" => Tok::And,
        "or" => Tok::Or,
        _ => return None,
    })
}

pub fn lex(src: &str) -> Result<Vec<Token>, ParseError> {
    let cs: Vec<char> = src.chars().collect();
    let n = cs.len();
    let mut out = Vec::with_capacity(n / 2 + 1);
    let mut i = 0;
    while i < n {
        let c = cs[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let push = |out: &mut Vec<Token>, tok: Tok, end: usize| out.push(Token { tok, span: (start as u32, end as u32) });
        if c.is_ascii_digit() {
            i = lex_number(&cs, i, &mut out)?;
            continue;
        }
        if is_ident_start(c) {
            while i < n && is_ident_char(cs[i]) {
                i += 1;
            }
            let s: String = cs[start..i].iter().collect();
            let tok = keyword(&s).unwrap_or_else(|| Tok::Ident(Rc::from(s.as_str())));
            push(&mut out, tok, i);
            continue;
        }
        if c == '$' {
            i += 1;
            if i >= n || !is_ident_start(cs[i]) {
                return Err(err(start, i, "expected a token name after '$'", Some("tokens look like $bg or $tiles[2]")));
            }
            while i < n && is_ident_char(cs[i]) {
                i += 1;
            }
            let s: String = cs[start + 1..i].iter().collect();
            push(&mut out, Tok::Token(Rc::from(s.as_str())), i);
            continue;
        }
        if c == '\'' || c == '"' {
            let quote = c;
            i += 1;
            let mut s = String::new();
            loop {
                if i >= n {
                    return Err(err(
                        start,
                        n,
                        format!("unterminated string starting at {start}"),
                        Some("close the string with a matching quote"),
                    ));
                }
                let d = cs[i];
                if d == quote {
                    i += 1;
                    break;
                }
                if d == '\\' {
                    if i + 1 >= n {
                        return Err(err(i, n, "unfinished escape at the end of the string", None));
                    }
                    let e = cs[i + 1];
                    s.push(match e {
                        'n' => '\n',
                        't' => '\t',
                        '\\' | '\'' | '"' => e,
                        _ => {
                            return Err(err(
                                i,
                                i + 2,
                                format!("unknown escape '\\{e}'"),
                                Some("supported escapes: \\' \\\" \\\\ \\n \\t"),
                            ))
                        }
                    });
                    i += 2;
                    continue;
                }
                s.push(d);
                i += 1;
            }
            push(&mut out, Tok::Str(Rc::from(s.as_str())), i);
            continue;
        }
        let next = if i + 1 < n { cs[i + 1] } else { '\0' };
        let (tok, len) = match c {
            '(' => (Tok::LParen, 1),
            ')' => (Tok::RParen, 1),
            '[' => (Tok::LBrack, 1),
            ']' => (Tok::RBrack, 1),
            '{' => (Tok::LBrace, 1),
            '}' => (Tok::RBrace, 1),
            ',' => (Tok::Comma, 1),
            ':' => (Tok::Colon, 1),
            '+' => (Tok::Plus, 1),
            '-' => (Tok::Minus, 1),
            '*' => (Tok::Star, 1),
            '/' => (Tok::Slash, 1),
            '%' => (Tok::Percent, 1),
            '.' => {
                if next == '.' && i + 2 < n && cs[i + 2] == '.' {
                    (Tok::Ellipsis, 3)
                } else {
                    (Tok::Dot, 1)
                }
            }
            '=' => match next {
                '=' => (Tok::EqEq, 2),
                '>' => (Tok::Arrow, 2),
                _ => (Tok::Assign, 1),
            },
            '!' => {
                if next == '=' {
                    (Tok::Ne, 2)
                } else {
                    return Err(err(i, i + 1, "unexpected '!'", Some("use 'not' for negation")));
                }
            }
            '<' => {
                if next == '=' {
                    (Tok::Le, 2)
                } else {
                    (Tok::Lt, 1)
                }
            }
            '>' => {
                if next == '=' {
                    (Tok::Ge, 2)
                } else {
                    (Tok::Gt, 1)
                }
            }
            '&' => {
                let l = if next == '&' { 2 } else { 1 };
                return Err(err(i, i + l, "unexpected '&'", Some("use 'and'")));
            }
            '|' => {
                let l = if next == '|' { 2 } else { 1 };
                return Err(err(i, i + l, "unexpected '|'", Some("use 'or'")));
            }
            '?' => {
                return Err(err(i, i + 1, "unexpected '?'", Some("use 'if c then a else b' for conditions")));
            }
            _ => return Err(err(i, i + 1, format!("unexpected character '{c}'"), None)),
        };
        i += len;
        push(&mut out, tok, i);
    }
    out.push(Token { tok: Tok::Eof, span: (n as u32, n as u32) });
    Ok(out)
}

/// Numbers: `12`, `1.5`, `1e3`, durations `150ms`, `2s`, `1.5s`.
fn lex_number(cs: &[char], start: usize, out: &mut Vec<Token>) -> Result<usize, ParseError> {
    let n = cs.len();
    let mut i = start;
    while i < n && cs[i].is_ascii_digit() {
        i += 1;
    }
    let mut is_float = false;
    if i + 1 < n && cs[i] == '.' && cs[i + 1].is_ascii_digit() {
        is_float = true;
        i += 1;
        while i < n && cs[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i < n && (cs[i] == 'e' || cs[i] == 'E') {
        let mut j = i + 1;
        if j < n && (cs[j] == '+' || cs[j] == '-') {
            j += 1;
        }
        if j < n && cs[j].is_ascii_digit() {
            is_float = true;
            while j < n && cs[j].is_ascii_digit() {
                j += 1;
            }
            i = j;
        }
    }
    let text: String = cs[start..i].iter().collect();
    // Duration suffix.
    let suffix_end = {
        let mut j = i;
        while j < n && is_ident_char(cs[j]) {
            j += 1;
        }
        j
    };
    let suffix: String = cs[i..suffix_end].iter().collect();
    let mult = match suffix.as_str() {
        "" => None,
        "ms" => Some(1.0),
        "s" => Some(1000.0),
        _ => {
            return Err(err(
                start,
                suffix_end,
                format!("unexpected '{suffix}' after number {text}"),
                Some("durations are written like 150ms or 2s"),
            ))
        }
    };
    let span = (start as u32, suffix_end as u32);
    let tok = match mult {
        Some(m) => {
            let v: f64 = text.parse().map_err(|_| err(start, suffix_end, "invalid number", None))?;
            let ms = v * m;
            if (ms - ms.round()).abs() > 1e-9 {
                return Err(err(start, suffix_end, format!("duration {text}{suffix} is not a whole number of milliseconds"), None));
            }
            if !ms.is_finite() || ms.abs() > 9.0e15 {
                return Err(err(start, suffix_end, "duration is too large", None));
            }
            Tok::Dur(ms.round() as i64)
        }
        None if is_float => {
            let v: f64 = text.parse().map_err(|_| err(start, i, "invalid number", None))?;
            Tok::Float(v)
        }
        None => {
            let v: i64 = text.parse().map_err(|_| err(start, i, format!("number {text} is too large"), None))?;
            Tok::Int(v)
        }
    };
    out.push(Token { tok, span });
    Ok(suffix_end)
}
