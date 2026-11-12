//! # mg-runtime: the deterministic game runtime
//!
//! Executes `mg_core::ir::Program` following spec A10 exactly. No
//! presentation here: `mg-scene` reads `Game` state and feeds pointer input.
//!
//! PUBLIC API: the signatures in this file and in `eval.rs` marked CONTRACT
//! are used by mg-scene, mg-wasm and mg-cli. Keep them; add freely.
//!
//! ## Scheduling (spec A10)
//! * The clock is an integer number of **microseconds**; `now` = µs / 1000.
//! * `step(dt)`: advance the clock (clamped at the time limit), then process
//!   queued inputs (arrival order), then due timers (by due time, then
//!   creation order), then one `tick`. Each of those *source* events is
//!   followed by its cascade of emitted events (FIFO: an emit goes to the
//!   back of the queue) before the next source event is taken. Timers are
//!   pulled one at a time, so a timer cancelled or replaced earlier in the
//!   same step does not fire.
//! * After every event the objectives are checked (`win` before `lose`),
//!   except inside the setup cascade (`start` + its emits), which is checked
//!   once at its end.
//! * At most `MAX_EVENTS_PER_STEP` events per step; the rest are dropped
//!   (pending timers stay pending) with an `E_LIMIT` diagnostic.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use mg_core::hash::StableHasher;
use mg_core::ir::{EventId, Expr, InputId, Outcome, Program, RuleId, SourceTrigger};
use mg_core::limits::{MAX_EFFECTS_PER_EVENT, MAX_EVAL_STEPS_PER_EVENT, MAX_EVENTS_PER_STEP, MAX_QUEUED_INPUTS};
use mg_core::rng::Rng;
use mg_core::scene::EventRef;
use mg_core::types::Type;
use mg_core::{Code, Diagnostic, Value};

mod builtins;
pub mod eval;
mod exec;
mod mathx;
mod words;

#[cfg(test)]
mod tests;

use eval::{eval, Cx, PureEnv};
use exec::{Exec, Flow, Timer, TimerOp};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    Playing,
    Won,
    Lost,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Playing => "playing",
            Phase::Won => "won",
            Phase::Lost => "lost",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    pub phase: Phase,
    /// `objectives.score` evaluated now (as f64), if declared and it evaluates.
    pub score: Option<f64>,
    /// Game time in ms. Stops when the game ends.
    pub time_ms: i64,
}

/// An event that was processed, for the presentation (animate_on, feedback).
/// Inputs that were dropped by their guard are not reported.
#[derive(Clone, Debug, PartialEq)]
pub struct Fired {
    pub on: EventRef,
    /// Payload in payload order (inputs include the trailing `t`).
    pub payload: Rc<[Value]>,
}

/// Fired events kept when nobody drains them.
const MAX_FIRED_BUFFER: usize = 4096;
/// Diagnostics kept when nobody takes them.
const MAX_DIAG_BUFFER: usize = 512;

/// One independent repeating `every` timer.
#[derive(Clone, Debug)]
struct Every {
    rule: RuleId,
    period_us: i64,
    next_due_us: i64,
    seq: u64,
}

#[derive(Clone, Copy)]
enum Ev {
    Start,
    Tick,
    Every(RuleId),
    Input(InputId),
    Custom(EventId),
}

enum Due {
    After(Timer),
    Every(RuleId),
}

