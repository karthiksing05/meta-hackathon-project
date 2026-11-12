//! Board-style concepts: tiles (match-3, merge, slide), cards (memory), words, timelines and pad sequences.

use super::world::{Ent, W};
use super::{bad, good, num, pick_item};
use crate::concepts::{Params, System};
use crate::game::Game;
use crate::rng::Rng;
use crate::types::Event;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

const FRUIT: [&str; 8] = ["🍎", "🍋", "🍇", "🍓", "🥝", "🍊", "🍑", "🫐"];

// ------------------------------------------------------------------ tiles

fn read_board(g: &Game) -> Vec<i64> {
    let mut b = vec![-1; (g.world.cols * g.world.rows).max(0) as usize];
    for e in g.world.ents.iter().filter(|e| e.role == "tile" && e.cell >= 0) {
        if let Some(c) = b.get_mut(e.cell as usize) {
            *c = e.tag;
        }
    }
    b
}

fn write_board(g: &mut Game, board: &[i64]) {
    g.world.clear_role("tile");
    let merge = g.world.has("merge");
    let (_, _, s) = g.world.grid_geom();
    let cols = g.world.cols.max(1);
    for (i, t) in board.iter().enumerate() {
        if *t < 0 {
            continue;
        }
        let (x, y) = g.world.cell_center(i as i64 % cols, i as i64 / cols);
        let label = if merge { t.to_string() } else { FRUIT[*t as usize % FRUIT.len()].to_string() };
        let mut e = Ent::new("tile", &label, x, y, s / 2.0 - 3.0);
        e.cell = i as i64;
        e.tag = *t;
        e.kind = "tile".into();
        g.world.add(e);
    }
}

fn find_runs(board: &[i64], cols: i64, rows: i64, min_run: i64) -> Vec<Vec<usize>> {
    let mut runs = Vec::new();
    let at = |c: i64, r: i64| board[(r * cols + c) as usize];
    for r in 0..rows {
        let mut c = 0;
        while c < cols {
            let k = at(c, r);
            let mut e = c;
            while e + 1 < cols && at(e + 1, r) == k {
                e += 1;
            }
            if k >= 0 && e - c + 1 >= min_run {
                runs.push((c..=e).map(|x| (r * cols + x) as usize).collect());
            }
            c = e + 1;
        }
    }
    for c in 0..cols {
        let mut r = 0;
        while r < rows {
            let k = at(c, r);
            let mut e = r;
            while e + 1 < rows && at(c, e + 1) == k {
                e += 1;
            }
            if k >= 0 && e - r + 1 >= min_run {
                runs.push((r..=e).map(|y| (y * cols + c) as usize).collect());
            }
            r = e + 1;
        }
    }
    runs
}

fn has_move(board: &[i64], cols: i64, rows: i64, min_run: i64) -> bool {
    let mut b = board.to_vec();
    for r in 0..rows {
        for c in 0..cols {
            let i = (r * cols + c) as usize;
            for j in [(c + 1 < cols).then(|| i + 1), (r + 1 < rows).then(|| i + cols as usize)].into_iter().flatten() {
                if b[i] < 0 || b[j] < 0 {
                    continue;
                }
                b.swap(i, j);
                let any = !find_runs(&b, cols, rows, min_run).is_empty();
                b.swap(i, j);
                if any {
                    return true;
                }
            }
        }
    }
    false
}

fn shuffle_solvable(board: &mut [i64], cols: i64, rows: i64, min_run: i64, rng: &mut Rng) {
    for _ in 0..40 {
        rng.shuffle(board);
        if find_runs(board, cols, rows, min_run).is_empty() && has_move(board, cols, rows, min_run) {
            return;
        }
    }
}

fn min_run(g: &Game) -> i64 {
    g.world.secret.get("min_run").and_then(Value::as_i64).unwrap_or(3)
}

fn kinds(g: &Game) -> i64 {
    g.world.secret.get("kinds").and_then(Value::as_i64).unwrap_or(5)
}

