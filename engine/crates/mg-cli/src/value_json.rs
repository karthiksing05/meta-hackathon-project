//! JSON → typed `Value`, for replay scripts that send an input directly:
//! `{"t": 0, "input": "tap_cell", "with": {"cell": [2, 3]}}`.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use mg_core::types::Type;
use mg_core::value::Value;
use serde_json::Value as J;

/// ivec2/vec2: `[x, y]` or `{"x": .., "y": ..}`. grid: `{"w", "h", "cells"}`
/// or an array of rows. map: `[[k, v], ...]` or an object (string keys).
/// Optional: `null` is none. Records: an object with every field.
pub fn json_to_value(j: &J, ty: &Type) -> Result<Value, String> {
    let bad = || format!("expected {ty}, found {j}");
    Ok(match ty {
        Type::Bool => Value::Bool(j.as_bool().ok_or_else(bad)?),
        Type::Int => Value::Int(j.as_i64().ok_or_else(bad)?),
        Type::Float => Value::Float(j.as_f64().ok_or_else(bad)?),
        Type::Str => Value::str(j.as_str().ok_or_else(bad)?),
        Type::Enum(members) => {
            let s = j.as_str().ok_or_else(bad)?;
            if !members.iter().any(|m| &**m == s) {
                return Err(format!("'{s}' is not one of {ty}"));
            }
            Value::str(s)
        }
        Type::IVec2 => {
            let (x, y) = pair(j).ok_or_else(bad)?;
            let (x, y) = (x.as_i64().ok_or_else(bad)?, y.as_i64().ok_or_else(bad)?);
            Value::IVec2(i32::try_from(x).map_err(|_| bad())?, i32::try_from(y).map_err(|_| bad())?)
        }
        Type::Vec2 => {
            let (x, y) = pair(j).ok_or_else(bad)?;
            Value::Vec2(x.as_f64().ok_or_else(bad)?, y.as_f64().ok_or_else(bad)?)
        }
        Type::List(t) => {
            let items = j.as_array().ok_or_else(bad)?;
            Value::list(items.iter().map(|x| json_to_value(x, t)).collect::<Result<_, _>>()?)
        }
        Type::Set(t) => {
            let items = j.as_array().ok_or_else(bad)?;
            let set: BTreeSet<Value> = items.iter().map(|x| json_to_value(x, t)).collect::<Result<_, _>>()?;
            Value::Set(Rc::new(set))
        }
        Type::Map(k, v) => {
            let mut m = BTreeMap::new();
            match j {
                J::Object(o) => {
                    for (key, val) in o {
                        m.insert(json_to_value(&J::String(key.clone()), k)?, json_to_value(val, v)?);
                    }
                }
                J::Array(items) => {
                    for it in items {
                        let (key, val) = pair(it).ok_or_else(bad)?;
                        m.insert(json_to_value(key, k)?, json_to_value(val, v)?);
                    }
                }
                _ => return Err(bad()),
            }
            Value::Map(Rc::new(m))
        }
        Type::Grid(t) => {
            if let Some(rows) = j.as_array() {
                let h = rows.len();
                let w = rows.first().and_then(|r| r.as_array()).map_or(0, |r| r.len());
                let mut cells = Vec::with_capacity(w * h);
                for r in rows {
                    let r = r.as_array().filter(|r| r.len() == w).ok_or_else(bad)?;
                    for c in r {
                        cells.push(json_to_value(c, t)?);
                    }
                }
                Value::grid(w as i32, h as i32, cells)
            } else {
                let w = j.get("w").and_then(J::as_i64).ok_or_else(bad)?;
                let h = j.get("h").and_then(J::as_i64).ok_or_else(bad)?;
                let cells = j.get("cells").and_then(J::as_array).ok_or_else(bad)?;
                if w < 0 || h < 0 || cells.len() as i64 != w * h {
                    return Err(format!("grid cells must have w*h = {} items", w * h));
                }
                Value::grid(w as i32, h as i32, cells.iter().map(|c| json_to_value(c, t)).collect::<Result<_, _>>()?)
            }
        }
        Type::Option(t) => {
            if j.is_null() {
                Value::None
            } else {
                json_to_value(j, t)?
            }
        }
        Type::Record(rt) => {
            let o = j.as_object().ok_or_else(bad)?;
            for k in o.keys() {
                if rt.index_of(k).is_none() {
                    return Err(format!("unknown field '{k}' for {ty}"));
                }
            }
            let mut fields = Vec::with_capacity(rt.fields.len());
            for (name, fty) in &rt.fields {
                match o.get(&**name) {
                    Some(v) => fields.push(json_to_value(v, fty)?),
                    None if matches!(fty, Type::Option(_)) => fields.push(Value::None),
                    None => return Err(format!("missing field '{name}'")),
                }
            }
            Value::record(fields)
        }
        Type::Unknown => return Err("cannot build a value of unknown type".into()),
    })
}

fn pair(j: &J) -> Option<(&J, &J)> {
    match j {
        J::Array(a) if a.len() == 2 => Some((&a[0], &a[1])),
        J::Object(o) => Some((o.get("x")?, o.get("y")?)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn converts() {
        assert_eq!(json_to_value(&json!([2, 3]), &Type::IVec2).unwrap(), Value::IVec2(2, 3));
        assert_eq!(json_to_value(&json!(2), &Type::Float).unwrap(), Value::Float(2.0));
        assert!(json_to_value(&json!(true), &Type::Int).is_err());
        let g = json_to_value(&json!([[1, 2], [3, 4]]), &Type::grid(Type::Int)).unwrap();
        assert_eq!(g, Value::grid(2, 2, vec![Value::Int(1), Value::Int(2), Value::Int(3), Value::Int(4)]));
        let rt = Type::record(vec![(Rc::from("b"), Type::Int), (Rc::from("a"), Type::Bool)]);
        let r = json_to_value(&json!({"b": 1, "a": true}), &rt).unwrap();
        assert_eq!(r, Value::record(vec![Value::Bool(true), Value::Int(1)]));
    }
}