/// CONTRACT. One running game.
pub struct Game {
    program: Rc<Program>,
    seed: u64,
    rng: Rng,
    state: Vec<Value>,
    /// Scratch working copy for the rule being run.
    work: Vec<Value>,
    phase: Phase,
    clock_us: i64,
    time_limit_us: Option<i64>,
    version: u64,
    /// Bumped on every commit that ran a `set`.
    state_rev: u64,
    /// `(state_rev, now)` at the last objectives check with no result.
    obj_memo: Option<(u64, i64)>,
    obj_uses_now: bool,
    /// True while the `start` cascade runs (objectives are checked after it).
    in_setup: bool,
    inputs: VecDeque<(InputId, Vec<Value>)>,
    emitted: VecDeque<(EventId, Rc<[Value]>)>,
    timers: Vec<Timer>,
    every: Vec<Every>,
    next_seq: u64,
    stack: Vec<Value>,
    scratch: RefCell<Vec<Value>>,
    fired: Vec<Fired>,
    diags: Vec<Diagnostic>,
    events_left: u32,
    steps_left: u64,
    effects_left: u32,
    rule_emits: Vec<(EventId, Rc<[Value]>)>,
    rule_ops: Vec<TimerOp>,
    keybuf: Vec<Value>,
    empty: Rc<[Value]>,
}

impl Game {
    /// Initializes state from `init` expressions (in declaration order, each
    /// seeing the ones before it) and processes the `start` event (start
    /// rules plus anything they emit), all at time 0.
    pub fn new(program: Rc<Program>, seed: u64) -> Game {
        let n = program.state.len();
        let obj_uses_now = {
            let mut memo = vec![0u8; program.functions.len()];
            let o = &program.objectives;
            o.win.as_ref().is_some_and(|e| uses_now(&program, e, &mut memo))
                || o.lose.as_ref().is_some_and(|e| uses_now(&program, e, &mut memo))
        };
        let mut g = Game {
            time_limit_us: program.objectives.time_limit_ms.map(|ms| ms.max(0).saturating_mul(1000)),
            program,
            seed,
            rng: Rng::new(seed),
            state: Vec::with_capacity(n),
            work: Vec::with_capacity(n),
            phase: Phase::Playing,
            clock_us: 0,
            version: 0,
            state_rev: 0,
            obj_memo: None,
            obj_uses_now,
            in_setup: false,
            inputs: VecDeque::new(),
            emitted: VecDeque::new(),
            timers: Vec::new(),
            every: Vec::new(),
            next_seq: 0,
            stack: Vec::new(),
            scratch: RefCell::new(Vec::new()),
            fired: Vec::new(),
            diags: Vec::new(),
            events_left: MAX_EVENTS_PER_STEP,
            steps_left: MAX_EVAL_STEPS_PER_EVENT,
            effects_left: MAX_EFFECTS_PER_EVENT,
            rule_emits: Vec::new(),
            rule_ops: Vec::new(),
            keybuf: Vec::new(),
            empty: Rc::from(Vec::new()),
        };
        g.init(seed);
        g
    }

    pub fn program(&self) -> &Rc<Program> {
        &self.program
    }

    /// The seed of the current run.
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Restarts from scratch with a seed.
    pub fn restart(&mut self, seed: u64) {
        self.init(seed);
    }

    fn init(&mut self, seed: u64) {
        let prog = self.program.clone();
        self.seed = seed;
        self.rng = Rng::new(seed);
        self.phase = Phase::Playing;
        self.clock_us = 0;
        self.version += 1;
        self.state_rev += 1;
        self.obj_memo = None;
        self.inputs.clear();
        self.emitted.clear();
        self.timers.clear();
        self.fired.clear();
        self.next_seq = 0;
        self.every.clear();
        for &(rule, period_ms) in &prog.dispatch.every {
            let period_us = period_ms.max(1).saturating_mul(1000);
            self.every.push(Every { rule, period_us, next_due_us: period_us, seq: self.next_seq });
            self.next_seq += 1;
        }

        // State inits, in order; each sees the earlier ones. Randomness allowed.
        self.state.clear();
        self.state.resize(prog.state.len(), Value::None);
        for (i, var) in prog.state.iter().enumerate() {
            self.stack.clear();
            self.stack.resize(var.n_locals as usize, Value::None);
            let env = PureEnv { program: &prog, state: &self.state, now_ms: 0, phase: Phase::Playing, event: &[] };
            let mut cx =
                Cx { stack: &mut self.stack, base: 0, rng: Some(&mut self.rng), steps_left: MAX_EVAL_STEPS_PER_EVENT };
            let r = eval(&env, &mut cx, &var.init);
            match r {
                Ok(v) => self.state[i] = v,
                Err(e) => {
                    self.state[i] = default_value(&var.ty);
                    let at = mg_core::diag::pointer(["state", &*var.name, "init"]);
                    self.diag(e.code, at, format!("state '{}' init: {}", var.name, e.msg));
                }
            }
        }

        // The start event, at time 0.
        self.events_left = MAX_EVENTS_PER_STEP;
        self.take_event_slot();
        // Setup = `start` plus everything it emits. Objectives are checked
        // once it has finished: a board that `start` fills through emitted
        // events (Number Merge's two `spawn_tile`s) must not be judged empty.
        self.in_setup = true;
        self.process(&prog, Ev::Start, &[]);
        self.drain_emitted(&prog);
        self.in_setup = false;
        self.check_objectives(&prog);
    }