fn fill_tiles(g: &mut Game) {
    let (cols, rows) = (g.world.cols.max(1), g.world.rows.max(1));
    let n = (cols * rows) as usize;
    let mut board = vec![-1i64; n];
    if g.world.has("merge") {
        let base = g.world.secret.get("merge_to").and_then(Value::as_i64).unwrap_or(2);
        for _ in 0..2 {
            let free: Vec<usize> = (0..n).filter(|i| board[*i] < 0).collect();
            let i = free[g.rng.below(free.len() as u32) as usize];
            board[i] = base;
        }
    } else {
        let k = kinds(g);
        for i in 0..n {
            let (c, r) = (i as i64 % cols, i as i64 / cols);
            for _ in 0..12 {
                let v = g.rng.below(k as u32) as i64;
                let h = c >= 2 && board[i - 1] == v && board[i - 2] == v;
                let w = r >= 2 && board[i - cols as usize] == v && board[i - 2 * cols as usize] == v;
                board[i] = v;
                if !h && !w {
                    break;
                }
            }
        }
        if g.world.has("shuffle_tiles") {
            let mr = min_run(g);
            shuffle_solvable(&mut board, cols, rows, mr, &mut g.rng);
        }
    }
    write_board(g, &board);
    let count = board.iter().filter(|t| **t >= 0).count();
    g.emit("entity.spawned", json!({ "kind": "tile", "role": "tile", "count": count }));
}

pub struct TileSys {
    pub kinds: i64,
}
impl System for TileSys {
    fn id(&self) -> &'static str {
        "entity.tile"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("tiles");
        g.world.secret.insert("kinds".into(), json!(self.kinds));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => fill_tiles(g),
            "level.started" if ev.data["level"].as_i64().unwrap_or(1) > 1 => fill_tiles(g),
            _ => {}
        }
    }
}

pub struct ShuffleTiles;
impl System for ShuffleTiles {
    fn id(&self) -> &'static str {
        "behavior.shuffle_tiles"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("shuffle_tiles");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "session.started" && !g.world.has("merge") && g.world.count("tile") > 0 {
            let mut board = read_board(g);
            let (c, r, mr) = (g.world.cols, g.world.rows, min_run(g));
            shuffle_solvable(&mut board, c, r, mr, &mut g.rng);
            write_board(g, &board);
        }
    }
}

pub struct MatchThree {
    pub min_run: i64,
}
impl MatchThree {
    fn cascade(&self, g: &mut Game, board: &mut Vec<i64>) {
        let (cols, rows) = (g.world.cols, g.world.rows);
        let k = kinds(g) as u32;
        for _ in 0..12 {
            let runs = find_runs(board, cols, rows, self.min_run);
            if runs.is_empty() {
                break;
            }
            let mut gone = vec![false; board.len()];
            for run in &runs {
                g.emit("match.made", json!({ "kind": board[run[0]].to_string(), "count": run.len() }));
                good(g);
                if run.len() as i64 > self.min_run {
                    good(g);
                }
                for i in run {
                    gone[*i] = true;
                }
            }
            for c in 0..cols {
                let mut col: Vec<i64> = (0..rows).rev().map(|r| (r * cols + c) as usize).filter(|i| !gone[*i]).map(|i| board[i]).collect();
                while (col.len() as i64) < rows {
                    col.push(g.rng.below(k) as i64);
                }
                for (j, v) in col.into_iter().enumerate() {
                    board[((rows - 1 - j as i64) * cols + c) as usize] = v;
                }
            }
        }
        if !has_move(board, cols, rows, self.min_run) {
            shuffle_solvable(board, cols, rows, self.min_run, &mut g.rng);
            g.world.toast("Shuffled!");
        }
    }
}
impl System for MatchThree {
    fn id(&self) -> &'static str {
        "rule.match_three"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.secret.insert("min_run".into(), json!(self.min_run));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.swipe" || g.world.has("merge") || g.world.count("tile") == 0 {
            return;
        }
        let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
        let Some((c, r)) = g.world.cell_of(x, y) else { return };
        let (dc, dr) = match ev.data["dir"].as_str() {
            Some("left") => (-1, 0),
            Some("right") => (1, 0),
            Some("up") => (0, -1),
            Some("down") => (0, 1),
            _ => return,
        };
        let (c2, r2) = (c + dc, r + dr);
        let (cols, rows) = (g.world.cols, g.world.rows);
        if c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows {
            return;
        }
        let mut board = read_board(g);
        let (a, b) = ((r * cols + c) as usize, (r2 * cols + c2) as usize);
        board.swap(a, b);
        if find_runs(&board, cols, rows, self.min_run).is_empty() {
            g.emit("match.failed", json!({}));
            return;
        }
        self.cascade(g, &mut board);
        write_board(g, &board);
    }
}

