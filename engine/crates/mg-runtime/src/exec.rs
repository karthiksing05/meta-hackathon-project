//! Rule effects (spec A10.3). A rule runs on a working copy of the state and
//! buffers its emits and timer operations; the scheduler commits everything
//! at the end, or drops it all on error.

use std::rc::Rc;

use mg_core::ir::{Effect, EventId, Expr, Outcome, PathStep, Place, Program, TimerId};
use mg_core::limits::{MAX_ACTIVE_TIMERS, MAX_EFFECTS_PER_EVENT};
use mg_core::Value;

use crate::eval::{check_len, eval, eval_bool, kind, limit_err, rt_err, Cx, PureEnv, R};
use crate::Phase;

/// A pending `after` timer.
#[derive(Clone, Debug)]
pub(crate) struct Timer {
    pub due_us: i64,
    /// Creation order (tie-break for equal due times).
    pub seq: u64,
    pub event: EventId,
    pub payload: Rc<[Value]>,
    pub name: Option<TimerId>,
}

/// Buffered timer operation, applied in order when the rule commits.
pub(crate) enum TimerOp {
    After { due_us: i64, event: EventId, payload: Rc<[Value]>, name: Option<TimerId> },
    Cancel(TimerId),
}

pub(crate) enum Flow {
    Continue,
    End(Outcome),
}

pub(crate) struct Exec<'a> {
    pub prog: &'a Program,
    pub work: &'a mut Vec<Value>,
    pub cx: Cx<'a>,
    pub now_ms: i64,
    pub clock_us: i64,
    pub event: &'a [Value],
    pub effects_left: u32,
    pub emits: &'a mut Vec<(EventId, Rc<[Value]>)>,
    pub ops: &'a mut Vec<TimerOp>,
    /// Committed pending timers (to count active timers).
    pub timers: &'a [Timer],
    pub timer_count: usize,
    pub keys: &'a mut Vec<Value>,
    pub empty: &'a Rc<[Value]>,
    /// A `set` ran (state may have changed).
    pub dirty: bool,
}

