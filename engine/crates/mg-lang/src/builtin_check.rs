//! Typing of builtin calls, following the doc comments in
//! `mg_core::builtins` exactly.

use std::rc::Rc;

use mg_core::ast::{self, ExprKind, Span};
use mg_core::builtins::Builtin;
use mg_core::diag::Code;
use mg_core::ir::Expr as IR;
use mg_core::types::Type;

use crate::check::{is_str, join, placeholder, to_float, tyname, Checker};

type B = Builtin;

impl Checker {
    fn arity(&mut self, b: Builtin, args: &[ast::Expr], lo: usize, hi: usize, nspan: Span) -> bool {
        let n = args.len();
        if n >= lo && n <= hi {
            return true;
        }
        let want = if lo == hi {
            format!("{lo} argument{}", if lo == 1 { "" } else { "s" })
        } else if hi == usize::MAX {
            format!("at least {lo} arguments")
        } else {
            format!("{lo} or {hi} arguments")
        };
        let mut msg = format!("{} takes {want}, found {n}", b.name());
        if matches!(b, B::Min | B::Max) && n == 1 {
            msg.push_str("; for a list use fold(xs, xs[0], (a, x) => ...)");
        }
        self.err(Code::TypeMismatch, nspan, msg);
        for a in args {
            if !matches!(a.kind, ExprKind::Lambda(..)) {
                self.check(a, None);
            }
        }
        false
    }

    fn arg_err(&mut self, b: Builtin, i: usize, want: &str, found: &Type, span: Span) {
        let hint = if matches!(found, Type::Option(_)) {
            Some("use or_else(x, default) first".to_string())
        } else {
            None
        };
        let msg = format!("{} expects {want} as argument {}, found {}", b.name(), i + 1, tyname(found));
        self.err_h(Code::TypeMismatch, span, msg, hint);
    }

    /// Element type of a list argument (Unknown after an error).
    fn list_elem(&mut self, b: Builtin, i: usize, t: &Type, span: Span) -> Type {
        match t {
            Type::List(e) => (**e).clone(),
            Type::Unknown => Type::Unknown,
            _ => {
                self.arg_err(b, i, "a list", t, span);
                Type::Unknown
            }
        }
    }

    fn grid_elem(&mut self, b: Builtin, i: usize, t: &Type, span: Span) -> Type {
        match t {
            Type::Grid(e) => (**e).clone(),
            Type::Unknown => Type::Unknown,
            _ => {
                self.arg_err(b, i, "a grid", t, span);
                Type::Unknown
            }
        }
    }

    fn want_vec(&mut self, b: Builtin, i: usize, t: &Type, span: Span) {
        if !matches!(t, Type::IVec2 | Type::Vec2 | Type::Unknown) {
            self.arg_err(b, i, "an ivec2 or vec2", t, span);
        }
    }

    /// Numeric arguments: when any is a float, ints are widened. Returns the
    /// result kind (int, float, or unknown).
    fn nums(&mut self, b: Builtin, items: Vec<(IR, Type)>, args: &[&ast::Expr], first: usize) -> (Vec<IR>, Type) {
        let any_float = items.iter().any(|(_, t)| *t == Type::Float);
        let mut all_int = true;
        let mut out = Vec::with_capacity(items.len());
        for (k, (ir, t)) in items.into_iter().enumerate() {
            match t {
                Type::Int => out.push(if any_float { to_float(ir) } else { ir }),
                Type::Float => {
                    all_int = false;
                    out.push(ir)
                }
                Type::Unknown => {
                    all_int = false;
                    out.push(ir)
                }
                t => {
                    all_int = false;
                    self.arg_err(b, first + k, "a number", &t, args[k].span);
                    out.push(ir)
                }
            }
        }
        let t = if any_float {
            Type::Float
        } else if all_int {
            Type::Int
        } else {
            Type::Unknown
        };
        (out, t)
    }

    fn num_args(&mut self, b: Builtin, args: &[ast::Expr], exp: Option<&Type>) -> (Vec<IR>, Type) {
        let e = exp.filter(|t| **t == Type::Float);
        let items: Vec<(IR, Type)> = args.iter().map(|a| self.check(a, e)).collect();
        let refs: Vec<&ast::Expr> = args.iter().collect();
        self.nums(b, items, &refs, 0)
    }