    /// Queues a player input. `payload` holds the **declared** fields only
    /// (the runtime appends `t`). Ignored once the game has ended. A payload
    /// of the wrong length is dropped with a diagnostic.
    pub fn input(&mut self, input: InputId, payload: Vec<Value>) {
        if self.phase != Phase::Playing {
            return;
        }
        let Some(def) = self.program.inputs.get(input as usize) else {
            self.diag(Code::UnknownInput, "/inputs".into(), format!("input id {input} does not exist"));
            return;
        };
        let declared = def.payload.len().saturating_sub(1);
        if payload.len() != declared {
            let at = mg_core::diag::pointer(["inputs", &*def.name, "payload"]);
            let msg = format!("input '{}' expects {declared} payload values, got {}", def.name, payload.len());
            self.diag(Code::BadPayload, at, msg);
            return;
        }
        if self.inputs.len() >= MAX_QUEUED_INPUTS {
            let at = mg_core::diag::pointer(["inputs", &*def.name]);
            self.diag(Code::Limit, at, format!("more than {MAX_QUEUED_INPUTS} inputs queued; input dropped"));
            return;
        }
        self.inputs.push_back((input, payload));
    }

    /// Maps a key (browser `KeyboardEvent.code` or `.key`) to inputs via
    /// `InputDef::sources` and queues them. Returns true if any matched.
    pub fn key(&mut self, code: &str) -> bool {
        self.source_input(|t| matches!(t, SourceTrigger::Key(k) if &**k == code), || {
            Value::Record(Rc::new(vec![Value::str(code)]))
        })
    }

    /// Maps a swipe direction (one of the 4 unit ivec2s) to inputs and queues
    /// them. Returns true if any matched.
    pub fn swipe(&mut self, dx: i32, dy: i32) -> bool {
        self.source_input(
            |t| match t {
                SourceTrigger::Swipe(None) => true,
                SourceTrigger::Swipe(Some(d)) => *d == (dx, dy),
                _ => false,
            },
            || Value::Record(Rc::new(vec![Value::IVec2(dx, dy)])),
        )
    }

    /// For each input, the first source matching `pred` builds a payload from
    /// its `with` expressions (slot 0 = the source record) and queues it.
    fn source_input(&mut self, pred: impl Fn(&SourceTrigger) -> bool, record: impl Fn() -> Value) -> bool {
        if self.phase != Phase::Playing {
            return false;
        }
        let prog = self.program.clone();
        let mut matched = false;
        for (ii, def) in prog.inputs.iter().enumerate() {
            let Some((si, src)) = def.sources.iter().enumerate().find(|(_, s)| pred(&s.trigger)) else {
                continue;
            };
            matched = true;
            self.stack.clear();
            self.stack.resize((src.n_locals as usize).max(1), Value::None);
            self.stack[0] = record();
            let mut payload = Vec::with_capacity(src.with.len());
            let mut failed = None;
            {
                let env = PureEnv {
                    program: &prog,
                    state: &self.state,
                    now_ms: self.clock_us / 1000,
                    phase: self.phase,
                    event: &[],
                };
                let mut cx =
                    Cx { stack: &mut self.stack, base: 0, rng: None, steps_left: MAX_EVAL_STEPS_PER_EVENT };
                for w in &src.with {
                    match eval(&env, &mut cx, w) {
                        Ok(v) => payload.push(v),
                        Err(e) => {
                            failed = Some(e);
                            break;
                        }
                    }
                }
            }
            match failed {
                None => self.input(ii as InputId, payload),
                Some(e) => {
                    let at = mg_core::diag::pointer(["inputs", &*def.name, "from", &si.to_string(), "with"]);
                    self.diag(e.code, at, format!("input '{}' source: {}", def.name, e.msg));
                }
            }
        }
        matched
    }