impl Exec<'_> {
    #[inline]
    fn ev(&mut self, e: &Expr) -> R<Value> {
        let env = PureEnv {
            program: self.prog,
            state: self.work,
            now_ms: self.now_ms,
            phase: Phase::Playing,
            event: self.event,
        };
        eval(&env, &mut self.cx, e)
    }

    #[inline]
    fn ev_bool(&mut self, e: &Expr) -> R<bool> {
        let env = PureEnv {
            program: self.prog,
            state: self.work,
            now_ms: self.now_ms,
            phase: Phase::Playing,
            event: self.event,
        };
        eval_bool(&env, &mut self.cx, e)
    }

    pub fn run(&mut self, effects: &[Effect]) -> R<Flow> {
        for eff in effects {
            if self.effects_left == 0 {
                return Err(limit_err(format!(
                    "more than {MAX_EFFECTS_PER_EVENT} effects ran for one event"
                )));
            }
            self.effects_left -= 1;
            match eff {
                Effect::Set { place, value } => self.set(place, value)?,
                Effect::Let { slot, value } => {
                    let v = self.ev(value)?;
                    self.cx.set_local(*slot, v)?;
                }
                Effect::If { cond, then, els } => {
                    let branch = if self.ev_bool(cond)? { then } else { els };
                    if let Flow::End(o) = self.run(branch)? {
                        return Ok(Flow::End(o));
                    }
                }
                Effect::ForEach { slot, collection, body } => match self.ev(collection)? {
                    Value::List(l) => {
                        for x in l.iter() {
                            self.cx.set_local(*slot, x.clone())?;
                            if let Flow::End(o) = self.run(body)? {
                                return Ok(Flow::End(o));
                            }
                        }
                    }
                    Value::Set(s) => {
                        for x in s.iter() {
                            self.cx.set_local(*slot, x.clone())?;
                            if let Flow::End(o) = self.run(body)? {
                                return Ok(Flow::End(o));
                            }
                        }
                    }
                    v => return Err(rt_err(format!("for_each needs a list or set, found {}", kind(&v)))),
                },
                Effect::Emit { event, args } => {
                    let p = self.payload(args)?;
                    self.emits.push((*event, p));
                }
                Effect::After { delay, event, args, timer } => {
                    let d = match self.ev(delay)? {
                        Value::Int(d) => d,
                        Value::Float(f) if f.is_finite() => f.round() as i64,
                        v => return Err(rt_err(format!("after: the delay must be an int (ms), found {}", kind(&v)))),
                    };
                    let p = self.payload(args)?;
                    let replaces = match timer {
                        Some(id) => self.is_pending(*id),
                        None => false,
                    };
                    if !replaces {
                        if self.timer_count >= MAX_ACTIVE_TIMERS {
                            return Err(limit_err(format!(
                                "more than {MAX_ACTIVE_TIMERS} 'after' timers would be pending"
                            )));
                        }
                        self.timer_count += 1;
                    }
                    let due_us = self.clock_us.saturating_add(d.max(0).saturating_mul(1000));
                    self.ops.push(TimerOp::After { due_us, event: *event, payload: p, name: *timer });
                }
                Effect::Cancel { timer } => {
                    if self.is_pending(*timer) {
                        self.timer_count -= 1;
                    }
                    self.ops.push(TimerOp::Cancel(*timer));
                }
                Effect::End(o) => return Ok(Flow::End(*o)),
            }
        }
        Ok(Flow::Continue)
    }

    fn payload(&mut self, args: &[Expr]) -> R<Rc<[Value]>> {
        if args.is_empty() {
            return Ok(self.empty.clone());
        }
        let mut v = Vec::with_capacity(args.len());
        for a in args {
            v.push(self.ev(a)?);
        }
        Ok(Rc::from(v))
    }

    /// Whether a named timer is pending, counting this rule's buffered ops.
    fn is_pending(&self, id: TimerId) -> bool {
        for op in self.ops.iter().rev() {
            match op {
                TimerOp::After { name: Some(n), .. } if *n == id => return true,
                TimerOp::Cancel(n) if *n == id => return false,
                _ => {}
            }
        }
        self.timers.iter().any(|t| t.name == Some(id))
    }

    fn set(&mut self, place: &Place, value: &Expr) -> R<()> {
        // Index keys first (left to right), then the value: all against the
        // working state before this write.
        self.keys.clear();
        for step in &place.path {
            if let PathStep::Index(e) = step {
                let k = self.ev(e)?;
                self.keys.push(k);
            }
        }
        let v = self.ev(value)?;
        let sid = place.state as usize;
        if sid >= self.work.len() {
            return Err(rt_err(format!("internal: state id {sid} out of range")));
        }
        self.dirty = true;
        if place.path.is_empty() {
            self.work[sid] = v;
            return Ok(());
        }
        // Take the value out so a uniquely owned container is written in place.
        let mut root = std::mem::take(&mut self.work[sid]);
        let r = write_path(&mut root, &place.path, self.keys, v);
        self.work[sid] = root;
        r
    }
}

fn write_path(slot: &mut Value, path: &[PathStep], keys: &[Value], v: Value) -> R<()> {
    let mut cur = slot;
    let mut ki = 0;
    let n = path.len();
    for (si, step) in path.iter().enumerate() {
        let last = si + 1 == n;
        cur = match step {
            PathStep::Field(i) => match cur {
                Value::Record(r) => {
                    if *i as usize >= r.len() {
                        return Err(rt_err(format!("internal: record has no field #{i}")));
                    }
                    &mut Rc::make_mut(r)[*i as usize]
                }
                other => return Err(rt_err(format!("cannot set a field on {}", kind(other)))),
            },
            PathStep::Index(_) => {
                let k = &keys[ki];
                ki += 1;
                match (cur, k) {
                    (Value::List(l), Value::Int(i)) => {
                        if *i < 0 || *i as u64 >= l.len() as u64 {
                            return Err(rt_err(format!(
                                "set: index {i} is out of range for a list of length {}",
                                l.len()
                            )));
                        }
                        &mut Rc::make_mut(l)[*i as usize]
                    }
                    (Value::Grid(g), Value::IVec2(x, y)) => match g.index(*x, *y) {
                        Some(idx) => &mut Rc::make_mut(g).cells[idx],
                        None => {
                            return Err(rt_err(format!(
                                "set: cell ({x}, {y}) is outside the {}x{} grid",
                                g.w, g.h
                            )))
                        }
                    },
                    (Value::Map(m), k) => {
                        if !m.contains_key(k) {
                            if !last {
                                return Err(rt_err(format!("set: key {k} is not in the map")));
                            }
                            check_len(m.len() + 1, "map")?;
                        }
                        Rc::make_mut(m).entry(k.clone()).or_insert(Value::None)
                    }
                    (c, k) => return Err(rt_err(format!("set: cannot index a {} with a {}", kind(c), kind(k)))),
                }
            }
        };
    }
    *cur = v;
    Ok(())
}