    /// One numeric arg widened to float.
    fn float_arg(&mut self, b: Builtin, i: usize, a: &ast::Expr) -> IR {
        let (ir, t) = self.check(a, None);
        match t {
            Type::Int => to_float(ir),
            Type::Float | Type::Unknown => ir,
            t => {
                self.arg_err(b, i, "a number", &t, a.span);
                ir
            }
        }
    }

    /// One string argument (enums count as strings).
    fn str_arg(&mut self, b: Builtin, i: usize, a: &ast::Expr) -> IR {
        let (ir, t) = self.check(a, None);
        if !is_str(&t) && !t.is_unknown() {
            self.arg_err(b, i, "a string", &t, a.span);
        }
        ir
    }

    fn mk(b: Builtin, args: Vec<IR>) -> IR {
        IR::Builtin(b, args.into_boxed_slice())
    }

    pub fn builtin(
        &mut self,
        b: Builtin,
        nspan: Span,
        args: &[ast::Expr],
        exp: Option<&Type>,
        span: Span,
    ) -> (IR, Type) {
        let _ = span;
        // Lambdas are only legal at the builtin's lambda argument.
        let lam = b.lambda_arg();
        for (i, a) in args.iter().enumerate() {
            if matches!(a.kind, ExprKind::Lambda(..)) && lam != Some(i) {
                self.err(
                    Code::BadLambda,
                    a.span,
                    format!("{} doesn't take a lambda as argument {}", b.name(), i + 1),
                );
                return (placeholder(), Type::Unknown);
            }
        }
        let exp_inner = match exp {
            Some(Type::Option(t)) => Some(&**t),
            x => x,
        };
        use Type::*;
        let (lo, hi) = match b {
            B::Min | B::Max | B::Concat => (2, usize::MAX),
            B::Range => (1, 2),
            B::Abs | B::Floor | B::Ceil | B::Round | B::Sqrt | B::Log2 | B::Sin | B::Cos | B::Hash | B::Len
            | B::First | B::Last | B::Reverse | B::Sum | B::SetOf | B::MapOf | B::Keys | B::Values | B::Width
            | B::Height | B::Cells | B::Neighbors4 | B::Neighbors8 | B::Length | B::Normalize | B::Chars
            | B::Upper | B::Lower | B::Str | B::InDictionary | B::IsNone | B::Pick | B::Shuffle | B::Trim
            | B::ParseInt | B::Sign | B::Angle | B::FromAngle | B::MinOf | B::MaxOf | B::Chance => (1, 1),
            B::Clamp | B::Lerp | B::GetOr | B::Slice | B::SetAt | B::InsertAt | B::Fold | B::Put | B::Grid
            | B::WriteLine | B::InBounds | B::Substr | B::Replace => (3, 3),
            B::OverlapsCircle | B::OverlapsRect => (4, 4),
            _ => (2, 2),
        };
        if !self.arity(b, args, lo, hi, nspan) {
            return (placeholder(), Unknown);
        }
        let a = args;
        match b {
            // ── v0.2: text ──
            B::Trim => {
                let i0 = self.str_arg(b, 0, &a[0]);
                (Self::mk(b, vec![i0]), Str)
            }
            B::ParseInt => {
                let i0 = self.str_arg(b, 0, &a[0]);
                (Self::mk(b, vec![i0]), Type::option(Int))
            }
            B::Split | B::StartsWith | B::EndsWith | B::Replace => {
                let irs: Vec<IR> = a.iter().enumerate().map(|(k, x)| self.str_arg(b, k, x)).collect();
                let rt = match b {
                    B::Split => Type::list(Str),
                    B::Replace => Str,
                    _ => Bool,
                };
                (Self::mk(b, irs), rt)
            }
            B::Substr => {
                let i0 = self.str_arg(b, 0, &a[0]);
                let (i1, _) = self.check(&a[1], Some(&Int));
                let (i2, _) = self.check(&a[2], Some(&Int));
                (Self::mk(b, vec![i0, i1, i2]), Str)
            }

            // ── v0.2: math and space ──
            B::Sign => {
                let (i, t) = self.check(&a[0], exp.filter(|t| t.is_numeric()));
                if !matches!(t, Int | Float | Unknown) {
                    self.arg_err(b, 0, "a number", &t, a[0].span);
                }
                (Self::mk(b, vec![i]), t)
            }
            B::Atan2 | B::Pow | B::Fmod => {
                let i0 = self.float_arg(b, 0, &a[0]);
                let i1 = self.float_arg(b, 1, &a[1]);
                (Self::mk(b, vec![i0, i1]), Float)
            }
            B::FromAngle => {
                let i0 = self.float_arg(b, 0, &a[0]);
                (Self::mk(b, vec![i0]), Vec2)
            }
            B::Chance => {
                let i0 = self.float_arg(b, 0, &a[0]);
                (Self::mk(b, vec![i0]), Bool)
            }
            B::Angle => {
                let (i0, t0) = self.check(&a[0], None);
                self.want_vec(b, 0, &t0, a[0].span);
                (Self::mk(b, vec![i0]), Float)
            }
            B::Rotate => {
                let (i0, t0) = self.check(&a[0], None);
                self.want_vec(b, 0, &t0, a[0].span);
                let i1 = self.float_arg(b, 1, &a[1]);
                (Self::mk(b, vec![i0, i1]), Vec2)
            }
            B::MinOf | B::MaxOf => {
                let le = exp_inner.filter(|t| t.is_numeric()).map(|t| Type::list(t.clone()));
                let (i0, t0) = self.check(&a[0], le.as_ref());
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let rt = match el {
                    Int | Float | Unknown => el,
                    t => {
                        self.arg_err(b, 0, "a list of numbers", &Type::list(t), a[0].span);
                        Unknown
                    }
                };
                (Self::mk(b, vec![i0]), rt)
            }

            // ── Math ──
            B::Abs => {
                let (i, t) = self.check(&a[0], exp);
                if !matches!(t, Int | Float | Unknown) {
                    self.arg_err(b, 0, "a number", &t, a[0].span);
                }
                (Self::mk(b, vec![i]), t)
            }
            B::Min | B::Max | B::Clamp => {
                let (irs, t) = self.num_args(b, a, exp);
                (Self::mk(b, irs), t)
            }
            B::Floor | B::Ceil | B::Round => {
                let (i, t) = self.check(&a[0], None);
                if !matches!(t, Int | Float | Unknown) {
                    self.arg_err(b, 0, "a number", &t, a[0].span);
                }
                (Self::mk(b, vec![i]), Int)
            }
            B::Sqrt | B::Log2 | B::Sin | B::Cos => {
                let i = self.float_arg(b, 0, &a[0]);
                (Self::mk(b, vec![i]), Float)
            }
            B::Lerp => {
                let (i0, t0) = self.check(&a[0], None);
                if matches!(t0, Vec2) {
                    let (i1, _) = self.check(&a[1], Some(&Vec2));
                    let i2 = self.float_arg(b, 2, &a[2]);
                    return (Self::mk(b, vec![i0, i1, i2]), Vec2);
                }
                let i0 = match t0 {
                    Int => to_float(i0),
                    Float | Unknown => i0,
                    t => {
                        self.arg_err(b, 0, "a number or vec2", &t, a[0].span);
                        i0
                    }
                };
                let i1 = self.float_arg(b, 1, &a[1]);
                let i2 = self.float_arg(b, 2, &a[2]);
                (Self::mk(b, vec![i0, i1, i2]), Float)
            }
            B::Hash => {
                let (i, _) = self.check(&a[0], None);
                (Self::mk(b, vec![i]), Float)
            }

            // ── Lists ──
            B::Len => {
                let (i, t) = self.check(&a[0], None);
                if !matches!(t, List(_) | Set(_) | Map(..) | Str | Enum(_) | Unknown) {
                    let hint = if matches!(t, Grid(_)) { Some("use width(g) and height(g)".to_string()) } else { None };
                    let msg = format!("len expects a list, set, map or string, found {}", tyname(&t));
                    self.err_h(Code::TypeMismatch, a[0].span, msg, hint);
                }
                (Self::mk(b, vec![i]), Int)
            }
            B::First | B::Last | B::Pick => {
                let (i, t) = self.check(&a[0], None);
                let el = self.list_elem(b, 0, &t, a[0].span);
                (Self::mk(b, vec![i]), el)
            }
            B::GetOr => {
                let (i0, t0) = self.check(&a[0], None);
                let (key, val) = match &t0 {
                    List(t) => (Int, (**t).clone()),
                    Grid(t) => (IVec2, (**t).clone()),
                    Map(k, v) => ((**k).clone(), (**v).clone()),
                    Unknown => (Unknown, Unknown),
                    t => {
                        self.arg_err(b, 0, "a list, map or grid", t, a[0].span);
                        (Unknown, Unknown)
                    }
                };
                let (i1, _) = self.check(&a[1], Some(&key));
                let val_exp = if val.is_unknown() { exp } else { Some(&val) };
                let (i2, t2) = self.check(&a[2], val_exp);
                let rt = if val.is_unknown() { t2 } else { val };
                (Self::mk(b, vec![i0, i1, i2]), rt)
            }
            B::Slice | B::Take | B::Drop | B::RemoveAt | B::Shuffle => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, List(_))));
                self.list_elem(b, 0, &t0, a[0].span);
                let mut irs = vec![i0];
                for x in &a[1..] {
                    irs.push(self.check(x, Some(&Int)).0);
                }
                (Self::mk(b, irs), t0)
            }
            B::Concat => {
                let refs: Vec<&ast::Expr> = a.iter().collect();
                let e = exp.filter(|t| matches!(t, List(_) | Str));
                let (irs, t) = self.unify(&refs, e, "concat arguments");
                if !matches!(t, List(_) | Str | Unknown) && !matches!(t, Enum(_)) {
                    let msg = format!("concat expects lists or strings, found {}", tyname(&t));
                    self.err(Code::TypeMismatch, a[0].span, msg);
                }
                let t = if matches!(t, Enum(_)) { Str } else { t };
                (Self::mk(b, irs), t)
            }
            B::Push | B::SetAt | B::InsertAt => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, List(_))));
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let mut irs = vec![i0];
                if b != B::Push {
                    irs.push(self.check(&a[1], Some(&Int)).0);
                }
                let item = a.last().unwrap();
                let rt = if el.is_unknown() && !matches!(t0, Unknown) {
                    // `push([], x)`: the item decides the element type.
                    let (ii, it) = self.check(item, None);
                    irs.push(ii);
                    Type::list(it)
                } else {
                    let (ii, it) = self.check(item, Some(&el));
                    irs.push(ii);
                    if el.is_unknown() {
                        Unknown
                    } else {
                        Type::list(join(&el, &it).unwrap_or(el))
                    }
                };
                (Self::mk(b, irs), rt)
            }
            B::Reverse => {
                let (i, t) = self.check(&a[0], exp);
                if !matches!(t, List(_) | Str | Unknown) {
                    self.arg_err(b, 0, "a list or string", &t, a[0].span);
                }
                (Self::mk(b, vec![i]), t)
            }
            B::Repeat => {
                let ee = match exp_inner {
                    Some(List(t)) => Some((**t).clone()),
                    _ => None,
                };
                let (i0, t0) = self.check(&a[0], ee.as_ref());
                let (i1, _) = self.check(&a[1], Some(&Int));
                (Self::mk(b, vec![i0, i1]), Type::list(t0))
            }
            B::Range => {
                let irs: Vec<IR> = a.iter().map(|x| self.check(x, Some(&Int)).0).collect();
                (Self::mk(b, irs), Type::list(Int))
            }
            B::IndexOf => {
                let (i0, t0) = self.check(&a[0], None);
                if is_str(&t0) {
                    let i1 = self.str_arg(b, 1, &a[1]);
                    return (Self::mk(b, vec![i0, i1]), Int);
                }
                let el = match &t0 {
                    List(t) => (**t).clone(),
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a list or string", t, a[0].span);
                        Unknown
                    }
                };
                let (i1, _) = self.check(&a[1], Some(&el));
                (Self::mk(b, vec![i0, i1]), Int)
            }
            B::Contains => {
                let (i0, t0) = self.check(&a[0], None);
                let el = match &t0 {
                    List(t) | Set(t) => (**t).clone(),
                    t if is_str(t) => Str,
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a list, set or string", t, a[0].span);
                        Unknown
                    }
                };
                let (i1, _) = self.check(&a[1], Some(&el));
                (Self::mk(b, vec![i0, i1]), Bool)
            }

            // ── Higher-order ──
            B::Map => {
                let (i0, t0) = self.check(&a[0], None);
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let ret = match exp_inner {
                    Some(List(t)) => Some((**t).clone()),
                    _ => None,
                };
                let (li, bt) = self.lambda(&a[1], std::slice::from_ref(&el), Some(&[el.clone(), Int]), ret.as_ref(), "map");
                (Self::mk(b, vec![i0, li]), Type::list(bt))
            }
            B::Filter => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, List(_))));
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let (li, _) = self.lambda(&a[1], std::slice::from_ref(&el), Some(&[el.clone(), Int]), Some(&Bool), "filter");
                (Self::mk(b, vec![i0, li]), t0)
            }
            B::Any | B::All | B::Count | B::Find => {
                let (i0, t0) = self.check(&a[0], None);
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let (li, _) = self.lambda(&a[1], std::slice::from_ref(&el), None, Some(&Bool), b.name());
                let rt = match b {
                    B::Count => Int,
                    B::Find => Type::option(el),
                    _ => Bool,
                };
                (Self::mk(b, vec![i0, li]), rt)
            }
            B::SortBy => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, List(_))));
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let (li, _) = self.lambda(&a[1], &[el], None, None, "sort_by");
                (Self::mk(b, vec![i0, li]), t0)
            }
            B::Fold => {
                let (i0, t0) = self.check(&a[0], None);
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let (i1, it) = self.check(&a[1], exp);
                let snap_slot = self.r().next_slot;
                let snap_diag = self.diags.len();
                let (li, bt) = self.lambda(&a[2], &[it.clone(), el.clone()], None, Some(&it), "fold");
                let acc = join(&it, &bt).unwrap_or_else(|| it.clone());
                if acc != it {
                    // The body refined the accumulator type (e.g. `out: []`
                    // became `list<int>`, or int widened to float): re-check
                    // the lambda and the initial value with it.
                    self.root().next_slot = snap_slot;
                    if self.mute == 0 {
                        self.diags.truncate(snap_diag);
                    }
                    let (li2, _) = self.lambda(&a[2], &[acc.clone(), el], None, Some(&acc), "fold");
                    self.mute += 1;
                    let (i1b, _) = self.check(&a[1], Some(&acc));
                    self.mute -= 1;
                    return (Self::mk(b, vec![i0, i1b, li2]), acc);
                }
                (Self::mk(b, vec![i0, i1, li]), acc)
            }
            B::Sum => {
                let (i0, t0) = self.check(&a[0], None);
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let rt = match el {
                    Int | Float | Unknown => el,
                    t => {
                        self.arg_err(b, 0, "a list of numbers", &Type::list(t), a[0].span);
                        Unknown
                    }
                };
                (Self::mk(b, vec![i0]), rt)
            }
            B::Zip => {
                let (i0, t0) = self.check(&a[0], None);
                let e0 = self.list_elem(b, 0, &t0, a[0].span);
                let (i1, t1) = self.check(&a[1], None);
                let e1 = self.list_elem(b, 1, &t1, a[1].span);
                let rt = Type::list(Type::record(vec![(Rc::from("a"), e0), (Rc::from("b"), e1)]));
                (Self::mk(b, vec![i0, i1]), rt)
            }

            // ── Sets and maps ──
            B::SetOf => {
                let le = match exp_inner {
                    Some(Set(t)) => Some(Type::List(t.clone())),
                    _ => None,
                };
                let (i0, t0) = self.check(&a[0], le.as_ref());
                let el = self.list_elem(b, 0, &t0, a[0].span);
                (Self::mk(b, vec![i0]), Type::set(el))
            }
            B::Add => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, Set(_))));
                let el = match &t0 {
                    Set(t) => (**t).clone(),
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a set", t, a[0].span);
                        Unknown
                    }
                };
                let (i1, t1) = self.check(&a[1], Some(&el));
                let rt = if el.is_unknown() && matches!(t0, Set(_)) { Type::set(t1) } else { t0 };
                (Self::mk(b, vec![i0, i1]), rt)
            }
            B::Remove | B::Has => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, Set(_) | Map(..))));
                let key = match &t0 {
                    Set(t) => (**t).clone(),
                    Map(k, _) => (**k).clone(),
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a set or map", t, a[0].span);
                        Unknown
                    }
                };
                let (i1, _) = self.check(&a[1], Some(&key));
                let rt = if b == B::Has { Bool } else { t0 };
                (Self::mk(b, vec![i0, i1]), rt)
            }
            B::MapOf => self.map_of(&a[0], exp_inner),
            B::Put => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, Map(..))));
                let (k, v) = match &t0 {
                    Map(k, v) => ((**k).clone(), (**v).clone()),
                    Unknown => (Unknown, Unknown),
                    t => {
                        self.arg_err(b, 0, "a map", t, a[0].span);
                        (Unknown, Unknown)
                    }
                };
                let (i1, t1) = self.check(&a[1], Some(&k));
                let (i2, t2) = self.check(&a[2], Some(&v));
                let rt = match &t0 {
                    Map(..) => Type::map(join(&k, &t1).unwrap_or(k), join(&v, &t2).unwrap_or(v)),
                    t => t.clone(),
                };
                (Self::mk(b, vec![i0, i1, i2]), rt)
            }
            B::Keys => {
                let (i0, t0) = self.check(&a[0], None);
                let rt = match &t0 {
                    Map(k, _) => Type::List(k.clone()),
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a map", t, a[0].span);
                        Unknown
                    }
                };
                (Self::mk(b, vec![i0]), rt)
            }
            B::Values => {
                let (i0, t0) = self.check(&a[0], None);
                let rt = match &t0 {
                    Map(_, v) => Type::List(v.clone()),
                    Grid(t) => Type::List(t.clone()),
                    Unknown => Unknown,
                    t => {
                        self.arg_err(b, 0, "a map or grid", t, a[0].span);
                        Unknown
                    }
                };
                (Self::mk(b, vec![i0]), rt)
            }

            // ── Grids ──
            B::Grid => {
                let ee = match exp_inner {
                    Some(Grid(t)) => Some((**t).clone()),
                    _ => None,
                };
                let (i0, _) = self.check(&a[0], Some(&Int));
                let (i1, _) = self.check(&a[1], Some(&Int));
                let (i2, t2) = self.check(&a[2], ee.as_ref());
                (Self::mk(b, vec![i0, i1, i2]), Type::grid(t2))
            }
            B::Width | B::Height | B::Cells => {
                let (i0, t0) = self.check(&a[0], None);
                self.grid_elem(b, 0, &t0, a[0].span);
                let rt = if b == B::Cells { Type::list(IVec2) } else { Int };
                (Self::mk(b, vec![i0]), rt)
            }
            B::InGrid => {
                let (i0, t0) = self.check(&a[0], None);
                self.grid_elem(b, 0, &t0, a[0].span);
                let (i1, _) = self.check(&a[1], Some(&IVec2));
                (Self::mk(b, vec![i0, i1]), Bool)
            }
            B::GridMap => {
                let (i0, t0) = self.check(&a[0], None);
                let el = self.grid_elem(b, 0, &t0, a[0].span);
                let ret = match exp_inner {
                    Some(Grid(t)) => Some((**t).clone()),
                    _ => None,
                };
                let (li, bt) = self.lambda(&a[1], std::slice::from_ref(&el), Some(&[el.clone(), IVec2]), ret.as_ref(), "grid_map");
                (Self::mk(b, vec![i0, li]), Type::grid(bt))
            }
            B::Neighbors4 | B::Neighbors8 => {
                let (i0, _) = self.check(&a[0], Some(&IVec2));
                (Self::mk(b, vec![i0]), Type::list(IVec2))
            }
            B::Lines => {
                let (i0, t0) = self.check(&a[0], None);
                self.grid_elem(b, 0, &t0, a[0].span);
                let (i1, _) = self.check(&a[1], Some(&IVec2));
                (Self::mk(b, vec![i0, i1]), Type::list(Type::list(IVec2)))
            }
            B::WriteLine => {
                let (i0, t0) = self.check(&a[0], exp.filter(|t| matches!(t, Grid(_))));
                let el = self.grid_elem(b, 0, &t0, a[0].span);
                let (i1, _) = self.check(&a[1], Some(&Type::list(IVec2)));
                let (i2, _) = self.check(&a[2], Some(&Type::list(el)));
                (Self::mk(b, vec![i0, i1, i2]), t0)
            }

            // ── Space ──
            B::Vec => {
                let want_float = exp_inner == Some(&Vec2);
                let e = if want_float { Some(&Float) } else { None };
                let (i0, t0) = self.check(&a[0], e);
                let (i1, t1) = self.check(&a[1], e);
                let refs: Vec<&ast::Expr> = a.iter().collect();
                let (irs, t) = self.nums(b, vec![(i0, t0), (i1, t1)], &refs, 0);
                let rt = match t {
                    Int => IVec2,
                    Float => Vec2,
                    _ => Unknown,
                };
                (Self::mk(b, irs), rt)
            }
            B::Length | B::Normalize => {
                let (i0, t0) = self.check(&a[0], None);
                self.want_vec(b, 0, &t0, a[0].span);
                (Self::mk(b, vec![i0]), if b == B::Length { Float } else { Vec2 })
            }
            B::Dist => {
                let (i0, t0) = self.check(&a[0], None);
                self.want_vec(b, 0, &t0, a[0].span);
                let (i1, t1) = self.check(&a[1], None);
                self.want_vec(b, 1, &t1, a[1].span);
                (Self::mk(b, vec![i0, i1]), Float)
            }
            B::InBounds => {
                let (i0, t0) = self.check(&a[0], None);
                self.want_vec(b, 0, &t0, a[0].span);
                let items = vec![self.check(&a[1], None), self.check(&a[2], None)];
                let refs: Vec<&ast::Expr> = a[1..].iter().collect();
                let (mut irs, _) = self.nums(b, items, &refs, 1);
                irs.insert(0, i0);
                (Self::mk(b, irs), Bool)
            }
            B::Coords => {
                let (i0, _) = self.check(&a[0], Some(&Int));
                let (i1, _) = self.check(&a[1], Some(&Int));
                (Self::mk(b, vec![i0, i1]), Type::list(IVec2))
            }
            B::OverlapsCircle => {
                let (p1, t1) = self.check(&a[0], None);
                self.want_vec(b, 0, &t1, a[0].span);
                let (p2, t2) = self.check(&a[2], None);
                self.want_vec(b, 2, &t2, a[2].span);
                let items = vec![self.check(&a[1], None), self.check(&a[3], None)];
                let refs = vec![&a[1], &a[3]];
                let (r, _) = self.nums(b, items, &refs, 1);
                let mut r = r.into_iter();
                let (r1, r2) = (r.next().unwrap(), r.next().unwrap());
                (Self::mk(b, vec![p1, r1, p2, r2]), Bool)
            }
            B::OverlapsRect => {
                let mut irs = Vec::with_capacity(4);
                for (k, x) in a.iter().enumerate() {
                    let (i, t) = self.check(x, None);
                    self.want_vec(b, k, &t, x.span);
                    irs.push(i);
                }
                (Self::mk(b, irs), Bool)
            }

            // ── Text ──
            B::Chars | B::Upper | B::Lower | B::InDictionary => {
                let (i0, t0) = self.check(&a[0], None);
                if !is_str(&t0) && !t0.is_unknown() {
                    self.arg_err(b, 0, "a string", &t0, a[0].span);
                }
                let rt = match b {
                    B::Chars => Type::list(Str),
                    B::InDictionary => Bool,
                    _ => Str,
                };
                (Self::mk(b, vec![i0]), rt)
            }
            B::Join => {
                let (i0, _) = self.check(&a[0], Some(&Type::list(Str)));
                let (i1, _) = self.check(&a[1], Some(&Str));
                (Self::mk(b, vec![i0, i1]), Str)
            }
            B::Str => {
                let (i0, _) = self.check(&a[0], None);
                (Self::mk(b, vec![i0]), Str)
            }

            // ── Options ──
            B::IsNone => {
                let (i0, _) = self.check(&a[0], None);
                (Self::mk(b, vec![i0]), Bool)
            }
            B::OrElse => {
                let (i0, t0) = self.check(&a[0], exp.map(|t| Type::option(t.clone())).as_ref());
                let inner = match &t0 {
                    Option(t) => (**t).clone(),
                    t => t.clone(),
                };
                if inner.is_unknown() {
                    let (i1, t1) = self.check(&a[1], exp);
                    return (Self::mk(b, vec![i0, i1]), t1);
                }
                // The default must have the optional's inner type (an int
                // default widens to float, never the other way round).
                let (i1, _) = self.check(&a[1], Some(&inner));
                (Self::mk(b, vec![i0, i1]), inner)
            }

            // ── Random ──
            B::RandomInt => {
                let (i0, _) = self.check(&a[0], Some(&Int));
                let (i1, _) = self.check(&a[1], Some(&Int));
                (Self::mk(b, vec![i0, i1]), Int)
            }
            B::RandomFloat => {
                let i0 = self.float_arg(b, 0, &a[0]);
                let i1 = self.float_arg(b, 1, &a[1]);
                (Self::mk(b, vec![i0, i1]), Float)
            }
            B::Weighted => {
                let le = exp_inner.map(|t| Type::list(t.clone()));
                let (i0, t0) = self.check(&a[0], le.as_ref());
                let el = self.list_elem(b, 0, &t0, a[0].span);
                let (i1, t1) = self.check(&a[1], None);
                let we = self.list_elem(b, 1, &t1, a[1].span);
                if !matches!(we, Int | Float | Unknown) {
                    self.arg_err(b, 1, "a list of numbers", &t1, a[1].span);
                }
                (Self::mk(b, vec![i0, i1]), el)
            }
        }
    }

    /// `map_of([[k, v], ...])`: a list literal of 2-item list literals is
    /// typed as key/value pairs even though K and V differ.
    fn map_of(&mut self, arg: &ast::Expr, exp: Option<&Type>) -> (IR, Type) {
        let (ke, ve) = match exp {
            Some(Type::Map(k, v)) => (Some((**k).clone()), Some((**v).clone())),
            _ => (None, None),
        };
        if let ExprKind::List(pairs) = &arg.kind {
            let mut keys = Vec::with_capacity(pairs.len());
            let mut vals = Vec::with_capacity(pairs.len());
            let mut ok = true;
            for p in pairs {
                match &p.kind {
                    ExprKind::List(kv) if kv.len() == 2 => {
                        keys.push(&kv[0]);
                        vals.push(&kv[1]);
                    }
                    _ => {
                        self.check(p, None);
                        self.err(Code::TypeMismatch, p.span, "map_of expects [key, value] pairs, like map_of([['a', 1]])");
                        ok = false;
                    }
                }
            }
            if !ok {
                return (placeholder(), Type::Unknown);
            }
            let (kirs, kt) = self.unify(&keys, ke.as_ref(), "map keys");
            let (virs, vt) = self.unify(&vals, ve.as_ref(), "map values");
            let pair_irs: Vec<IR> =
                kirs.into_iter().zip(virs).map(|(k, v)| IR::List(vec![k, v].into_boxed_slice())).collect();
            let list = IR::List(pair_irs.into_boxed_slice());
            return (IR::Builtin(Builtin::MapOf, vec![list].into_boxed_slice()), Type::map(kt, vt));
        }
        // Any other argument must be a list of 2-item lists of one type.
        let (i0, t0) = self.check(arg, None);
        let rt = match &t0 {
            Type::List(inner) => match &**inner {
                Type::List(t) => Type::Map(t.clone(), t.clone()),
                Type::Unknown => Type::map(Type::Unknown, Type::Unknown),
                _ => {
                    self.err(Code::TypeMismatch, arg.span, format!("map_of expects a list of [key, value] pairs, found {}", tyname(&t0)));
                    Type::Unknown
                }
            },
            Type::Unknown => Type::Unknown,
            _ => {
                self.err(Code::TypeMismatch, arg.span, format!("map_of expects a list of [key, value] pairs, found {}", tyname(&t0)));
                Type::Unknown
            }
        };
        (IR::Builtin(Builtin::MapOf, vec![i0].into_boxed_slice()), rt)
    }
}