    /// Advances the clock by `dt_ms` and processes queued inputs, due timers,
    /// then one tick (spec A10). Then applies the time limit.
    pub fn step(&mut self, dt_ms: f64) {
        if self.phase != Phase::Playing {
            return;
        }
        let prog = self.program.clone();
        let dt_us = dt_to_us(dt_ms);
        let mut target = self.clock_us.saturating_add(dt_us);
        if let Some(lim) = self.time_limit_us {
            target = target.min(lim.max(self.clock_us));
        }
        let adv = target - self.clock_us;
        if adv > 0 {
            self.clock_us = target;
            self.version += 1;
        }
        self.events_left = MAX_EVENTS_PER_STEP;

        // 1. Queued inputs, in arrival order.
        while self.phase == Phase::Playing && !self.inputs.is_empty() {
            if !self.take_event_slot() {
                break;
            }
            let (id, declared) = self.inputs.pop_front().unwrap();
            self.process_input(&prog, id, declared);
            self.drain_emitted(&prog);
        }

        // 2. Due timers, by due time then creation order.
        while self.phase == Phase::Playing && self.has_due_timer() {
            if !self.take_event_slot() {
                break;
            }
            match self.pop_due_timer() {
                Some(Due::After(t)) => {
                    self.push_fired(EventRef::Event(t.event), t.payload.clone());
                    self.process(&prog, Ev::Custom(t.event), &t.payload);
                }
                Some(Due::Every(rule)) => self.process(&prog, Ev::Every(rule), &[]),
                None => break,
            }
            self.drain_emitted(&prog);
        }

        // 3. One tick.
        if self.phase == Phase::Playing && self.take_event_slot() {
            let payload = [Value::Float(adv as f64 / 1000.0)];
            self.process(&prog, Ev::Tick, &payload);
            self.drain_emitted(&prog);
        }

        // 4. Time limit.
        if self.phase == Phase::Playing {
            if let Some(lim) = self.time_limit_us {
                if self.clock_us >= lim {
                    self.end(prog.objectives.on_timeout);
                }
            }
        }
    }

    pub fn status(&self) -> Status {
        Status { phase: self.phase, score: self.score(), time_ms: self.now_ms() }
    }