pub struct MergeAdjacent {
    pub merge_to: i64,
}
fn line_indices(cols: i64, rows: i64, dir: &str) -> Vec<Vec<usize>> {
    let mut lines = Vec::new();
    match dir {
        "left" | "right" => {
            for r in 0..rows {
                let mut l: Vec<usize> = (0..cols).map(|c| (r * cols + c) as usize).collect();
                if dir == "right" {
                    l.reverse();
                }
                lines.push(l);
            }
        }
        _ => {
            for c in 0..cols {
                let mut l: Vec<usize> = (0..rows).map(|r| (r * cols + c) as usize).collect();
                if dir == "down" {
                    l.reverse();
                }
                lines.push(l);
            }
        }
    }
    lines
}

fn slide_board(board: &mut [i64], cols: i64, rows: i64, dir: &str, merge_to: i64) -> Vec<i64> {
    let mut merged = Vec::new();
    for line in line_indices(cols, rows, dir) {
        let vals: Vec<i64> = line.iter().map(|i| board[*i]).filter(|v| *v >= 0).collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < vals.len() {
            let run = (i..vals.len().min(i + merge_to as usize)).take_while(|j| vals[*j] == vals[i]).count();
            if run as i64 == merge_to {
                out.push(vals[i] * merge_to);
                merged.push(vals[i] * merge_to);
                i += merge_to as usize;
            } else {
                out.push(vals[i]);
                i += 1;
            }
        }
        for (k, idx) in line.iter().enumerate() {
            board[*idx] = out.get(k).copied().unwrap_or(-1);
        }
    }
    merged
}

impl System for MergeAdjacent {
    fn id(&self) -> &'static str {
        "behavior.merge_adjacent"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("merge");
        g.world.secret.insert("merge_to".into(), json!(self.merge_to));
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.swipe" || g.world.count("tile") == 0 {
            return;
        }
        let Some(dir) = ev.data["dir"].as_str() else { return };
        let (cols, rows) = (g.world.cols, g.world.rows);
        let mut board = read_board(g);
        let before = board.clone();
        let merged = slide_board(&mut board, cols, rows, dir, self.merge_to);
        if board == before {
            return;
        }
        for v in &merged {
            g.emit("match.made", json!({ "kind": v.to_string(), "value": v }));
            good(g);
        }
        let free: Vec<usize> = (0..board.len()).filter(|i| board[*i] < 0).collect();
        if !free.is_empty() {
            let i = free[g.rng.below(free.len() as u32) as usize];
            board[i] = if g.rng.below(10) == 0 { self.merge_to * self.merge_to } else { self.merge_to };
        }
        write_board(g, &board);
        let best = board.iter().copied().max().unwrap_or(0);
        g.hud_set("best_tile", json!(best));
        let stuck = !board.iter().any(|v| *v < 0)
            && ["left", "right", "up", "down"].iter().all(|d| {
                let mut b = board.clone();
                slide_board(&mut b, cols, rows, d, self.merge_to);
                b == board
            });
        if stuck {
            g.finish(false);
        }
    }
}

pub struct SlideToWall;
impl System for SlideToWall {
    fn id(&self) -> &'static str {
        "behavior.slide_to_wall"
    }
    fn init(&mut self, g: &mut Game) {
        g.world.flag("slide");
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name == "input.swipe" {
            let dir = ev.data["dir"].as_str().unwrap_or("").to_string();
            grid_move(g, &dir, true);
        }
    }
}

