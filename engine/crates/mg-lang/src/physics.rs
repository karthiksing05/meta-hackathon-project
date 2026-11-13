//! v0.2 physics section (SPEC-v0.2 §5) → `ir::Physics`.

use std::rc::Rc;

use mg_core::diag::Code;
use mg_core::ir::{BodyGroup, BodyShape, BoundsRule, CollisionRule, ContactField, FieldIdx, Physics, PhysicsEmit};
use mg_core::types::{RecordType, Type};
use serde_json::{Map, Value as J};

use crate::check::{dym, tyname, Checker};
use crate::{is_ident, json_kind, ptr};

type Obj = Map<String, J>;

const PHYSICS_KEYS: &[&str] = &["gravity", "bounds", "bodies", "collisions", "on_bounds"];
const GROUP_KEYS: &[&str] = &["state", "gravity", "static", "bounded", "bounce", "max_speed"];
const COLLISION_KEYS: &[&str] = &["a", "b", "solid", "bounce", "emit"];
const BOUNDS_KEYS: &[&str] = &["body", "emit"];
const BODY_TYPE_EXAMPLE: &str = "like \"type\": \"list<{x: float, y: float, vx: float, vy: float, r: float}>\"";

struct GroupInfo {
    name: Rc<str>,
    bounce: f64,
    bounded: bool,
}

impl Checker {
    fn phys_err(&mut self, at: &str, msg: impl Into<String>, hint: Option<String>) {
        self.err_at(Code::Physics, at, msg, hint);
    }

    fn phys_keys(&mut self, m: &Obj, allowed: &[&str], at: &str, what: &str) {
        for k in m.keys() {
            if k.starts_with('_') || allowed.contains(&k.as_str()) {
                continue;
            }
            let hint = dym(k, allowed.iter().copied()).or_else(|| Some(format!("allowed keys: {}", allowed.join(", "))));
            self.phys_err(&ptr(at, k), format!("unknown key '{k}' in {what}"), hint);
        }
    }

