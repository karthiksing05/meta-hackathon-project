//! v0.2 assets (SPEC-v0.2 §1): validation, dense ids, and checks of asset
//! references by name.

use std::rc::Rc;

use mg_core::diag::Code;
use mg_core::ir::{Asset, AssetKind, AssetSrc};
use mg_core::limits::{MAX_ASSETS, MAX_DATA_URI_BYTES, MAX_SVG_BYTES};
use serde_json::{Map, Value as J};

use crate::check::{dym, Checker};
use crate::{is_ident, json_kind, ptr};

const SOURCES: &[&str] = &["svg", "image", "sound"];
const IMAGE_KEYS: &[&str] = &["svg", "image", "sound", "w", "h", "frames", "cols", "fps"];

/// What an asset can be used as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AssetUse {
    Image,
    Sound,
}

impl AssetUse {
    fn what(self) -> &'static str {
        match self {
            AssetUse::Image => "an image",
            AssetUse::Sound => "a sound",
        }
    }
}

fn kb(n: usize) -> String {
    format!("{} KB", n.div_ceil(1024))
}

impl Checker {
    fn asset_err(&mut self, at: &str, msg: impl Into<String>, hint: Option<String>) {
        self.err_at(Code::Asset, at, msg, hint);
    }

    /// Declares and validates the `assets` section. Assets with errors are
    /// still declared (with an unknown kind), so references to them don't
    /// produce follow-on errors.
    pub fn assets(&mut self, v: Option<&J>) -> Vec<Asset> {
        let mut out = Vec::new();
        let Some(v) = v else { return out };
        let J::Object(m) = v else {
            self.asset_err("/assets", format!("assets must be an object of id → asset, found {}", json_kind(v)), None);
            return out;
        };
        if m.len() > MAX_ASSETS {
            self.asset_err("/assets", format!("too many assets: {} (the limit is {MAX_ASSETS})", m.len()), None);
        }
        out.reserve(m.len());
        for (k, av) in m {
            let at = ptr("/assets", k);
            if !is_ident(k) {
                self.asset_err(
                    &at,
                    format!("asset id '{k}' is not a valid name"),
                    Some("ids use letters, digits and '_', start with a letter, and aren't keywords".into()),
                );
                continue;
            }
            let name: Rc<str> = Rc::from(k.as_str());
            let (asset, kind) = match self.asset(av, &at, &name) {
                Some(a) => {
                    let u = match a.kind {
                        AssetKind::Image { .. } => AssetUse::Image,
                        AssetKind::Sound { .. } => AssetUse::Sound,
                    };
                    (Some(a), Some(u))
                }
                None => (None, None),
            };
            let id = self.assets.len() as u16;
            self.asset_idx.insert(name.clone(), id);
            self.assets.push((name, kind));
            // A broken asset never reaches a program (the game has errors).
            out.push(asset.unwrap_or(Asset { name: Rc::from(k.as_str()), kind: AssetKind::Sound { src: AssetSrc::Url(Rc::from("")) } }));
        }
        out
    }