/// Move the avatar on a grid one cell (walk) or until blocked (slide).
pub fn grid_move(g: &mut Game, dir: &str, slide: bool) {
    let (dc, dr) = match dir {
        "left" => (-1, 0),
        "right" => (1, 0),
        "up" => (0, -1),
        "down" => (0, 1),
        _ => return,
    };
    let (cols, rows) = (g.world.cols.max(1), g.world.rows.max(1));
    let Some(cell) = g.world.first("avatar").map(|a| a.cell) else { return };
    let (mut c, mut r) = (cell % cols, cell / cols);
    let mut moved = false;
    let mut blocked = false;
    loop {
        let (nc, nr) = (c + dc, r + dr);
        let wall = nc < 0 || nr < 0 || nc >= cols || nr >= rows;
        let rock = !wall && g.world.ents.iter().any(|e| e.role == "obstacle" && e.cell == nr * cols + nc);
        if wall || rock {
            blocked = true;
            break;
        }
        c = nc;
        r = nr;
        moved = true;
        if !slide {
            break;
        }
    }
    if moved {
        let (x, y) = g.world.cell_center(c, r);
        if let Some(a) = g.world.first_mut("avatar") {
            a.x = x;
            a.y = y;
            a.cell = r * cols + c;
        }
    }
    if slide && blocked && moved {
        g.emit("collision.hit", json!({ "a": "avatar", "b": "wall", "harm": false }));
    }
}

// ------------------------------------------------------------------ cards

fn build_cards(g: &mut Game, pairs: i64, face_down: bool) {
    g.world.clear_role("card");
    let mut idx: Vec<usize> = g.items.iter().enumerate().filter(|(_, it)| it.kind == "card").map(|(i, _)| i).collect();
    g.rng.shuffle(&mut idx);
    idx.truncate(pairs.max(2) as usize);
    let n = idx.len();
    let mut deck: Vec<i64> = (0..n as i64).chain(0..n as i64).collect();
    g.rng.shuffle(&mut deck);
    let cols = g.world.cols.max(2);
    g.world.rows = ((deck.len() as i64) + cols - 1) / cols;
    let (_, _, s) = g.world.grid_geom();
    for (i, tag) in deck.iter().enumerate() {
        let it = g.items[idx[*tag as usize]].clone();
        let (x, y) = g.world.cell_center(i as i64 % cols, i as i64 / cols);
        let mut e = Ent::new("card", &it.prompt, x, y, s / 2.0 - 4.0);
        e.img = it.media_url.clone();
        e.tag = *tag;
        e.cell = i as i64;
        e.kind = "card".into();
        e.state = if face_down { "down" } else { "peek" };
        e.timer = 100;
        g.world.add(e);
    }
    g.world.secret.insert("pairs".into(), json!(n));
    g.world.secret.insert("matched".into(), json!(0));
    g.hud_set("pairs", json!(format!("0/{n}")));
    g.emit("entity.spawned", json!({ "kind": "card", "role": "card", "count": deck.len() }));
}

pub struct CardSys {
    pub pairs: i64,
    pub face_down: bool,
}
impl System for CardSys {
    fn id(&self) -> &'static str {
        "entity.card"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => build_cards(g, self.pairs, self.face_down),
            "level.started" if ev.data["level"].as_i64().unwrap_or(1) > 1 => build_cards(g, self.pairs, true),
            "tick" => {
                for e in g.world.ents.iter_mut().filter(|e| e.role == "card" && (e.state == "peek" || e.state == "wrong") && e.timer == 0) {
                    e.state = "down";
                }
            }
            _ => {}
        }
    }
}

pub fn peek_pair(g: &mut Game) {
    let tags: Vec<i64> = g.world.ents.iter().filter(|e| e.role == "card" && e.state == "down").map(|e| e.tag).collect();
    let Some(tag) = tags.first().copied() else { return };
    for e in g.world.ents.iter_mut().filter(|e| e.role == "card" && e.state == "down" && e.tag == tag) {
        e.state = "peek";
        e.timer = 70;
    }
}