    fn phys_obj<'v>(&mut self, v: &'v J, at: &str, what: &str) -> Option<&'v Obj> {
        match v {
            J::Object(m) => Some(m),
            other => {
                self.phys_err(at, format!("{what} must be an object, found {}", json_kind(other)), None);
                None
            }
        }
    }

    fn phys_list<'v>(&mut self, v: &'v J, at: &str, what: &str) -> &'v [J] {
        match v {
            J::Array(items) => items,
            other => {
                self.phys_err(at, format!("{what} must be a list, found {}", json_kind(other)), None);
                &[]
            }
        }
    }

    /// `[x, y]` / `[x, y, w, h]` of numbers.
    fn phys_nums(&mut self, v: &J, at: &str, n: usize, what: &str, example: &str) -> Option<Vec<f64>> {
        let nums: Option<Vec<f64>> = match v {
            J::Array(items) if items.len() == n => items.iter().map(|x| x.as_f64().filter(|f| f.is_finite())).collect(),
            _ => None,
        };
        if nums.is_none() {
            self.phys_err(at, format!("{what} must be a list of {n} numbers, found {v}"), Some(format!("like {example}")));
        }
        nums
    }

    fn phys_bool(&mut self, m: &Obj, key: &str, at: &str) -> Option<bool> {
        match m.get(key)? {
            J::Bool(b) => Some(*b),
            other => {
                self.phys_err(&ptr(at, key), format!("'{key}' must be true or false, found {}", json_kind(other)), None);
                None
            }
        }
    }

    /// An optional number literal in `[lo, hi]`.
    fn phys_num(&mut self, m: &Obj, key: &str, at: &str, lo: f64, hi: f64, what: &str) -> Option<f64> {
        let v = m.get(key)?;
        match v.as_f64() {
            Some(x) if x >= lo && x <= hi => Some(x),
            _ => {
                self.phys_err(&ptr(at, key), format!("'{key}' must be {what}, found {v}"), None);
                None
            }
        }
    }

    pub fn physics(&mut self, v: Option<&J>, canvas: (f64, f64)) -> Option<Physics> {
        let v = v?;
        let at = "/physics";
        let m = self.phys_obj(v, at, "physics")?;
        self.phys_keys(m, PHYSICS_KEYS, at, "physics");
        let mut ph = Physics { gravity: (0.0, 0.0), bounds: None, bodies: Vec::new(), collisions: Vec::new(), on_bounds: Vec::new() };
        if let Some(g) = m.get("gravity") {
            if let Some(g) = self.phys_nums(g, "/physics/gravity", 2, "gravity", "[0, 1500] (px/s²)") {
                ph.gravity = (g[0], g[1]);
            }
        }
        let bounds_hint = format!("add \"bounds\": [0, 0, {}, {}] to physics", canvas.0, canvas.1);
        if let Some(b) = m.get("bounds") {
            let bat = "/physics/bounds";
            let ex = format!("[0, 0, {}, {}] (x, y, w, h)", canvas.0, canvas.1);
            if let Some(b) = self.phys_nums(b, bat, 4, "bounds", &ex) {
                if b[2] > 0.0 && b[3] > 0.0 {
                    ph.bounds = Some((b[0], b[1], b[2], b[3]));
                } else {
                    self.phys_err(bat, "bounds width and height must be positive", Some(format!("like {ex}")));
                }
            }
        }
        let has_bounds = m.get("bounds").is_some();

        // ── Body groups ──
        let mut groups: Vec<GroupInfo> = Vec::new();
        match m.get("bodies") {
            None => self.phys_err(at, "physics is missing 'bodies'", Some("like \"bodies\": {\"ball\": {\"state\": \"ball\"}}".into())),
            Some(b) => {
                if let Some(bm) = self.phys_obj(b, "/physics/bodies", "bodies") {
                    for (name, gv) in bm {
                        let gat = ptr("/physics/bodies", name);
                        if !is_ident(name) {
                            self.phys_err(&gat, format!("body group name '{name}' is not a valid name"), None);
                            continue;
                        }
                        let group = self.body_group(name, gv, &gat, has_bounds, &bounds_hint);
                        groups.push(GroupInfo {
                            name: Rc::from(name.as_str()),
                            bounce: group.as_ref().map_or(0.0, |g| g.bounce),
                            bounded: group.as_ref().is_none_or(|g| g.bounded),
                        });
                        if let Some(g) = group {
                            ph.bodies.push(g);
                        }
                    }
                }
            }
        }

        // ── Collisions ──
        if let Some(c) = m.get("collisions") {
            let cat = "/physics/collisions";
            for (i, cv) in self.phys_list(c, cat, "collisions").iter().enumerate() {
                let iat = ptr(cat, &i.to_string());
                let Some(cm) = self.phys_obj(cv, &iat, "a collision") else { continue };
                self.phys_keys(cm, COLLISION_KEYS, &iat, "a collision");
                let a = self.group_ref(cm, "a", &iat, &groups);
                let b = self.group_ref(cm, "b", &iat, &groups);
                let solid = self.phys_bool(cm, "solid", &iat).unwrap_or(false);
                let bounce = self.phys_num(cm, "bounce", &iat, 0.0, 1.0, "a number from 0 to 1");
                let emit = cm.get("emit").and_then(|e| self.physics_emit(e, &ptr(&iat, "emit"), true));
                if !solid && !cm.contains_key("emit") {
                    self.err_at(
                        Code::Lint,
                        &iat,
                        "this collision has neither \"solid\": true nor \"emit\", so it does nothing",
                        Some("add \"emit\": \"<event>\" to react to it, or \"solid\": true to keep the bodies apart".into()),
                    );
                }
                if let (Some(a), Some(b)) = (a, b) {
                    let bounce = bounce.unwrap_or_else(|| groups[a as usize].bounce.max(groups[b as usize].bounce));
                    ph.collisions.push(CollisionRule { a, b, solid, bounce, emit });
                }
            }
        }

        // ── Bounds events ──
        if let Some(o) = m.get("on_bounds") {
            let oat = "/physics/on_bounds";
            if !has_bounds {
                self.phys_err(oat, "on_bounds needs physics.bounds", Some(bounds_hint.clone()));
            }
            for (i, ov) in self.phys_list(o, oat, "on_bounds").iter().enumerate() {
                let iat = ptr(oat, &i.to_string());
                let Some(om) = self.phys_obj(ov, &iat, "an on_bounds entry") else { continue };
                self.phys_keys(om, BOUNDS_KEYS, &iat, "an on_bounds entry");
                let body = self.group_ref(om, "body", &iat, &groups);
                let emit = match om.get("emit") {
                    Some(e) => self.physics_emit(e, &ptr(&iat, "emit"), false),
                    None => {
                        self.phys_err(&iat, "an on_bounds entry is missing 'emit'", Some("like {\"body\": \"ball\", \"emit\": \"hit_wall\"}".into()));
                        None
                    }
                };
                if let Some(b) = body {
                    if !groups[b as usize].bounded {
                        let name = groups[b as usize].name.clone();
                        self.err_at(
                            Code::Lint,
                            &ptr(&iat, "body"),
                            format!("group '{name}' isn't bounded, so it never touches the bounds"),
                            Some(format!("add \"bounded\": true to physics.bodies.{name}")),
                        );
                    }
                }
                if let (Some(body), Some(emit)) = (body, emit) {
                    ph.on_bounds.push(BoundsRule { body, emit });
                }
            }
        }
        Some(ph)
    }

    fn body_group(&mut self, name: &str, v: &J, at: &str, has_bounds: bool, bounds_hint: &str) -> Option<BodyGroup> {
        let m = self.phys_obj(v, at, "a body group")?;
        self.phys_keys(m, GROUP_KEYS, at, &format!("body group '{name}'"));
        let sat = ptr(at, "state");
        let sname = match m.get("state") {
            Some(J::String(s)) => s.as_str(),
            Some(other) => {
                self.phys_err(&sat, format!("'state' must be the name of a state variable, found {}", json_kind(other)), None);
                return None;
            }
            None => {
                self.phys_err(at, format!("body group '{name}' is missing 'state'"), Some(format!("like \"{name}\": {{\"state\": \"{name}\"}}")));
                return None;
            }
        };
        let Some(&sid) = self.state_idx.get(sname) else {
            let hint = dym(sname, self.state.iter().map(|s| &*s.name)).or_else(|| Some(format!("declare it under \"state\", {BODY_TYPE_EXAMPLE}")));
            self.phys_err(&sat, format!("unknown state variable '{sname}'"), hint);
            return None;
        };
        self.state_read[sid as usize] = true;
        let ty = self.state[sid as usize].ty.clone();
        let (rt, is_list): (Rc<RecordType>, bool) = match &ty {
            Type::Record(rt) => (rt.clone(), false),
            Type::List(inner) if matches!(&**inner, Type::Record(_)) => {
                let Type::Record(rt) = &**inner else { unreachable!() };
                (rt.clone(), true)
            }
            Type::Unknown => return None,
            t => {
                self.phys_err(
                    &sat,
                    format!("physics bodies need a record or a list of records, but state '{sname}' is {}", tyname(t)),
                    Some(BODY_TYPE_EXAMPLE.into()),
                );
                return None;
            }
        };
        let mut ok = true;
        let mut field = |ck: &mut Checker, f: &str, required: bool| -> Option<FieldIdx> {
            match rt.index_of(f) {
                Some(i) if rt.fields[i].1 == Type::Float => Some(i as FieldIdx),
                Some(i) => {
                    let found = rt.fields[i].1.clone();
                    ck.phys_err(
                        &sat,
                        format!("field '{f}' of state '{sname}' must be float for physics, found {}", tyname(&found)),
                        Some(format!("declare it as \"{f}\": \"float\"")),
                    );
                    ok = false;
                    None
                }
                None => {
                    if required {
                        ck.phys_err(
                            &sat,
                            format!("state '{sname}' has no field '{f}'; body records need float fields x and y (the center)"),
                            Some(BODY_TYPE_EXAMPLE.into()),
                        );
                        ok = false;
                    }
                    None
                }
            }
        };
        let x = field(self, "x", true);
        let y = field(self, "y", true);
        let vx = field(self, "vx", false);
        let vy = field(self, "vy", false);
        let shape = if rt.index_of("r").is_some() {
            field(self, "r", true).map(|r| BodyShape::Circle { r })
        } else if rt.index_of("w").is_some() || rt.index_of("h").is_some() {
            let w = field(self, "w", true);
            let h = field(self, "h", true);
            match (w, h) {
                (Some(w), Some(h)) => Some(BodyShape::Rect { w, h }),
                _ => None,
            }
        } else {
            self.phys_err(
                &sat,
                format!("state '{sname}' records have no shape: add a float field 'r' (circle) or 'w' and 'h' (box)"),
                Some(BODY_TYPE_EXAMPLE.into()),
            );
            None
        };
        let gravity_scale = self.phys_num(m, "gravity", at, f64::MIN, f64::MAX, "a number (gravity scale)");
        let is_static = self.phys_bool(m, "static", at).unwrap_or(false);
        let bounded = self.phys_bool(m, "bounded", at).unwrap_or(false);
        let bounce = self.phys_num(m, "bounce", at, 0.0, 1.0, "a number from 0 to 1").unwrap_or(0.0);
        let max_speed = self.phys_num(m, "max_speed", at, f64::MIN_POSITIVE, f64::MAX, "a positive number");
        if bounded && !has_bounds {
            self.phys_err(&ptr(at, "bounded"), "\"bounded\": true needs physics.bounds", Some(bounds_hint.into()));
        }
        let (x, y, shape) = (x?, y?, shape?);
        if !ok {
            return None;
        }
        Some(BodyGroup {
            name: Rc::from(name),
            state: sid,
            is_list,
            x,
            y,
            vx,
            vy,
            shape,
            gravity_scale: gravity_scale.unwrap_or(if vy.is_some() { 1.0 } else { 0.0 }),
            is_static,
            bounded,
            bounce,
            max_speed,
        })
    }

    fn group_ref(&mut self, m: &Obj, key: &str, at: &str, groups: &[GroupInfo]) -> Option<u16> {
        let kat = ptr(at, key);
        let name = match m.get(key) {
            Some(J::String(s)) => s.as_str(),
            Some(other) => {
                self.phys_err(&kat, format!("'{key}' must be a body group name, found {}", json_kind(other)), None);
                return None;
            }
            None => {
                self.phys_err(at, format!("missing '{key}': a body group name"), None);
                return None;
            }
        };
        if let Some(i) = groups.iter().position(|g| &*g.name == name) {
            return Some(i as u16);
        }
        let hint = dym(name, groups.iter().map(|g| &*g.name)).or_else(|| {
            if groups.is_empty() {
                Some("declare it under physics.bodies".to_string())
            } else {
                Some(format!("body groups: {}", groups.iter().map(|g| &*g.name).collect::<Vec<_>>().join(", ")))
            }
        });
        self.phys_err(&kat, format!("unknown body group '{name}'"), hint);
        None
    }

    /// The event emitted by a collision (`allow_b`) or an `on_bounds` entry.
    fn physics_emit(&mut self, v: &J, at: &str, allow_b: bool) -> Option<PhysicsEmit> {
        let name = match v {
            J::String(s) => s.as_str(),
            other => {
                self.phys_err(at, format!("'emit' must be an event name, found {}", json_kind(other)), None);
                return None;
            }
        };
        let Some(&id) = self.event_idx.get(name) else {
            if self.input_idx.contains_key(name) {
                self.err_at(
                    Code::UnknownEvent,
                    at,
                    format!("'{name}' is an input; physics can only emit custom events (declared under \"events\")"),
                    None,
                );
            } else {
                let hint = dym(name, self.events.iter().map(|(n, _)| &**n)).or_else(|| {
                    let fields = if allow_b { "{\"a\": \"int\", \"b\": \"int\"}" } else { "{\"a\": \"int\"}" };
                    Some(format!("declare it under \"events\", like \"{name}\": {fields}"))
                });
                self.err_at(Code::UnknownEvent, at, format!("unknown event '{name}'"), hint);
            }
            return None;
        };
        self.emitted[id as usize] = true;
        let payload = self.events[id as usize].1.clone();
        let mut fields = Vec::with_capacity(payload.len());
        let mut ok = true;
        let allowed = if allow_b { "a, b, nx and ny" } else { "a, nx and ny" };
        for (n, t) in payload.iter() {
            let (cf, want) = match &**n {
                "a" => (ContactField::A, Type::Int),
                "b" if allow_b => (ContactField::B, Type::Int),
                "nx" => (ContactField::Nx, Type::Float),
                "ny" => (ContactField::Ny, Type::Float),
                "b" => {
                    self.err_at(
                        Code::BadPayload,
                        at,
                        format!("event '{name}' has payload field 'b', but on_bounds events have no second body"),
                        Some(format!("remove 'b' from events.{name}; on_bounds fills {allowed}")),
                    );
                    ok = false;
                    continue;
                }
                other => {
                    self.err_at(
                        Code::BadPayload,
                        at,
                        format!("event '{name}' has payload field '{other}', but physics can only fill {allowed}"),
                        Some(format!("remove '{other}' from events.{name}, or emit another event from a rule that reacts to '{name}'")),
                    );
                    ok = false;
                    continue;
                }
            };
            if *t != want {
                let what = if want == Type::Int { "the body index" } else { "the contact normal" };
                self.err_at(
                    Code::BadPayload,
                    at,
                    format!("payload field '{n}' of event '{name}' must be {want} ({what}), found {}", tyname(t)),
                    Some(format!("declare it as \"{n}\": \"{want}\" in events.{name}")),
                );
                ok = false;
            }
            fields.push(cf);
        }
        ok.then_some(PhysicsEmit { event: id, fields })
    }
}
