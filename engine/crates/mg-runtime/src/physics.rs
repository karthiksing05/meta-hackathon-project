//! v0.2 arcade physics (`engine/SPEC-v0.2.md` §5).
//!
//! Runs once per `step`, after timers and before `tick`, as one atomic
//! pseudo-rule. It works in three phases so it can never leave state half
//! written:
//! 1. **Gather** every body of every group into a flat `Body` array. Bad
//!    state (not a record, a missing or non-float field, NaN) is an error.
//! 2. **Simulate** on the flat array:
//!    * Velocity: `v += gravity * scale * dt`, then clamp to `max_speed`
//!      (once per step, for non-static bodies with a velocity field).
//!    * `n` sub-steps (1..=`MAX_PHYSICS_SUBSTEPS`), the smallest count with
//!      which no moving body travels more than half its smallest size
//!      (`r`, or `min(w, h) / 2`) per sub-step. Each sub-step: move every
//!      moving body by `v * dt / n`; clamp `bounded` bodies to `bounds`
//!      (velocity into the edge is multiplied by `-bounce`); run the
//!      collision rules in file order, pairs in index order (`i < j` when
//!      `a == b`), pushing `solid` pairs apart. Rules with more than 32×32
//!      candidate pairs use sort-and-sweep on x and visit the candidates in
//!      sweep order (deterministic); that only changes the order of `solid`
//!      pushes, never the emit order.
//!    * Contacts are recorded once per step per `(rule, i, j)`, with the
//!      normal of the first sub-step that saw them.
//! 3. **Write back** changed `x y vx vy` fields (`Rc::make_mut`, in place
//!    when uniquely owned) and return the emitted events in a fixed order:
//!    `on_bounds` entries in file order, then collision rules in file order;
//!    within each, by body index pair.
//!
//! Only IEEE `+ - * /` and `sqrt` are used, so results are bit-identical on
//! every platform.

use std::rc::Rc;

use mg_core::ir::{BodyGroup, BodyShape, ContactField, EventId, FieldIdx, Physics, PhysicsEmit, Program};
use mg_core::limits::MAX_PHYSICS_SUBSTEPS;
use mg_core::types::Type;
use mg_core::Value;

use crate::eval::{limit_err, rt_err, R};

/// Narrow-phase pair tests per step before physics gives up (`E_LIMIT`).
const MAX_PAIR_TESTS: u64 = 4_000_000;
/// Recorded contacts (with an emit) per step before physics gives up.
const MAX_CONTACTS: usize = 65_536;
/// Rule pairs with more candidates than this use sort-and-sweep on x.
const BRUTE_FORCE_PAIRS: usize = 32 * 32;