pub struct MatchPair;
impl System for MatchPair {
    fn id(&self) -> &'static str {
        "rule.match_pair"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.tap" || g.world.count("card") == 0 {
            return;
        }
        if g.world.ents.iter().any(|e| e.role == "card" && (e.state == "wrong" || e.state == "peek")) {
            return;
        }
        let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
        let slop = g.world.hit_slop;
        let Some(id) = g.world.at("card", x, y, slop.min(4.0)) else { return };
        if g.world.get(id).map_or(true, |e| e.state != "down") {
            return;
        }
        if let Some(e) = g.world.get_mut(id) {
            e.state = "up";
        }
        let ups: Vec<(u32, i64)> = g.world.ents.iter().filter(|e| e.role == "card" && e.state == "up").map(|e| (e.id, e.tag)).collect();
        if ups.len() < 2 {
            return;
        }
        if ups[0].1 == ups[1].1 {
            for (id, _) in &ups {
                if let Some(e) = g.world.get_mut(*id) {
                    e.state = "matched";
                }
            }
            let m = g.world.secret.get("matched").and_then(Value::as_i64).unwrap_or(0) + 1;
            let n = g.world.secret.get("pairs").and_then(Value::as_i64).unwrap_or(0);
            g.world.secret.insert("matched".into(), json!(m));
            g.hud_set("pairs", json!(format!("{m}/{n}")));
            g.emit("pair.matched", json!({}));
            good(g);
            if m >= n {
                g.finish(true);
            }
        } else {
            for (id, _) in &ups {
                if let Some(e) = g.world.get_mut(*id) {
                    e.state = "wrong";
                    e.timer = 40;
                }
            }
            g.emit("pair.missed", json!({}));
            bad(g, -1);
        }
    }
}

// ------------------------------------------------------------------ words

fn word_extra(g: &mut Game) -> &mut Map<String, Value> {
    let e = g.world.extra.entry("word".to_string()).or_insert_with(|| json!({}));
    if !e.is_object() {
        *e = json!({});
    }
    e.as_object_mut().expect("object")
}

pub fn word_reset(g: &mut Game) {
    let len = g.world.word_len;
    let pick = pick_item(g, "word", |it| it.prompt.trim().chars().count() as i64 == len).or_else(|| pick_item(g, "word", |_| true));
    let (target, clue) = match pick {
        Some(i) => (g.items[i].prompt.trim().to_uppercase(), g.items[i].clue.clone().unwrap_or_default()),
        None => ("WORDS".to_string(), String::new()),
    };
    g.world.word_len = target.chars().count() as i64;
    g.world.secret.insert("target".into(), json!(target));
    let len = g.world.word_len;
    let w = word_extra(g);
    w.insert("len".into(), json!(len));
    w.insert("rows".into(), json!([]));
    w.insert("cur".into(), json!(""));
    w.insert("max_rows".into(), json!(6));
    w.insert("clue".into(), json!(clue));
    w.insert("hint".into(), json!(""));
    w.insert("hint_n".into(), json!(0));
    for k in g.world.ents.iter_mut().filter(|e| e.role == "key") {
        k.state = "idle";
    }
}

pub fn word_hint(g: &mut Game) {
    let target: Vec<char> = g.world.secret.get("target").and_then(Value::as_str).unwrap_or("").chars().collect();
    let n = word_extra(g).get("hint_n").and_then(Value::as_i64).unwrap_or(0) as usize;
    if n >= target.len() {
        return;
    }
    let hint: Vec<String> = target.iter().enumerate().map(|(i, c)| if i <= n { c.to_string() } else { "_".into() }).collect();
    let w = word_extra(g);
    w.insert("hint".into(), json!(hint.join(" ")));
    w.insert("hint_n".into(), json!(n + 1));
}

