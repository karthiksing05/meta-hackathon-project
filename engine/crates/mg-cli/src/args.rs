//! Hand-rolled argument parsing: positionals, `--name value`, `--name=value`
//! and boolean `--switch`es.

use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;

#[derive(Debug, Default)]
pub struct Args {
    pub pos: Vec<String>,
    pub opts: BTreeMap<String, String>,
    pub switches: BTreeSet<String>,
}

/// `with_value`: options that take a value. `switches`: boolean flags.
/// Names are given without the leading `--`.
pub fn parse(argv: &[String], with_value: &[&str], switches: &[&str]) -> Result<Args, String> {
    let mut a = Args::default();
    let mut i = 0;
    while i < argv.len() {
        let arg = &argv[i];
        if let Some(name) = arg.strip_prefix("--") {
            let (name, inline) = match name.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (name, None),
            };
            if with_value.contains(&name) {
                let v = match inline {
                    Some(v) => v,
                    None => {
                        i += 1;
                        argv.get(i).cloned().ok_or_else(|| format!("--{name} needs a value"))?
                    }
                };
                a.opts.insert(name.to_string(), v);
            } else if switches.contains(&name) {
                if inline.is_some() {
                    return Err(format!("--{name} takes no value"));
                }
                a.switches.insert(name.to_string());
            } else {
                return Err(format!("unknown option --{name}"));
            }
        } else if arg.len() > 1 && arg.starts_with('-') && arg.parse::<f64>().is_err() {
            return Err(format!("unknown option {arg}"));
        } else {
            a.pos.push(arg.clone());
        }
        i += 1;
    }
    Ok(a)
}

impl Args {
    pub fn get<T: FromStr>(&self, name: &str) -> Result<Option<T>, String> {
        match self.opts.get(name) {
            None => Ok(None),
            Some(v) => v.parse().map(Some).map_err(|_| format!("--{name}: invalid value '{v}'")),
        }
    }

    pub fn get_or<T: FromStr>(&self, name: &str, default: T) -> Result<T, String> {
        Ok(self.get(name)?.unwrap_or(default))
    }

    pub fn has(&self, name: &str) -> bool {
        self.switches.contains(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }
    #[test]
    fn parses() {
        let a = parse(&v(&["g.json", "--seed", "3", "--dt=8.5", "--json"]), &["seed", "dt"], &["json"]).unwrap();
        assert_eq!(a.pos, vec!["g.json"]);
        assert_eq!(a.get_or("seed", 0u64).unwrap(), 3);
        assert_eq!(a.get_or("dt", 16.0f64).unwrap(), 8.5);
        assert!(a.has("json"));
        assert!(parse(&v(&["--nope"]), &[], &[]).is_err());
        assert!(parse(&v(&["--seed"]), &["seed"], &[]).is_err());
        assert!(a.get::<u64>("dt").is_err());
    }
}