#[cfg(test)]
thread_local! {
    /// Tests: always use the brute-force pair loop.
    pub(crate) static FORCE_BRUTE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[inline]
fn brute_force(pairs: usize) -> bool {
    #[cfg(test)]
    if FORCE_BRUTE.with(|f| f.get()) {
        return true;
    }
    pairs <= BRUTE_FORCE_PAIRS
}

#[derive(Clone, Copy, Debug, Default)]
struct Body {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    /// Half extents. A circle has `hw == hh == r`.
    hw: f64,
    hh: f64,
    circle: bool,
    /// Not static: clamped to bounds and pushed by solid contacts.
    dynamic: bool,
    /// Dynamic with a velocity field: integrated.
    moves: bool,
    /// Which velocity fields the record has; a missing one stays 0.
    has_vx: bool,
    has_vy: bool,
}

/// `((rule order, i, j), (nx, ny))`.
type Contact = ((u32, u32, u32), (f64, f64));

/// Reusable buffers (kept in `Game` so a step does not allocate).
#[derive(Default, Clone)]
pub(crate) struct Scratch {
    bodies: Vec<Body>,
    orig: Vec<[f64; 4]>,
    /// `start[g]..start[g + 1]` are group `g`'s bodies.
    start: Vec<usize>,
    /// Edge normal touched in the current sub-step, per body.
    touched: Vec<(f64, f64)>,
    /// `((rule order, i, j), normal)` for rules that emit. Bounds rules come
    /// first. Sorted (stable) and deduplicated after the last sub-step, so
    /// each contact keeps the normal of its first sub-step.
    contacts: Vec<Contact>,
    /// `(sort key, min x, max x)`.
    sweep: Vec<(u128, f64, f64)>,
    pairs: Vec<(u32, u32)>,
}

/// Runs one physics step on `state`. On error nothing has been written.
/// Returns whether any state changed; emitted events go to `events`.
pub(crate) fn step(
    prog: &Program,
    ph: &Physics,
    state: &mut [Value],
    dt_s: f64,
    sc: &mut Scratch,
    events: &mut Vec<(EventId, Rc<[Value]>)>,
) -> R<bool> {
    gather(prog, ph, state, sc)?;
    simulate(ph, dt_s, sc)?;
    let changed = write_back(ph, state, sc);
    emit(ph, sc, events);
    Ok(changed)
}

// ───────────────────────────── gather ─────────────────────────────

fn gather(prog: &Program, ph: &Physics, state: &[Value], sc: &mut Scratch) -> R<()> {
    sc.bodies.clear();
    sc.orig.clear();
    sc.start.clear();
    for g in &ph.bodies {
        sc.start.push(sc.bodies.len());
        let v = state.get(g.state as usize).ok_or_else(|| rt_err(format!("group '{}': no such state", g.name)))?;
        match (g.is_list, v) {
            (true, Value::List(items)) => {
                for (i, r) in items.iter().enumerate() {
                    let b = read_body(prog, g, r, i)?;
                    sc.orig.push([b.x, b.y, b.vx, b.vy]);
                    sc.bodies.push(b);
                }
            }
            (false, r @ Value::Record(_)) => {
                let b = read_body(prog, g, r, 0)?;
                sc.orig.push([b.x, b.y, b.vx, b.vy]);
                sc.bodies.push(b);
            }
            (_, v) => {
                let want = if g.is_list { "a list of records" } else { "a record" };
                return Err(rt_err(format!("group '{}': state is {}, expected {want}", g.name, crate::eval::kind(v))));
            }
        }
    }
    sc.start.push(sc.bodies.len());
    Ok(())
}

#[cold]
fn field_name(prog: &Program, g: &BodyGroup, f: FieldIdx) -> String {
    let ty = prog.state.get(g.state as usize).map(|s| &s.ty);
    let rt = match ty {
        Some(Type::Record(r)) => Some(r),
        Some(Type::List(t)) => match &**t {
            Type::Record(r) => Some(r),
            _ => None,
        },
        _ => None,
    };
    rt.and_then(|r| r.fields.get(f as usize)).map_or_else(|| format!("#{f}"), |(n, _)| n.to_string())
}

#[cold]
#[inline(never)]
fn body_err(prog: &Program, g: &BodyGroup, i: usize, f: FieldIdx, what: &str) -> Box<crate::eval::RtErr> {
    let at = if g.is_list { format!("{}[{i}]", g.name) } else { g.name.to_string() };
    rt_err(format!("body {at}: field '{}' {what}", field_name(prog, g, f)))
}

/// A position or velocity field: must be a finite float.
#[inline]
fn pos_field(prog: &Program, g: &BodyGroup, fields: &[Value], i: usize, f: FieldIdx) -> R<f64> {
    match fields.get(f as usize) {
        Some(Value::Float(x)) if x.is_finite() => Ok(*x),
        Some(Value::Float(_)) => Err(body_err(prog, g, i, f, "is not a finite number")),
        Some(v) => Err(body_err(prog, g, i, f, &format!("is {}, expected float", crate::eval::kind(v)))),
        None => Err(body_err(prog, g, i, f, "is missing")),
    }
}

/// A size field: a non-NaN number (int tolerated). Negative counts as 0.
#[inline]
fn size_field(prog: &Program, g: &BodyGroup, fields: &[Value], i: usize, f: FieldIdx) -> R<f64> {
    let x = match fields.get(f as usize) {
        Some(Value::Float(x)) => *x,
        Some(Value::Int(x)) => *x as f64,
        Some(v) => return Err(body_err(prog, g, i, f, &format!("is {}, expected float", crate::eval::kind(v)))),
        None => return Err(body_err(prog, g, i, f, "is missing")),
    };
    if x.is_nan() {
        return Err(body_err(prog, g, i, f, "is NaN"));
    }
    Ok(x.max(0.0))
}

fn read_body(prog: &Program, g: &BodyGroup, r: &Value, i: usize) -> R<Body> {
    let Value::Record(fields) = r else {
        let at = if g.is_list { format!("{}[{i}]", g.name) } else { g.name.to_string() };
        return Err(rt_err(format!("body {at} is {}, expected a record", crate::eval::kind(r))));
    };
    let x = pos_field(prog, g, fields, i, g.x)?;
    let y = pos_field(prog, g, fields, i, g.y)?;
    let vx = match g.vx {
        Some(f) => pos_field(prog, g, fields, i, f)?,
        None => 0.0,
    };
    let vy = match g.vy {
        Some(f) => pos_field(prog, g, fields, i, f)?,
        None => 0.0,
    };
    let (hw, hh, circle) = match g.shape {
        BodyShape::Circle { r } => {
            let r = size_field(prog, g, fields, i, r)?;
            (r, r, true)
        }
        BodyShape::Rect { w, h } => {
            (size_field(prog, g, fields, i, w)? * 0.5, size_field(prog, g, fields, i, h)? * 0.5, false)
        }
    };
    let dynamic = !g.is_static;
    let moves = dynamic && (g.vx.is_some() || g.vy.is_some());
    Ok(Body { x, y, vx, vy, hw, hh, circle, dynamic, moves, has_vx: g.vx.is_some(), has_vy: g.vy.is_some() })
}

// ───────────────────────────── simulate ─────────────────────────────

fn simulate(ph: &Physics, dt: f64, sc: &mut Scratch) -> R<()> {
    let (gx, gy) = ph.gravity;

    // Velocity, once per step.
    let mut n_sub: u32 = 1;
    for (gi, g) in ph.bodies.iter().enumerate() {
        let (ax, ay) = (gx * g.gravity_scale * dt, gy * g.gravity_scale * dt);
        let max2 = g.max_speed.map(|m| {
            let m = m.max(0.0);
            (m, m * m)
        });
        for b in &mut sc.bodies[sc.start[gi]..sc.start[gi + 1]] {
            if !b.moves {
                continue;
            }
            if g.vx.is_some() {
                b.vx += ax;
            }
            if g.vy.is_some() {
                b.vy += ay;
            }
            if let Some((m, m2)) = max2 {
                let s2 = b.vx * b.vx + b.vy * b.vy;
                if s2 > m2 {
                    let k = m / s2.sqrt();
                    b.vx *= k;
                    b.vy *= k;
                }
            }
            // Sub-steps: travel per sub-step <= half the smallest size.
            let half = b.hw.min(b.hh);
            if half > 0.0 && n_sub < MAX_PHYSICS_SUBSTEPS {
                let travel = b.vx.abs().max(b.vy.abs()) * dt;
                let need = (travel / half).ceil();
                if need > n_sub as f64 {
                    n_sub = if need >= MAX_PHYSICS_SUBSTEPS as f64 { MAX_PHYSICS_SUBSTEPS } else { need as u32 };
                }
            }
        }
    }

    sc.contacts.clear();
    let h = dt / n_sub as f64;
    let n_bounds = ph.on_bounds.len() as u32;
    let mut budget = MAX_PAIR_TESTS;
    for _ in 0..n_sub {
        for b in sc.bodies.iter_mut() {
            if b.moves {
                b.x += b.vx * h;
                b.y += b.vy * h;
            }
        }
        if let Some(bounds) = ph.bounds {
            clamp_bounds(ph, bounds, sc);
        }
        for (ci, rule) in ph.collisions.iter().enumerate() {
            let (ga, gb) = (rule.a as usize, rule.b as usize);
            let (Some(&sa), Some(&sb)) = (sc.start.get(ga), sc.start.get(gb)) else { continue };
            let na = sc.start[ga + 1] - sa;
            let nb = sc.start[gb + 1] - sb;
            let same = ga == gb;
            // mg-lang resolves the default (the larger group bounce).
            let e = rule.bounce;
            let order = n_bounds + ci as u32;
            let emit = rule.emit.is_some();

            let tests = if same { (na * na.saturating_sub(1) / 2) as u64 } else { (na * nb) as u64 };
            let test_pair = |sc: &mut Scratch, i: usize, j: usize| {
                let (ia, ib) = (sa + i, sb + j);
                if ia == ib {
                    return;
                }
                let Some((nx, ny, pen)) = contact(&sc.bodies[ia], &sc.bodies[ib]) else { return };
                if rule.solid {
                    resolve(&mut sc.bodies, ia, ib, nx, ny, pen, e);
                }
                if emit {
                    sc.contacts.push(((order, i as u32, j as u32), (nx, ny)));
                }
            };
            if brute_force(na * nb) {
                budget = budget.checked_sub(tests).ok_or_else(too_many)?;
                for i in 0..na {
                    let j0 = if same { i + 1 } else { 0 };
                    for j in j0..nb {
                        test_pair(sc, i, j);
                    }
                }
            } else {
                sweep_pairs(sc, sa, na, sb, nb, same);
                budget = budget.checked_sub(sc.pairs.len() as u64 + (na + nb) as u64).ok_or_else(too_many)?;
                let pairs = std::mem::take(&mut sc.pairs);
                for &(i, j) in &pairs {
                    test_pair(sc, i as usize, j as usize);
                }
                sc.pairs = pairs;
            }
        }
        if sc.contacts.len() > MAX_CONTACTS {
            return Err(limit_err(format!(
                "more than {MAX_CONTACTS} contacts with an emit in one step; use fewer bodies"
            )));
        }
    }
    // Emit order: index-pair order, whatever order the pairs were visited in.
    sc.contacts.sort_by_key(|c| c.0);
    sc.contacts.dedup_by_key(|c| c.0);
    Ok(())
}

#[cold]
fn too_many() -> Box<crate::eval::RtErr> {
    limit_err(format!("more than {MAX_PAIR_TESTS} collision tests in one step; use fewer bodies"))
}

/// Clamps bounded dynamic bodies and records which edge each touched.
fn clamp_bounds(ph: &Physics, (bx, by, bw, bh): (f64, f64, f64, f64), sc: &mut Scratch) {
    let track = !ph.on_bounds.is_empty();
    if track {
        sc.touched.clear();
        sc.touched.resize(sc.bodies.len(), (0.0, 0.0));
    }
    for (gi, g) in ph.bodies.iter().enumerate() {
        if !g.bounded || g.is_static {
            continue;
        }
        let e = g.bounce;
        for k in sc.start[gi]..sc.start[gi + 1] {
            let b = &mut sc.bodies[k];
            let (nx, vx) = clamp_axis(&mut b.x, b.vx, b.hw, bx, bw, e);
            let (ny, vy) = clamp_axis(&mut b.y, b.vy, b.hh, by, bh, e);
            b.vx = vx;
            b.vy = vy;
            if track && (nx != 0.0 || ny != 0.0) {
                sc.touched[k] = (nx, ny);
            }
        }
    }
    if !track {
        return;
    }
    for (ri, r) in ph.on_bounds.iter().enumerate() {
        let gi = r.body as usize;
        let Some(&s) = sc.start.get(gi) else { continue };
        for k in s..sc.start[gi + 1] {
            let n = sc.touched[k];
            if n != (0.0, 0.0) {
                sc.contacts.push(((ri as u32, (k - s) as u32, 0), n));
            }
        }
    }
}

/// Keeps `p ± half` inside `[lo, lo + size]`. Returns the inward normal of
/// the edge touched (0 if none) and the new velocity.
#[inline]
fn clamp_axis(p: &mut f64, v: f64, half: f64, lo: f64, size: f64, bounce: f64) -> (f64, f64) {
    let mut min = lo + half;
    let mut max = lo + size - half;
    if min > max {
        let mid = lo + size * 0.5;
        min = mid;
        max = mid;
    }
    if *p < min {
        *p = min;
        (1.0, if v < 0.0 { -bounce * v + 0.0 } else { v })
    } else if *p > max {
        *p = max;
        (-1.0, if v > 0.0 { -bounce * v + 0.0 } else { v })
    } else {
        (0.0, v)
    }
}

#[inline]
fn sgn(d: f64) -> f64 {
    if d > 0.0 {
        1.0
    } else {
        -1.0
    }
}

/// Overlap test. Returns the unit normal pointing from `b` toward `a` and
/// the penetration depth, or `None` (touching is not overlapping).
#[inline]
fn contact(a: &Body, b: &Body) -> Option<(f64, f64, f64)> {
    match (a.circle, b.circle) {
        (true, true) => {
            let (dx, dy) = (a.x - b.x, a.y - b.y);
            let rs = a.hw + b.hw;
            let d2 = dx * dx + dy * dy;
            if d2 >= rs * rs {
                return None;
            }
            let d = d2.sqrt();
            if d > 0.0 {
                Some((dx / d, dy / d, rs - d))
            } else {
                Some((0.0, -1.0, rs))
            }
        }
        (false, false) => {
            let dx = a.x - b.x;
            let ox = a.hw + b.hw - dx.abs();
            if ox <= 0.0 {
                return None;
            }
            let dy = a.y - b.y;
            let oy = a.hh + b.hh - dy.abs();
            if oy <= 0.0 {
                return None;
            }
            if ox < oy {
                Some((sgn(dx), 0.0, ox))
            } else {
                Some((0.0, sgn(dy), oy))
            }
        }
        (true, false) => circle_box(a, b),
        (false, true) => circle_box(b, a).map(|(nx, ny, p)| (-nx + 0.0, -ny + 0.0, p)),
    }
}

/// Circle `c` against box `b`; the normal points from the box toward the circle.
#[inline]
fn circle_box(c: &Body, b: &Body) -> Option<(f64, f64, f64)> {
    let (dx, dy) = (c.x - b.x, c.y - b.y);
    let r = c.hw;
    // Quick reject on each axis.
    if dx.abs() >= b.hw + r || dy.abs() >= b.hh + r {
        return None;
    }
    let px = dx.clamp(-b.hw, b.hw);
    let py = dy.clamp(-b.hh, b.hh);
    let (ex, ey) = (dx - px, dy - py);
    let d2 = ex * ex + ey * ey;
    if d2 > 0.0 {
        if d2 >= r * r {
            return None;
        }
        let d = d2.sqrt();
        return Some((ex / d, ey / d, r - d));
    }
    // Center inside the box: leave through the nearest face.
    let fx = b.hw - dx.abs();
    let fy = b.hh - dy.abs();
    if fx < fy {
        Some((sgn(dx), 0.0, r + fx))
    } else {
        Some((0.0, sgn(dy), r + fy))
    }
}

/// Pushes `a` and `b` apart along `n` (from b toward a) and reflects each
/// body's velocity into the contact by `-bounce`.
#[inline]
fn resolve(bodies: &mut [Body], ia: usize, ib: usize, nx: f64, ny: f64, pen: f64, e: f64) {
    let (da, db) = match (bodies[ia].dynamic, bodies[ib].dynamic) {
        (true, true) => (0.5, 0.5),
        (true, false) => (1.0, 0.0),
        (false, true) => (0.0, 1.0),
        (false, false) => return,
    };
    if da > 0.0 {
        let a = &mut bodies[ia];
        a.x += nx * pen * da;
        a.y += ny * pen * da;
        let vn = a.vx * nx + a.vy * ny;
        if vn < 0.0 {
            let k = (1.0 + e) * vn;
            if a.has_vx {
                a.vx = a.vx - k * nx + 0.0;
            }
            if a.has_vy {
                a.vy = a.vy - k * ny + 0.0;
            }
        }
    }
    if db > 0.0 {
        let b = &mut bodies[ib];
        b.x -= nx * pen * db;
        b.y -= ny * pen * db;
        let vn = b.vx * nx + b.vy * ny;
        if vn > 0.0 {
            let k = (1.0 + e) * vn;
            if b.has_vx {
                b.vx = b.vx - k * nx + 0.0;
            }
            if b.has_vy {
                b.vy = b.vy - k * ny + 0.0;
            }
        }
    }
}

/// Broad phase: sort-and-sweep on x. Fills `sc.pairs` with the candidate
/// `(i, j)` pairs (local indices; `i < j` when `same`) in sweep order, which
/// is deterministic (ties broken by group, then index). Only `solid` pushes
/// depend on the visiting order; emits are sorted afterwards.
fn sweep_pairs(sc: &mut Scratch, sa: usize, na: usize, sb: usize, nb: usize, same: bool) {
    sc.sweep.clear();
    sc.pairs.clear();
    // Sort key: min x (order-preserving bits), then group a before b, then index.
    let entry = |b: &Body, tag_b: bool, i: usize| {
        let lo = b.x - b.hw;
        let bits = lo.to_bits();
        let ord = if bits >> 63 == 1 { !bits } else { bits | (1 << 63) };
        let key = ((ord as u128) << 64) | ((tag_b as u128) << 32) | i as u128;
        (key, lo, b.x + b.hw)
    };
    for i in 0..na {
        sc.sweep.push(entry(&sc.bodies[sa + i], false, i));
    }
    if !same {
        for j in 0..nb {
            sc.sweep.push(entry(&sc.bodies[sb + j], true, j));
        }
    }
    sc.sweep.sort_unstable_by_key(|e| e.0);
    let n = sc.sweep.len();
    for k in 0..n {
        let (kk, _, hi) = sc.sweep[k];
        let (kb, ki) = ((kk >> 32) as u32 & 1 == 1, kk as u32);
        for m in k + 1..n {
            let (mk, lo2, _) = sc.sweep[m];
            if lo2 >= hi {
                break;
            }
            let (mb, mi) = ((mk >> 32) as u32 & 1 == 1, mk as u32);
            if same {
                sc.pairs.push((ki.min(mi), ki.max(mi)));
            } else if kb != mb {
                sc.pairs.push(if mb { (ki, mi) } else { (mi, ki) });
            }
        }
    }
}

// ───────────────────────────── write back ─────────────────────────────

fn write_back(ph: &Physics, state: &mut [Value], sc: &Scratch) -> bool {
    let mut any = false;
    for (gi, g) in ph.bodies.iter().enumerate() {
        if g.is_static {
            continue;
        }
        let range = sc.start[gi]..sc.start[gi + 1];
        let differs = |k: usize| {
            let b = &sc.bodies[k];
            let o = &sc.orig[k];
            b.x.to_bits() != o[0].to_bits()
                || b.y.to_bits() != o[1].to_bits()
                || b.vx.to_bits() != o[2].to_bits()
                || b.vy.to_bits() != o[3].to_bits()
        };
        if !range.clone().any(differs) {
            continue;
        }
        any = true;
        let write = |rec: &mut Value, b: &Body| {
            if let Value::Record(fields) = rec {
                let f = Rc::make_mut(fields);
                f[g.x as usize] = Value::Float(b.x + 0.0);
                f[g.y as usize] = Value::Float(b.y + 0.0);
                if let Some(i) = g.vx {
                    f[i as usize] = Value::Float(b.vx + 0.0);
                }
                if let Some(i) = g.vy {
                    f[i as usize] = Value::Float(b.vy + 0.0);
                }
            }
        };
        match &mut state[g.state as usize] {
            Value::List(items) => {
                let items = Rc::make_mut(items);
                for (k, rec) in range.clone().zip(items.iter_mut()) {
                    if differs(k) {
                        write(rec, &sc.bodies[k]);
                    }
                }
            }
            rec @ Value::Record(_) => write(rec, &sc.bodies[range.start]),
            _ => {}
        }
    }
    any
}

fn emit(ph: &Physics, sc: &Scratch, events: &mut Vec<(EventId, Rc<[Value]>)>) {
    let n_bounds = ph.on_bounds.len() as u32;
    for &((order, i, j), (nx, ny)) in &sc.contacts {
        let e: &PhysicsEmit = if order < n_bounds {
            &ph.on_bounds[order as usize].emit
        } else {
            match &ph.collisions[(order - n_bounds) as usize].emit {
                Some(e) => e,
                None => continue,
            }
        };
        let payload: Rc<[Value]> = e
            .fields
            .iter()
            .map(|f| match f {
                ContactField::A => Value::Int(i as i64),
                ContactField::B => Value::Int(j as i64),
                ContactField::Nx => Value::Float(nx + 0.0),
                ContactField::Ny => Value::Float(ny + 0.0),
            })
            .collect();
        events.push((e.event, payload));
    }
}