pub struct WordTile {
    pub emoji: bool,
    buf: String,
}
impl WordTile {
    fn build_keys(&self, g: &mut Game) {
        g.world.clear_role("key");
        let rows: Vec<Vec<String>> = if self.emoji {
            let mut set: Vec<String> = Vec::new();
            for it in g.items.iter().filter(|i| i.kind == "word") {
                for c in it.prompt.trim().chars() {
                    let s = c.to_string();
                    if !set.contains(&s) {
                        set.push(s);
                    }
                }
            }
            set.truncate(18);
            let mut rows: Vec<Vec<String>> = set.chunks(6).map(|c| c.to_vec()).collect();
            if let Some(last) = rows.last_mut() {
                last.insert(0, "↵".into());
                last.push("⌫".into());
            }
            rows
        } else {
            let mut rows: Vec<Vec<String>> = ["QWERTYUIOP", "ASDFGHJKL", "↵ZXCVBNM⌫"].iter().map(|r| r.chars().map(|c| c.to_string()).collect()).collect();
            rows.iter_mut().for_each(|_| ());
            rows
        };
        let base_y = 400.0;
        for (ri, row) in rows.iter().enumerate() {
            let kw = (W - 12.0) / 10.0;
            let start = (W - kw * row.len() as f64) / 2.0;
            for (ci, k) in row.iter().enumerate() {
                let mut e = Ent::new("key", k, start + kw * (ci as f64 + 0.5), base_y + ri as f64 * 52.0, 16.0);
                e.hw = kw / 2.0 - 2.0;
                e.hh = 21.0;
                e.kind = "key".into();
                g.world.add(e);
            }
        }
        g.emit("entity.spawned", json!({ "kind": "key", "role": "key" }));
    }
}
impl System for WordTile {
    fn id(&self) -> &'static str {
        "entity.word_tile"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                self.buf.clear();
                self.build_keys(g);
            }
            "level.started" if ev.data["level"].as_i64().unwrap_or(1) > 1 => self.buf.clear(),
            "input.tap" => {
                let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
                let Some(id) = g.world.at("key", x, y, 2.0) else { return };
                let label = g.world.get(id).map(|e| e.label.clone()).unwrap_or_default();
                match label.as_str() {
                    "⌫" => {
                        self.buf.pop();
                    }
                    "↵" => {
                        if !self.buf.is_empty() {
                            let t = std::mem::take(&mut self.buf);
                            g.emit("input.text", json!({ "text": t }));
                        }
                    }
                    l => {
                        if (self.buf.chars().count() as i64) < g.world.word_len {
                            self.buf.push_str(l);
                        }
                    }
                }
                let cur = self.buf.clone();
                word_extra(g).insert("cur".into(), json!(cur));
            }
            "word.submitted" => {
                self.buf.clear();
                word_extra(g).insert("cur".into(), json!(""));
            }
            _ => {}
        }
    }
}

fn grade(target: &[char], guess: &[char]) -> Vec<&'static str> {
    let mut res = vec!["absent"; guess.len()];
    let mut left: BTreeMap<char, i32> = BTreeMap::new();
    for (i, c) in target.iter().enumerate() {
        if guess.get(i) == Some(c) {
            res[i] = "correct";
        } else {
            *left.entry(*c).or_insert(0) += 1;
        }
    }
    for (i, c) in guess.iter().enumerate() {
        if res[i] != "correct" {
            if let Some(n) = left.get_mut(c).filter(|n| **n > 0) {
                *n -= 1;
                res[i] = "present";
            }
        }
    }
    res
}

pub struct WordValid {
    pub min_len: i64,
}
impl System for WordValid {
    fn id(&self) -> &'static str {
        "rule.word_valid"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.text" {
            return;
        }
        let word = ev.data["text"].as_str().unwrap_or("").trim().to_uppercase();
        let guess: Vec<char> = word.chars().collect();
        let target: Vec<char> = g.world.secret.get("target").and_then(Value::as_str).unwrap_or("").chars().collect();
        if target.is_empty() || word_extra(g).get("rows").and_then(Value::as_array).map_or(0, |r| r.len()) >= 6 {
            return;
        }
        let in_dict = g.world.secret.get("dict").and_then(Value::as_array).map_or(false, |d| d.iter().any(|w| w.as_str() == Some(word.as_str())));
        let valid = guess.len() == target.len() && guess.len() as i64 >= self.min_len && in_dict;
        g.emit("word.submitted", json!({ "word": word, "valid": valid }));
        if !valid {
            g.world.toast(if guess.len() != target.len() { "Wrong length" } else { "Not in word list" });
            return;
        }
        let marks = grade(&target, &guess);
        let row: Vec<Value> = guess.iter().zip(marks.iter()).map(|(c, m)| json!({ "c": c.to_string(), "s": m })).collect();
        let n_rows = {
            let w = word_extra(g);
            let rows = w.entry("rows".to_string()).or_insert_with(|| json!([]));
            rows.as_array_mut().expect("rows").push(Value::Array(row));
            rows.as_array().map_or(0, |r| r.len())
        };
        let rank = |s: &str| match s {
            "correct" => 3,
            "present" => 2,
            "absent" => 1,
            _ => 0,
        };
        for (c, m) in guess.iter().zip(marks.iter()) {
            let label = c.to_string();
            for k in g.world.ents.iter_mut().filter(|k| k.role == "key" && k.label == label) {
                if rank(m) > rank(k.state) {
                    k.state = m;
                }
            }
        }
        if guess == target {
            good(g);
            g.finish(true);
        } else {
            bad(g, -1);
            if n_rows >= 6 {
                let t: String = target.iter().collect();
                g.world.toast(&format!("The word was {t}"));
                g.finish(false);
            }
        }
    }
}

