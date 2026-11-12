//! JSON parsing that also reports duplicate object keys (serde_json keeps
//! the last one silently, which would hide mistakes like two `"score"`
//! state entries). Produces a normal `serde_json::Value` in file order.

use std::cell::RefCell;
use std::fmt;

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value as J};

use crate::ptr;

struct Seed<'a> {
    path: String,
    dups: &'a RefCell<Vec<String>>,
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = J;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<J, D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = J;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }
    fn visit_bool<E>(self, v: bool) -> Result<J, E> {
        Ok(J::Bool(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<J, E> {
        Ok(J::from(v))
    }
    fn visit_u64<E>(self, v: u64) -> Result<J, E> {
        Ok(J::from(v))
    }
    fn visit_f64<E>(self, v: f64) -> Result<J, E> {
        Ok(serde_json::Number::from_f64(v).map(J::Number).unwrap_or(J::Null))
    }
    fn visit_str<E>(self, v: &str) -> Result<J, E> {
        Ok(J::String(v.to_owned()))
    }
    fn visit_string<E>(self, v: String) -> Result<J, E> {
        Ok(J::String(v))
    }
    fn visit_unit<E>(self) -> Result<J, E> {
        Ok(J::Null)
    }
    fn visit_none<E>(self) -> Result<J, E> {
        Ok(J::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<J, A::Error> {
        let mut v = Vec::new();
        while let Some(x) = a.next_element_seed(Seed { path: ptr(&self.path, &v.len().to_string()), dups: self.dups })? {
            v.push(x);
        }
        Ok(J::Array(v))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<J, A::Error> {
        let mut m = Map::new();
        while let Some(k) = a.next_key::<String>()? {
            let p = ptr(&self.path, &k);
            let v = a.next_value_seed(Seed { path: p.clone(), dups: self.dups })?;
            if m.insert(k, v).is_some() {
                self.dups.borrow_mut().push(p);
            }
        }
        Ok(J::Object(m))
    }
}

/// Parses JSON; returns the value and the pointers of duplicated keys.
pub fn parse(src: &str) -> Result<(J, Vec<String>), serde_json::Error> {
    let dups = RefCell::new(Vec::new());
    let mut de = serde_json::Deserializer::from_str(src);
    let v = Seed { path: String::new(), dups: &dups }.deserialize(&mut de)?;
    de.end()?;
    Ok((v, dups.into_inner()))
}