    fn score(&self) -> Option<f64> {
        let o = &self.program.objectives;
        let e = o.score.as_ref()?;
        let mut stack = self.scratch.borrow_mut();
        stack.clear();
        stack.resize(o.n_locals as usize, Value::None);
        let env = self.env(&self.program, &[]);
        let mut cx = Cx { stack: &mut stack, base: 0, rng: None, steps_left: MAX_EVAL_STEPS_PER_EVENT };
        eval(&env, &mut cx, e).ok()?.as_f64()
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Current committed state, indexed by `StateId`.
    pub fn state(&self) -> &[Value] {
        &self.state
    }

    /// Game time in whole ms (`now`).
    pub fn now_ms(&self) -> i64 {
        self.clock_us / 1000
    }

    /// Game time in µs (the internal clock).
    pub fn now_us(&self) -> i64 {
        self.clock_us
    }

    /// Increments whenever committed state, phase or time changes. The scene
    /// uses it to skip re-evaluating bindings.
    pub fn version(&self) -> u64 {
        self.version
    }

    /// Stable hash of state + phase + clock + RNG state + pending timers.
    pub fn state_hash(&self) -> u64 {
        let mut h = StableHasher::new();
        h.write_u64(self.state.len() as u64);
        for v in &self.state {
            v.stable_hash(&mut h);
        }
        h.write_u8(match self.phase {
            Phase::Playing => 0,
            Phase::Won => 1,
            Phase::Lost => 2,
        });
        h.write_u64(self.clock_us as u64);
        let mut r = self.rng.clone();
        for _ in 0..4 {
            h.write_u64(r.next_u64());
        }
        h.write_u64(self.timers.len() as u64);
        for t in &self.timers {
            h.write_u64(t.due_us as u64);
            h.write_u64(t.event as u64);
            h.write_u64(t.name.map_or(u64::MAX, |n| n as u64));
            h.write_u64(t.payload.len() as u64);
            for v in t.payload.iter() {
                v.stable_hash(&mut h);
            }
        }
        for e in &self.every {
            h.write_u64(e.next_due_us as u64);
        }
        h.finish()
    }

    /// Number of inputs waiting for the next `step`.
    pub fn queued_inputs(&self) -> usize {
        self.inputs.len()
    }

    /// Overwrites one state variable (tests, tools, debugging). Bypasses the
    /// rules; objectives are checked on the next event. The value must have
    /// the variable's type. No-op once the game has ended.
    pub fn set_state_var(&mut self, id: mg_core::ir::StateId, value: Value) {
        if self.phase != Phase::Playing {
            return;
        }
        if let Some(slot) = self.state.get_mut(id as usize) {
            *slot = value;
            self.state_rev += 1;
            self.version += 1;
        }
    }

    /// Moves processed events (since the last call) into `out`, in order.
    pub fn drain_fired(&mut self, out: &mut Vec<Fired>) {
        out.append(&mut self.fired);
    }

    /// Takes runtime diagnostics (`E_RUNTIME`, `E_LIMIT`) since the last call.
    pub fn take_diagnostics(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut self.diags)
    }

    // ───────────────────────────── internals ─────────────────────────────