// ------------------------------------------------------------------ timeline

pub fn timeline_reset(g: &mut Game) {
    g.world.clear_role("event");
    let slots = g.world.slots.max(2) as usize;
    let mut idx: Vec<usize> = g.items.iter().enumerate().filter(|(_, it)| it.kind == "event").map(|(i, _)| i).collect();
    g.rng.shuffle(&mut idx);
    idx.truncate(slots);
    let mut ranked = idx.clone();
    ranked.sort_by_key(|i| (g.items[*i].answer.unwrap_or(0), *i));
    let n = idx.len();
    g.world.slots = n as i64;
    let sw = (W - 16.0) / n as f64;
    g.world.zones = (0..n).map(|i| (8.0 + sw * (i as f64 + 0.5), 190.0, sw / 2.0 - 2.0)).collect();
    g.rng.shuffle(&mut idx);
    for (k, i) in idx.iter().enumerate() {
        let it = g.items[*i].clone();
        let rank = ranked.iter().position(|r| r == i).unwrap_or(0) as i64;
        let (x, y) = (W / 2.0 + if k % 2 == 0 { -88.0 } else { 88.0 }, 340.0 + (k / 2) as f64 * 70.0);
        let mut e = Ent::new("event", &it.prompt, x, y, 32.0);
        e.hw = 80.0;
        e.hh = 29.0;
        e.tag = rank;
        e.img = it.media_url.clone();
        e.kind = "event".into();
        g.world.add(e);
    }
    g.hud_set("placed", json!(format!("0/{n}")));
}

pub struct OrderSequence;
impl System for OrderSequence {
    fn id(&self) -> &'static str {
        "rule.order_sequence"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if ev.name != "input.drag" || ev.data["phase"] != "end" {
            return;
        }
        let Some(id) = ev.data["id"].as_u64().map(|i| i as u32) else { return };
        let slot = ev.data["slot"].as_i64().unwrap_or(-1);
        if slot < 0 {
            return;
        }
        let occupant = g.world.ents.iter().find(|e| e.role == "event" && e.id != id && e.slot == slot).map(|e| e.id);
        if let Some(o) = occupant.and_then(|o| g.world.get_mut(o)) {
            o.slot = -1;
            o.x = o.ox;
            o.y = o.oy;
        }
        let Some(e) = g.world.get_mut(id) else { return };
        let ok = e.tag == slot;
        if ok {
            e.state = "locked";
        } else {
            e.slot = -1;
            e.x = e.ox;
            e.y = e.oy;
        }
        g.emit("sequence.step", json!({ "ok": ok }));
        if ok {
            good(g);
            let placed = g.world.ents.iter().filter(|e| e.role == "event" && e.state == "locked").count();
            let n = g.world.slots;
            g.hud_set("placed", json!(format!("{placed}/{n}")));
            if placed as i64 >= n {
                g.finish(true);
            }
        } else {
            bad(g, slot);
            g.world.toast("Not there");
        }
    }
}

// ------------------------------------------------------------------ simon pads

const PAD_COLORS: [&str; 4] = ["🟥", "🟩", "🟦", "🟨"];