    fn asset(&mut self, v: &J, at: &str, name: &Rc<str>) -> Option<Asset> {
        let J::Object(o) = v else {
            self.asset_err(
                at,
                format!("an asset must be an object, found {}", json_kind(v)),
                Some("like {\"svg\": \"<svg ...>...</svg>\", \"w\": 32, \"h\": 32} or {\"sound\": \"https://...\"}".into()),
            );
            return None;
        };
        for key in o.keys() {
            if key.starts_with('_') || IMAGE_KEYS.contains(&key.as_str()) {
                continue;
            }
            let hint = dym(key, IMAGE_KEYS.iter().copied()).or_else(|| Some(format!("allowed keys: {}", IMAGE_KEYS.join(", "))));
            self.asset_err(&ptr(at, key), format!("unknown key '{key}' in asset '{name}'"), hint);
        }
        let srcs: Vec<&str> = SOURCES.iter().copied().filter(|s| o.contains_key(*s)).collect();
        let kind = match srcs.as_slice() {
            [] => {
                self.asset_err(
                    at,
                    format!("asset '{name}' needs one of 'svg', 'image' or 'sound'"),
                    Some("svg: inline markup; image: an https:// or data:image/ URL; sound: an https:// or data:audio/ URL".into()),
                );
                return None;
            }
            [one] => *one,
            [first, second, ..] => {
                self.asset_err(
                    &ptr(at, second),
                    format!("asset '{name}' has both '{first}' and '{second}'; an asset has exactly one source"),
                    Some("split it into two assets".into()),
                );
                return None;
            }
        };
        let sat = ptr(at, kind);
        let src = match &o[kind] {
            J::String(s) => s.as_str(),
            other => {
                self.asset_err(&sat, format!("'{kind}' must be a string, found {}", json_kind(other)), None);
                return None;
            }
        };
        let mut ok = true;
        let src = match kind {
            "svg" => {
                if !src.trim_start().starts_with("<svg") {
                    let hint = if src.trim_start().starts_with("<?xml") {
                        "remove the <?xml ...?> header; the markup must start with <svg"
                    } else if src.starts_with("https://") || src.starts_with("data:") {
                        "for a URL use \"image\" instead of \"svg\""
                    } else {
                        "inline SVG markup, like \"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>...</svg>\""
                    };
                    self.asset_err(&sat, "an 'svg' asset must be SVG markup starting with '<svg'", Some(hint.into()));
                    ok = false;
                } else if src.len() > MAX_SVG_BYTES {
                    self.asset_err(
                        &sat,
                        format!("this SVG is {}; the limit is {}", kb(src.len()), kb(MAX_SVG_BYTES)),
                        Some("simplify the drawing (fewer paths, shorter numbers)".into()),
                    );
                    ok = false;
                }
                AssetSrc::Svg(Rc::from(src))
            }
            _ => {
                let (prefix, what) = if kind == "image" { ("data:image/", "image") } else { ("data:audio/", "audio") };
                if src.starts_with("data:") {
                    if !src.starts_with(prefix) {
                        self.asset_err(
                            &sat,
                            format!("a '{kind}' data URI must start with '{prefix}'"),
                            Some(if kind == "image" {
                                "a sound goes under \"sound\"; an image data URI looks like data:image/png;base64,...".into()
                            } else {
                                "an image goes under \"image\"; a sound data URI looks like data:audio/wav;base64,...".into()
                            }),
                        );
                        ok = false;
                    } else if src.len() > MAX_DATA_URI_BYTES {
                        self.asset_err(
                            &sat,
                            format!("this data URI is {}; the limit is {}", kb(src.len()), kb(MAX_DATA_URI_BYTES)),
                            Some("use a smaller file, or an https:// URL".into()),
                        );
                        ok = false;
                    }
                } else if !src.starts_with("https://") || src.len() <= "https://".len() {
                    let hint = if src.starts_with("http://") {
                        "use https:// (plain http:// isn't loaded)".to_string()
                    } else if kind == "image" && src.trim_start().starts_with("<svg") {
                        "for inline markup use \"svg\" instead of \"image\"".to_string()
                    } else {
                        format!("use an https:// URL or a {prefix}... URI with the {what} data")
                    };
                    self.asset_err(&sat, format!("'{kind}' must be an https:// URL or a {prefix} URI"), Some(hint));
                    ok = false;
                }
                AssetSrc::Url(Rc::from(src))
            }
        };
        if kind == "sound" {
            for key in ["w", "h", "frames", "cols", "fps"] {
                if o.contains_key(key) {
                    self.asset_err(&ptr(at, key), format!("sound asset '{name}' can't have '{key}'"), Some("only images have a size and frames".into()));
                    ok = false;
                }
            }
            return ok.then(|| Asset { name: name.clone(), kind: AssetKind::Sound { src } });
        }
        let w = self.asset_size(o, "w", at, name);
        let h = self.asset_size(o, "h", at, name);
        let frames = self.asset_count(o, "frames", at, 1);
        let cols = self.asset_count(o, "cols", at, frames.unwrap_or(1));
        let fps = match o.get("fps") {
            None => Some(0.0),
            Some(J::Number(n)) if n.as_f64().is_some_and(|x| x >= 0.0) => n.as_f64(),
            Some(other) => {
                self.asset_err(&ptr(at, "fps"), format!("'fps' must be a number >= 0, found {other}"), None);
                None
            }
        };
        let (Some(w), Some(h), Some(frames), Some(cols), Some(fps), true) = (w, h, frames, cols, fps, ok) else { return None };
        Some(Asset { name: name.clone(), kind: AssetKind::Image { src, w, h, frames, cols, fps } })
    }

    fn asset_size(&mut self, o: &Map<String, J>, key: &str, at: &str, name: &str) -> Option<f64> {
        match o.get(key) {
            Some(J::Number(n)) if n.as_f64().is_some_and(|x| x > 0.0 && x.is_finite()) => n.as_f64(),
            Some(other) => {
                self.asset_err(&ptr(at, key), format!("'{key}' must be a positive number, found {other}"), None);
                None
            }
            None => {
                self.asset_err(
                    at,
                    format!("image asset '{name}' is missing '{key}'"),
                    Some("images need \"w\" and \"h\": the size of one frame in canvas units".into()),
                );
                None
            }
        }
    }

    fn asset_count(&mut self, o: &Map<String, J>, key: &str, at: &str, default: u16) -> Option<u16> {
        match o.get(key) {
            None => Some(default),
            Some(J::Number(n)) if n.as_u64().is_some_and(|x| (1..=u16::MAX as u64).contains(&x)) => Some(n.as_u64().unwrap() as u16),
            Some(other) => {
                self.asset_err(&ptr(at, key), format!("'{key}' must be a whole number >= 1, found {other}"), None);
                None
            }
        }
    }

    /// Checks a literal asset name used as `want` (image node, sound, music).
    pub fn check_asset_name(&mut self, name: &str, at: &str, want: AssetUse) {
        if let Some(&id) = self.asset_idx.get(name) {
            let have = self.assets[id as usize].1;
            if let Some(have) = have.filter(|h| *h != want) {
                let hint = self.asset_hint(name, want);
                self.asset_err(at, format!("asset '{name}' is {}, not {}", have.what(), want.what()), hint);
            }
            return;
        }
        let hint = dym(name, self.assets.iter().filter(|(_, k)| k.is_none_or(|k| k == want)).map(|(n, _)| &**n))
            .or_else(|| self.asset_hint(name, want));
        self.asset_err(at, format!("unknown asset '{name}'"), hint);
    }

    fn asset_hint(&self, name: &str, want: AssetUse) -> Option<String> {
        let of_kind: Vec<&str> = self.assets.iter().filter(|(n, k)| *k == Some(want) && &**n != name).map(|(n, _)| &**n).collect();
        if of_kind.is_empty() {
            let ex = match want {
                AssetUse::Image => "{\"svg\": \"<svg ...>...</svg>\", \"w\": 32, \"h\": 32}",
                AssetUse::Sound => "{\"sound\": \"https://...\"}",
            };
            Some(format!("declare {} asset under \"assets\", like \"{name}\": {ex}", want.what()))
        } else {
            Some(format!("{} assets: {}", if want == AssetUse::Image { "image" } else { "sound" }, of_kind.join(", ")))
        }
    }
}