    fn env<'a>(&'a self, prog: &'a Program, event: &'a [Value]) -> PureEnv<'a> {
        PureEnv { program: prog, state: &self.state, now_ms: self.now_ms(), phase: self.phase, event }
    }

    fn diag(&mut self, code: Code, at: String, message: String) {
        if let Some(last) = self.diags.last() {
            if last.code == code && last.at == at && last.message == message {
                return;
            }
        }
        if self.diags.len() >= MAX_DIAG_BUFFER {
            return;
        }
        self.diags.push(Diagnostic::new(code, at, message));
    }

    fn push_fired(&mut self, on: EventRef, payload: Rc<[Value]>) {
        if self.fired.len() >= MAX_FIRED_BUFFER {
            self.fired.drain(..MAX_FIRED_BUFFER / 2);
        }
        self.fired.push(Fired { on, payload });
    }

    /// Reserves one event of this step's budget. On overflow, records
    /// `E_LIMIT` and drops the queued inputs and emitted events.
    fn take_event_slot(&mut self) -> bool {
        if self.events_left > 0 {
            self.events_left -= 1;
            return true;
        }
        let dropped = self.inputs.len() + self.emitted.len();
        self.inputs.clear();
        self.emitted.clear();
        self.diag(
            Code::Limit,
            "/rules".into(),
            format!(
                "more than {MAX_EVENTS_PER_STEP} events in one step (an emit loop?); {dropped} queued events were dropped"
            ),
        );
        false
    }

    fn has_due_timer(&self) -> bool {
        self.timers.iter().any(|t| t.due_us <= self.clock_us) || self.every.iter().any(|e| e.next_due_us <= self.clock_us)
    }

    fn pop_due_timer(&mut self) -> Option<Due> {
        let now = self.clock_us;
        let mut best: Option<(i64, u64, bool, usize)> = None; // (due, seq, is_every, idx)
        for (i, t) in self.timers.iter().enumerate() {
            if t.due_us <= now && best.is_none_or(|b| (t.due_us, t.seq) < (b.0, b.1)) {
                best = Some((t.due_us, t.seq, false, i));
            }
        }
        for (i, e) in self.every.iter().enumerate() {
            if e.next_due_us <= now && best.is_none_or(|b| (e.next_due_us, e.seq) < (b.0, b.1)) {
                best = Some((e.next_due_us, e.seq, true, i));
            }
        }
        let (_, _, is_every, i) = best?;
        if is_every {
            let e = &mut self.every[i];
            e.next_due_us = e.next_due_us.saturating_add(e.period_us);
            Some(Due::Every(e.rule))
        } else {
            Some(Due::After(self.timers.remove(i)))
        }
    }

    fn drain_emitted(&mut self, prog: &Program) {
        while self.phase == Phase::Playing && !self.emitted.is_empty() {
            if !self.take_event_slot() {
                return;
            }
            let (id, payload) = self.emitted.pop_front().unwrap();
            self.push_fired(EventRef::Event(id), payload.clone());
            self.process(prog, Ev::Custom(id), &payload);
        }
    }

    fn process_input(&mut self, prog: &Program, id: InputId, mut declared: Vec<Value>) {
        let Some(def) = prog.inputs.get(id as usize) else { return };
        declared.push(Value::Int(self.now_ms()));
        let payload: Rc<[Value]> = Rc::from(declared);
        if let Some(guard) = &def.guard {
            self.stack.clear();
            self.stack.resize(def.guard_n_locals as usize, Value::None);
            let env = PureEnv { program: prog, state: &self.state, now_ms: self.clock_us / 1000, phase: self.phase, event: &payload };
            let mut cx = Cx { stack: &mut self.stack, base: 0, rng: None, steps_left: MAX_EVAL_STEPS_PER_EVENT };
            match eval::eval_bool(&env, &mut cx, guard) {
                Ok(true) => {}
                Ok(false) => return,
                Err(e) => {
                    let at = mg_core::diag::pointer(["inputs", &*def.name, "when"]);
                    self.diag(e.code, at, format!("input '{}' guard: {}", def.name, e.msg));
                    return;
                }
            }
        }
        self.push_fired(EventRef::Input(id), payload.clone());
        self.process(prog, Ev::Input(id), &payload);
    }

    /// Runs the rules for one event, then checks the objectives.
    fn process(&mut self, prog: &Program, ev: Ev, payload: &[Value]) {
        self.steps_left = MAX_EVAL_STEPS_PER_EVENT;
        self.effects_left = MAX_EFFECTS_PER_EVENT;
        let every_rule;
        let rules: &[RuleId] = match ev {
            Ev::Start => &prog.dispatch.start,
            Ev::Tick => &prog.dispatch.tick,
            Ev::Every(r) => {
                every_rule = [r];
                &every_rule
            }
            Ev::Input(i) => prog.dispatch.input.get(i as usize).map_or(&[], |v| v.as_slice()),
            Ev::Custom(e) => prog.dispatch.event.get(e as usize).map_or(&[], |v| v.as_slice()),
        };
        for &rid in rules {
            if self.phase != Phase::Playing {
                return;
            }
            self.run_rule(prog, rid, payload);
        }
        self.check_objectives(prog);
    }

    fn run_rule(&mut self, prog: &Program, rid: RuleId, payload: &[Value]) {
        let Some(rule) = prog.rules.get(rid as usize) else { return };
        let now_ms = self.clock_us / 1000;
        self.stack.clear();
        self.stack.resize(rule.n_locals as usize, Value::None);

        // `when` sees the state as committed by earlier rules.
        if let Some(w) = &rule.when {
            let env = PureEnv { program: prog, state: &self.state, now_ms, phase: self.phase, event: payload };
            let mut cx = Cx { stack: &mut self.stack, base: 0, rng: None, steps_left: self.steps_left };
            let r = eval::eval_bool(&env, &mut cx, w);
            self.steps_left = cx.steps_left;
            match r {
                Ok(true) => {}
                Ok(false) => return,
                Err(e) => {
                    let msg = format!("rule '{}' when: {}", rule.id, e.msg);
                    self.diag(e.code, rule.at.to_string(), msg);
                    return;
                }
            }
        }

        self.work.clear();
        self.work.extend_from_slice(&self.state);
        self.rule_emits.clear();
        self.rule_ops.clear();
        let rng_backup = self.rng.clone();
        let mut ex = Exec {
            prog,
            work: &mut self.work,
            cx: Cx { stack: &mut self.stack, base: 0, rng: Some(&mut self.rng), steps_left: self.steps_left },
            now_ms,
            clock_us: self.clock_us,
            event: payload,
            effects_left: self.effects_left,
            emits: &mut self.rule_emits,
            ops: &mut self.rule_ops,
            timers: &self.timers,
            timer_count: self.timers.len(),
            keys: &mut self.keybuf,
            empty: &self.empty,
            dirty: false,
        };
        let r = ex.run(&rule.body);
        let dirty = ex.dirty;
        self.steps_left = ex.cx.steps_left;
        self.effects_left = ex.effects_left;

        match r {
            Ok(flow) => {
                if dirty {
                    std::mem::swap(&mut self.state, &mut self.work);
                    self.state_rev += 1;
                    self.version += 1;
                }
                self.work.clear();
                self.emitted.extend(self.rule_emits.drain(..));
                let mut ops = std::mem::take(&mut self.rule_ops);
                for op in ops.drain(..) {
                    self.apply_timer_op(op);
                }
                self.rule_ops = ops;
                if let Flow::End(o) = flow {
                    self.end(o);
                }
            }
            Err(e) => {
                self.work.clear();
                self.rule_emits.clear();
                self.rule_ops.clear();
                self.rng = rng_backup;
                let msg = format!("rule '{}': {}", rule.id, e.msg);
                self.diag(e.code, rule.at.to_string(), msg);
            }
        }
    }

    fn apply_timer_op(&mut self, op: TimerOp) {
        match op {
            TimerOp::After { due_us, event, payload, name } => {
                if let Some(n) = name {
                    self.timers.retain(|t| t.name != Some(n));
                }
                let seq = self.next_seq;
                self.next_seq += 1;
                self.timers.push(Timer { due_us, seq, event, payload, name });
            }
            TimerOp::Cancel(n) => self.timers.retain(|t| t.name != Some(n)),
        }
    }

    fn check_objectives(&mut self, prog: &Program) {
        if self.phase != Phase::Playing || self.in_setup {
            return;
        }
        let o = &prog.objectives;
        if o.win.is_none() && o.lose.is_none() {
            return;
        }
        let key = (self.state_rev, if self.obj_uses_now { self.clock_us / 1000 } else { 0 });
        if self.obj_memo == Some(key) {
            return;
        }
        self.obj_memo = Some(key);
        for (e, outcome, name) in [(&o.win, Outcome::Win, "win"), (&o.lose, Outcome::Lose, "lose")] {
            let Some(e) = e else { continue };
            self.stack.clear();
            self.stack.resize(o.n_locals as usize, Value::None);
            let env = PureEnv { program: prog, state: &self.state, now_ms: self.clock_us / 1000, phase: self.phase, event: &[] };
            let mut cx = Cx { stack: &mut self.stack, base: 0, rng: None, steps_left: MAX_EVAL_STEPS_PER_EVENT };
            match eval::eval_bool(&env, &mut cx, e) {
                Ok(true) => {
                    self.end(outcome);
                    return;
                }
                Ok(false) => {}
                Err(err) => {
                    let at = mg_core::diag::pointer(["objectives", name]);
                    self.diag(err.code, at, format!("objectives.{name}: {}", err.msg));
                }
            }
        }
    }

    fn end(&mut self, o: Outcome) {
        if self.phase != Phase::Playing {
            return;
        }
        self.phase = match o {
            Outcome::Win => Phase::Won,
            Outcome::Lose => Phase::Lost,
        };
        self.version += 1;
        let on = match o {
            Outcome::Win => EventRef::Win,
            Outcome::Lose => EventRef::Lose,
        };
        let empty = self.empty.clone();
        self.push_fired(on, empty);
        self.inputs.clear();
        self.emitted.clear();
    }
}