pub struct SequenceMemory {
    start_len: i64,
    seq: Vec<i64>,
    phase: u8, // 0 idle, 1 show, 2 input
    step: usize,
    t: i64,
    delay: i64,
}
impl SequenceMemory {
    fn begin_show(&mut self, g: &mut Game) {
        g.world.toast.1 = 0;
        self.phase = 1;
        self.step = 0;
        self.t = 0;
        self.delay = 40;
    }
    fn light(g: &mut Game, tag: i64, on: bool, ticks: i64) {
        for p in g.world.ents.iter_mut().filter(|p| p.role == "pad" && p.tag == tag) {
            p.state = if on { "lit" } else { "idle" };
            p.timer = ticks;
        }
    }
}
impl System for SequenceMemory {
    fn id(&self) -> &'static str {
        "rule.sequence_memory"
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => {
                g.world.clear_role("pad");
                for t in 0..4i64 {
                    let (x, y) = (W / 2.0 + if t % 2 == 0 { -88.0 } else { 88.0 }, 190.0 + (t / 2) as f64 * 176.0);
                    let mut e = Ent::new("pad", PAD_COLORS[t as usize], x, y, 80.0);
                    e.hw = 80.0;
                    e.hh = 80.0;
                    e.tag = t;
                    g.world.add(e);
                }
            }
            "session.started" => {
                self.seq = (0..self.start_len).map(|_| g.rng.below(4) as i64).collect();
                g.hud_set("sequence", json!(self.seq.len()));
                self.begin_show(g);
            }
            "tick" => {
                for p in g.world.ents.iter_mut().filter(|p| p.role == "pad" && p.state == "lit" && p.timer == 0) {
                    p.state = "idle";
                }
                if self.phase != 1 {
                    return;
                }
                if self.delay > 0 {
                    self.delay -= 1;
                    return;
                }
                if self.step >= self.seq.len() {
                    self.phase = 2;
                    self.step = 0;
                    g.world.toast("Your turn");
                    return;
                }
                if self.t == 0 {
                    Self::light(g, self.seq[self.step], true, -1);
                } else if self.t == 24 {
                    Self::light(g, self.seq[self.step], false, 0);
                } else if self.t >= 34 {
                    self.step += 1;
                    self.t = 0;
                    return;
                }
                self.t += 1;
            }
            "input.tap" if self.phase == 2 => {
                let (x, y) = (num(&ev.data["x"]), num(&ev.data["y"]));
                let Some(id) = g.world.at("pad", x, y, 0.0) else { return };
                let tag = g.world.get(id).map_or(0, |p| p.tag);
                Self::light(g, tag, true, 10);
                let ok = self.seq.get(self.step) == Some(&tag);
                g.emit("sequence.step", json!({ "ok": ok }));
                if ok {
                    self.step += 1;
                    if self.step >= self.seq.len() {
                        good(g);
                        self.seq.push(g.rng.below(4) as i64);
                        g.hud_set("sequence", json!(self.seq.len()));
                        self.begin_show(g);
                    }
                } else {
                    bad(g, tag);
                    self.begin_show(g);
                }
            }
            _ => {}
        }
    }
}

pub fn build_entity(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "entity.tile" => Box::new(TileSys { kinds: p.int("kinds").clamp(3, 8) }),
        "entity.card" => Box::new(CardSys { pairs: p.int("pairs"), face_down: p.bool("face_down") }),
        "entity.word_tile" => Box::new(WordTile { emoji: p.string("alphabet") == "emoji", buf: String::new() }),
        _ => return None,
    })
}

pub fn build_behavior(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "behavior.shuffle_tiles" => Box::new(ShuffleTiles),
        "behavior.merge_adjacent" => Box::new(MergeAdjacent { merge_to: p.int("merge_to").max(2) }),
        "behavior.slide_to_wall" => Box::new(SlideToWall),
        _ => return None,
    })
}

pub fn build_rule(id: &str, p: &Params) -> Option<Box<dyn System>> {
    Some(match id {
        "rule.match_pair" => Box::new(MatchPair),
        "rule.match_three" => Box::new(MatchThree { min_run: p.int("min_run") }),
        "rule.word_valid" => Box::new(WordValid { min_len: p.int("min_len") }),
        "rule.order_sequence" => Box::new(OrderSequence),
        "rule.sequence_memory" => Box::new(SequenceMemory { start_len: p.int("start_len"), seq: Vec::new(), phase: 0, step: 0, t: 0, delay: 0 }),
        _ => return None,
    })
}