/// `dt_ms` → whole µs. Negative, NaN → 0.
fn dt_to_us(dt_ms: f64) -> i64 {
    if dt_ms > 0.0 {
        let us = (dt_ms * 1000.0).round();
        if us >= 1e15 {
            1_000_000_000_000_000
        } else {
            us as i64
        }
    } else {
        0
    }
}

/// Value used when a state init fails.
fn default_value(ty: &Type) -> Value {
    match ty {
        Type::Bool => Value::Bool(false),
        Type::Int => Value::Int(0),
        Type::Float => Value::Float(0.0),
        Type::Str => Value::str(""),
        Type::IVec2 => Value::IVec2(0, 0),
        Type::Vec2 => Value::Vec2(0.0, 0.0),
        Type::List(_) => Value::list(Vec::new()),
        Type::Set(_) => Value::Set(Rc::default()),
        Type::Map(..) => Value::Map(Rc::default()),
        Type::Grid(_) => Value::grid(0, 0, Vec::new()),
        Type::Option(_) | Type::Unknown => Value::None,
        Type::Enum(m) => m.first().map_or(Value::None, |s| Value::Str(s.clone())),
        Type::Record(r) => Value::record(r.fields.iter().map(|(_, t)| default_value(t)).collect()),
    }
}

/// Whether an expression reads `now` (directly or through a function).
/// `memo[f]`: 0 = unknown, 1 = no, 2 = yes.
fn uses_now(prog: &Program, e: &Expr, memo: &mut Vec<u8>) -> bool {
    let any = |xs: &[Expr], memo: &mut Vec<u8>| xs.iter().any(|x| uses_now(prog, x, memo));
    match e {
        Expr::Now => true,
        Expr::Const(_) | Expr::Local(_) | Expr::State(_) | Expr::Event(_) | Expr::Status => false,
        Expr::Field(b, _) | Expr::VecComponent(b, _) | Expr::Unary(_, b) | Expr::ToFloat(b) => uses_now(prog, b, memo),
        Expr::Index(a, b) | Expr::Binary(_, a, b) | Expr::Let(_, a, b) => {
            uses_now(prog, a, memo) || uses_now(prog, b, memo)
        }
        Expr::If(a, b, c) => uses_now(prog, a, memo) || uses_now(prog, b, memo) || uses_now(prog, c, memo),
        Expr::Call(f, args) => {
            if any(args, memo) {
                return true;
            }
            let fi = *f as usize;
            match memo.get(fi).copied() {
                Some(1) => false,
                Some(2) => true,
                Some(_) => {
                    memo[fi] = 1; // no recursion in valid programs; this also stops cycles
                    let r = prog.functions.get(fi).is_some_and(|func| uses_now(prog, &func.body, memo));
                    memo[fi] = if r { 2 } else { 1 };
                    r
                }
                None => true,
            }
        }
        Expr::Builtin(_, args) | Expr::List(args) | Expr::Record(args) => any(args, memo),
        Expr::Lambda { body, .. } => uses_now(prog, body, memo),
        Expr::RecordUpdate(b, ups) => uses_now(prog, b, memo) || ups.iter().any(|(_, x)| uses_now(prog, x, memo)),
    }
}
