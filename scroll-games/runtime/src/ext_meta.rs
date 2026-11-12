//! Non-spatial concepts (feedback, score, content, social, share, feel, meta, accessibility) beyond the quiz set.
//! View data goes in `Game::ext_view` (surfaced as `view.ext`); see the "Meta concepts" table in CONTRACTS.md.

use crate::concepts::{Params, System};
use crate::game::{Game, Outcome, TICK_US};
use crate::types::{Event, Item};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, VecDeque};

// ---------------------------------------------------------------- helpers

/// Float param. `Params` only exposes integer accessors, so a float override is honoured only when
/// its integer part differs from the catalog default; otherwise the default applies.
fn fl(p: &Params, k: &str, def: f64) -> f64 {
    if p.has(k) { p.float(k) } else { def }
}

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Set `view.ext[group][key]`.
fn put(g: &mut Game, group: &str, key: &str, v: Value) {
    let e = g.ext_view.entry(group.to_string()).or_insert_with(|| json!({}));
    if let Value::Object(m) = e {
        m.insert(key.to_string(), v);
    }
}

fn flag(g: &Game, group: &str, key: &str) -> bool {
    g.ext_view.get(group).and_then(|o| o.get(key)).and_then(Value::as_bool).unwrap_or(false)
}

/// `copy.<a>.<b>` from the content (server-provided runtime data), or null.
fn copy_at(g: &Game, a: &str, b: &str) -> Value {
    g.copy.get(a).and_then(|v| v.get(b)).cloned().unwrap_or(Value::Null)
}

fn ms_of(ticks: u64) -> i64 {
    ticks as i64 * TICK_US / 1000
}

/// Counts down a microsecond timer by one tick; true when it just reached zero.
fn decay(left: &mut i64) -> bool {
    if *left <= 0 {
        return false;
    }
    *left -= TICK_US;
    if *left <= 0 {
        *left = 0;
        return true;
    }
    false
}

fn is_miss(name: &str) -> bool {
    matches!(name, "answer.wrong" | "timer.expired")
}

macro_rules! system {
    ($ty:ident, $id:literal, |$s:ident, $ev:ident, $g:ident| $body:block) => {
        impl System for $ty {
            fn id(&self) -> &'static str {
                $id
            }
            #[allow(unused_variables)]
            fn on_event(&mut self, $ev: &Event, $g: &mut Game) {
                let $s: &mut Self = self;
                $body
            }
        }
    };
    ($ty:ident, $id:literal, init |$si:ident, $gi:ident| $init:block, |$s:ident, $ev:ident, $g:ident| $body:block) => {
        impl System for $ty {
            fn id(&self) -> &'static str {
                $id
            }
            #[allow(unused_variables)]
            fn init(&mut self, $gi: &mut Game) {
                let $si: &mut Self = self;
                $init
            }
            #[allow(unused_variables)]
            fn on_event(&mut self, $ev: &Event, $g: &mut Game) {
                let $s: &mut Self = self;
                $body
            }
        }
    };
}

/// Build a system for `id`, or None if this module does not implement it.
pub fn build(id: &str, p: &Params) -> Option<Box<dyn System>> {
    let sys: Box<dyn System> = match id {
        // feedback
        "feedback.sound_cue" => Box::new(SoundCue { volume: fl(p, "volume", 0.7), n: 0 }),
        "feedback.screen_shake" => Box::new(ScreenShake { intensity: fl(p, "intensity", 0.5), n: 0, left: 0 }),
        "feedback.floating_score" => {
            Box::new(FloatingScore { dur: p.int("duration_ms") * 1000, items: Vec::new(), next: 0, dirty: false })
        }
        "feedback.pulse_timer" => Box::new(PulseTimer { thr: p.int("threshold_ms") * 1000 }),
        "feedback.color_wash" => Box::new(ColorWash { max: p.int("max_hue_shift") }),
        "feedback.emoji_burst" => Box::new(EmojiBurst { emoji: p.string("emoji"), n: 0 }),
        "feedback.voice_cheer" => Box::new(VoiceCheer { voice: p.string("voice"), n: 0 }),
        "feedback.slowmo" => Box::new(Slowmo { factor: fl(p, "factor", 0.4), left: 0 }),
        "feedback.vignette_low_time" => Box::new(VignetteLowTime { thr: p.int("threshold_ms") * 1000 }),
        "feedback.toast" => Box::new(Toast { dur: p.int("duration_ms") * 1000, items: Vec::new(), next: 0, dirty: false }),
        // score
        "score.time_attack" => Box::new(TimeAttack { seconds: p.string("unit") == "s", ticks: 0 }),
        "score.distance" => Box::new(Distance { per_m: fl(p, "per_meter", 1.0), ticks: 0, awarded: 0 }),
        "score.combo_chain" => Box::new(ComboChain { window: p.int("window_ms") * 1000, since: 0, combo: 0 }),
        "score.accuracy_percent" => Box::new(AccuracyPercent { last: 0 }),
        "score.lives_bonus" => Box::new(LivesBonus { per_life: p.int("per_life"), lives: None }),
        "score.par_target" => Box::new(ParTarget { par: p.int("par"), bonus: p.int("bonus") }),
        "score.perfect_bonus" => Box::new(PerfectBonus { bonus: p.int("bonus") }),
        "score.collect_count" => Box::new(CollectCount { per_item: p.int("per_item"), count: 0 }),
        "score.word_length" => Box::new(WordLength { per_letter: p.int("per_letter"), words: 0 }),
        "score.rhythm_accuracy" => {
            Box::new(RhythmAccuracy { perfect: p.int("perfect"), good: p.int("good"), counts: [0; 3] })
        }
        "score.drawing_similarity" => Box::new(DrawingSimilarity { threshold: fl(p, "threshold", 0.6) }),
        // content
        "content.word_list" => Box::new(WordList { min: p.int("min_len"), max: p.int("max_len") }),
        "content.emoji_set" => Box::new(EmojiSet { count: p.int("count") }),
        "content.caption_guess" => Box::new(QuizKind {
            id: "content.caption_guess",
            kind: "caption",
            default_prompt: "Which caption belongs to this photo?",
            clip_ms: 0,
        }),
        "content.fill_blank" => Box::new(QuizKind { id: "content.fill_blank", kind: "blank", default_prompt: "Fill in the blank", clip_ms: 0 }),
        "content.audio_clip" => Box::new(QuizKind {
            id: "content.audio_clip",
            kind: "audio",
            default_prompt: "Name that clip",
            clip_ms: p.int("clip_ms"),
        }),
        "content.pair_deck" => Box::new(PairDeck { pairs: p.int("pairs") }),
        "content.image_sequence" => Box::new(ImageSequence { length: p.int("length") }),
        "content.riddle_set" => Box::new(RiddleSet { attempts: 0, accepted: Vec::new() }),
        "content.trivia_category" => Box::new(TriviaCategory { category: p.string("category") }),
        "content.user_media_pool" => Box::new(UserMediaPool { max: p.int("max_media"), pool: Vec::new(), filled: 0 }),
        "content.map_pins" => Box::new(MapPins { target: None }),
        "content.reference_drawing" => Box::new(ReferenceDrawing),
        "content.beatmap" => Box::new(Beatmap { notes: Vec::new(), judged: Vec::new(), ticks: 0, started: false, counts: [0; 3] }),
        // social
        "social.challenge_friend" => Box::new(ChallengeFriend { max: p.int("max_recipients") }),
        "social.friends_leaderboard" => Box::new(FriendsLeaderboard { top: p.int("top").max(1) as usize }),
        "social.ghost_replay" => Box::new(GhostReplay { opacity: fl(p, "opacity", 0.5), ticks: 0, last: None }),
        "social.async_versus" => Box::new(AsyncVersus),
        "social.coop_score" => Box::new(CoopScore),
        "social.reaction_stickers" => Box::new(ReactionStickers),
        "social.comment_on_result" => Box::new(CommentOnResult),
        "social.tag_friend_in_photo" => Box::new(TagFriendInPhoto),
        "social.group_scoreboard" => Box::new(GroupScoreboard { friends: p.string("group_scope") == "friends" }),
        "social.rematch" => Box::new(Rematch),
        "social.spectate" => Box::new(Spectate { ticks: 0, seq: 0 }),
        "social.follow_creator" => Box::new(FollowCreator),
        // share
        "share.replay_clip" => Box::new(ReplayClip { max_seconds: p.int("max_seconds"), ticks: 0 }),
        "share.daily_streak" => Box::new(DailyStreak),
        "share.result_emoji_grid" => Box::new(EmojiGrid { correct: p.string("correct"), wrong: p.string("wrong"), cells: Vec::new() }),
        "share.invite_link" => Box::new(InviteLink),
        "share.story_export" => Box::new(StoryExport { aspect: p.string("aspect") }),
        "share.copy_result_text" => Box::new(CopyResultText),
        "share.qr_challenge" => Box::new(QrChallenge),
        // feel
        "feel.sound_pack" => Box::new(SoundPack { pack: p.string("pack") }),
        "feel.music_loop" => Box::new(MusicLoop { track: p.string("track"), volume: fl(p, "volume", 0.4) }),
        "feel.palette_cycle" => Box::new(PaletteCycle { period_s: p.int("period_s").max(1), ticks: 0 }),
        "feel.retro_pixel" => Box::new(StyleFlag { id: "feel.retro_pixel", key: "pixel_size", val: json!(p.int("pixel_size").max(1)) }),
        "feel.paper_texture" => Box::new(StyleFlag { id: "feel.paper_texture", key: "paper_grain", val: json!(fl(p, "grain", 0.3)) }),
        "feel.neon_glow" => Box::new(StyleFlag { id: "feel.neon_glow", key: "neon_glow", val: json!(fl(p, "glow", 0.6)) }),
        "feel.juice_level" => Box::new(StyleFlag { id: "feel.juice_level", key: "juice", val: json!(p.string("level")) }),
        "feel.camera_zoom" => Box::new(CameraZoom { amount: fl(p, "amount", 0.04), n: 0 }),
        "feel.font_pack" => Box::new(StyleFlag { id: "feel.font_pack", key: "font", val: json!(p.string("font")) }),
        "feel.cozy_mode" => Box::new(CozyMode),
        "feel.dark_light" => Box::new(StyleFlag { id: "feel.dark_light", key: "appearance", val: json!(p.string("appearance")) }),
        // meta
        "meta.daily_seed" => Box::new(DailySeed),
        "meta.adaptive_difficulty" => Box::new(AdaptiveDifficulty { aggr: fl(p, "aggressiveness", 0.5), level: 0.5, scaled: 0 }),
        "meta.analytics_events" => Box::new(Analytics { counts: BTreeMap::new() }),
        "meta.ab_variant" => Box::new(AbVariant { variants: p.int("variants").max(1) }),
        "meta.debug_overlay" => Box::new(DebugOverlay { ticks: 0, recent: VecDeque::new() }),
        "meta.content_moderation_hint" => Box::new(ModerationHint),
        "meta.input_recorder" => Box::new(InputRecorder { count: 0 }),
        "meta.cheat_guard" => Box::new(CheatGuard { min_ms: p.int("min_answer_ms"), flagged: false, rejected: 0 }),
        "meta.locale" => Box::new(Locale { locale: p.string("locale") }),
        "meta.schema_version" => Box::new(SchemaVersion { version: p.int("version") }),
        "meta.hot_seat" => Box::new(HotSeat { players: p.int("players").max(1) as usize, scores: Vec::new(), start_score: 0 }),
        // accessibility
        "accessibility.reduced_motion" => Box::new(A11yFlag { id: "accessibility.reduced_motion", key: "reduced_motion", val: json!(true) }),
        "accessibility.high_contrast" => Box::new(HighContrast),
        "accessibility.colorblind_palette" => Box::new(ColorblindPalette { mode: p.string("mode"), last_good: true }),
        "accessibility.screen_reader_labels" => Box::new(ScreenReaderLabels { announce: String::new(), n: 0 }),
        "accessibility.extended_time" => Box::new(ExtendedTime { mult: fl(p, "multiplier", 1.5), scaled: 0 }),
        "accessibility.one_handed" => Box::new(A11yFlag { id: "accessibility.one_handed", key: "one_handed", val: json!(p.string("side")) }),
        "accessibility.haptics_off" => Box::new(A11yFlag { id: "accessibility.haptics_off", key: "haptics_off", val: json!(true) }),
        "accessibility.captions" => Box::new(Captions { items: Vec::new(), next: 0 }),
        "accessibility.dyslexia_font" => Box::new(A11yFlag { id: "accessibility.dyslexia_font", key: "dyslexia_font", val: json!(true) }),
        "accessibility.big_targets" => Box::new(A11yFlag { id: "accessibility.big_targets", key: "min_target_px", val: json!(p.int("min_size").max(44)) }),
        "accessibility.pause_anytime" => Box::new(A11yFlag { id: "accessibility.pause_anytime", key: "pause_anytime", val: json!(true) }),
        _ => return None,
    };
    Some(sys)
}

// ---------------------------------------------------------------- feedback

struct SoundCue {
    volume: f64,
    n: u64,
}
system!(SoundCue, "feedback.sound_cue",
    init |s, g| {
        put(g, "sound", "volume", json!(s.volume));
        put(g, "sound", "n", json!(0));
    },
    |s, ev, g| {
        let cue = match ev.name.as_str() {
            "answer.correct" => "correct",
            "answer.wrong" | "timer.expired" => "wrong",
            _ => return,
        };
        s.n += 1;
        put(g, "sound", "cue", json!(cue));
        put(g, "sound", "n", json!(s.n));
    });

struct ScreenShake {
    intensity: f64,
    n: u64,
    left: i64,
}
system!(ScreenShake, "feedback.screen_shake", |s, ev, g| {
    match ev.name.as_str() {
        "answer.wrong" | "collision.hit" if !flag(g, "a11y", "reduced_motion") => {
            s.n += 1;
            s.left = 400_000;
            put(g, "fx", "shake", json!({ "intensity": s.intensity, "n": s.n, "active": true }));
        }
        "tick" => {
            if decay(&mut s.left) {
                put(g, "fx", "shake", json!({ "intensity": s.intensity, "n": s.n, "active": false }));
            }
        }
        _ => {}
    }
});

struct FloatingScore {
    dur: i64,
    items: Vec<(u64, i64, i64)>,
    next: u64,
    dirty: bool,
}
system!(FloatingScore, "feedback.floating_score", |s, ev, g| {
    match ev.name.as_str() {
        "score.changed" => {
            let delta = ev.data["delta"].as_i64().unwrap_or(0);
            if delta != 0 {
                s.next += 1;
                s.items.push((s.next, delta, s.dur));
                if s.items.len() > 6 {
                    s.items.remove(0);
                }
                s.dirty = true;
            }
        }
        "tick" => {
            if !s.items.is_empty() {
                for it in s.items.iter_mut() {
                    it.2 -= TICK_US;
                }
                s.items.retain(|it| it.2 > 0);
                s.dirty = true;
            }
        }
        _ => return,
    }
    if s.dirty {
        s.dirty = false;
        let dur = s.dur.max(1) as f64;
        let list: Vec<Value> =
            s.items.iter().map(|(id, d, left)| json!({ "id": id, "delta": d, "life": r2(*left as f64 / dur) })).collect();
        put(g, "fx", "floaters", Value::Array(list));
    }
});

struct PulseTimer {
    thr: i64,
}
system!(PulseTimer, "feedback.pulse_timer", |s, ev, g| {
    if ev.name != "tick" {
        return;
    }
    let left = g.round.time_left_us;
    let active = g.round.active && !g.round.locked && g.round.time_total_us > 0 && left > 0 && left <= s.thr;
    let hz = if active { r2(2.0 + 4.0 * (1.0 - left as f64 / s.thr.max(1) as f64)) } else { 0.0 };
    put(g, "fx", "timer_pulse", json!({ "active": active, "hz": hz }));
});

struct ColorWash {
    max: i64,
}
system!(ColorWash, "feedback.color_wash",
    init |s, g| { put(g, "fx", "color_wash", json!({ "hue": 0, "streak": 0 })); },
    |s, ev, g| {
        if ev.name != "streak.changed" {
            return;
        }
        let streak = ev.data["streak"].as_i64().unwrap_or(0).max(0);
        let hue = (streak * s.max / 5).min(s.max);
        put(g, "fx", "color_wash", json!({ "hue": hue, "streak": streak }));
    });

struct EmojiBurst {
    emoji: String,
    n: u64,
}
system!(EmojiBurst, "feedback.emoji_burst", |s, ev, g| {
    if ev.name == "answer.correct" && !flag(g, "a11y", "reduced_motion") {
        s.n += 1;
        put(g, "fx", "emoji_burst", json!({ "emoji": s.emoji, "n": s.n, "count": 14 }));
    }
});

struct VoiceCheer {
    voice: String,
    n: u64,
}
const CHEERS: [&str; 4] = ["Nice!", "You got it!", "Great one!", "Keep going!"];
system!(VoiceCheer, "feedback.voice_cheer", |s, ev, g| {
    let text = match ev.name.as_str() {
        "answer.correct" => CHEERS[(s.n as usize) % CHEERS.len()].to_string(),
        "game.over" => format!("Game over. You scored {}.", g.score),
        _ => return,
    };
    s.n += 1;
    put(g, "voice", "text", json!(text));
    put(g, "voice", "voice", json!(s.voice));
    put(g, "voice", "n", json!(s.n));
});

struct Slowmo {
    factor: f64,
    left: i64,
}
system!(Slowmo, "feedback.slowmo", |s, ev, g| {
    match ev.name.as_str() {
        "answer.correct" => {
            let close = g.round.time_total_us > 0 && g.round.time_left_us * 4 <= g.round.time_total_us;
            if close && !flag(g, "a11y", "reduced_motion") {
                s.left = 700_000;
                put(g, "fx", "slowmo", json!({ "active": true, "factor": s.factor }));
            }
        }
        "tick" => {
            if decay(&mut s.left) {
                put(g, "fx", "slowmo", json!({ "active": false, "factor": 1.0 }));
            }
        }
        _ => {}
    }
});

struct VignetteLowTime {
    thr: i64,
}
system!(VignetteLowTime, "feedback.vignette_low_time", |s, ev, g| {
    if ev.name != "tick" {
        return;
    }
    let left = g.round.time_left_us;
    let on = g.round.active && !g.round.locked && g.round.time_total_us > 0 && left <= s.thr;
    let strength = if on { r2(1.0 - left as f64 / s.thr.max(1) as f64) } else { 0.0 };
    put(g, "fx", "vignette", json!(strength));
});

struct Toast {
    dur: i64,
    items: Vec<(u64, String, i64)>,
    next: u64,
    dirty: bool,
}
system!(Toast, "feedback.toast", |s, ev, g| {
    match ev.name.as_str() {
        "streak.changed" | "level.started" => {
            let text = if ev.name == "level.started" {
                format!("Level {}", ev.data["level"].as_i64().unwrap_or(0))
            } else {
                let n = ev.data["streak"].as_i64().unwrap_or(0);
                if n < 2 {
                    return;
                }
                format!("🔥 {n} in a row")
            };
            s.next += 1;
            s.items.push((s.next, text, s.dur));
            if s.items.len() > 3 {
                s.items.remove(0);
            }
            s.dirty = true;
        }
        "tick" => {
            if !s.items.is_empty() {
                for it in s.items.iter_mut() {
                    it.2 -= TICK_US;
                }
                s.items.retain(|it| it.2 > 0);
                s.dirty = true;
            }
        }
        _ => return,
    }
    if s.dirty {
        s.dirty = false;
        let list: Vec<Value> = s.items.iter().map(|(id, t, _)| json!({ "id": id, "text": t })).collect();
        put(g, "fx", "toasts", Value::Array(list));
    }
});

// ---------------------------------------------------------------- score

struct TimeAttack {
    seconds: bool,
    ticks: u64,
}
system!(TimeAttack, "score.time_attack",
    init |s, g| {
        put(g, "score", "mode", json!("time_attack"));
        put(g, "score", "lower_is_better", json!(true));
        put(g, "score", "unit", json!(if s.seconds { "s" } else { "ms" }));
    },
    |s, ev, g| {
        match ev.name.as_str() {
            "tick" => s.ticks += 1,
            "session.ended" => {
                let ms = ms_of(s.ticks);
                let value = if s.seconds { (ms + 500) / 1000 } else { ms };
                let delta = value - g.score;
                g.add_score(delta);
            }
            _ => {}
        }
    });

struct Distance {
    per_m: f64,
    ticks: u64,
    awarded: i64,
}
system!(Distance, "score.distance", |s, ev, g| {
    if ev.name != "tick" {
        return;
    }
    s.ticks += 1;
    let secs = s.ticks as f64 * TICK_US as f64 / 1_000_000.0;
    let meters = match g.custom.get("distance").and_then(Value::as_f64) {
        Some(d) => d,
        None => g.custom.get("speed").and_then(Value::as_f64).unwrap_or(1.0) * secs,
    };
    let total = (meters * s.per_m).floor() as i64;
    if total > s.awarded {
        g.add_score(total - s.awarded);
        s.awarded = total;
    }
    put(g, "score", "distance_m", json!(r2(meters)));
});

struct ComboChain {
    window: i64,
    since: i64,
    combo: i64,
}
system!(ComboChain, "score.combo_chain", |s, ev, g| {
    match ev.name.as_str() {
        "answer.correct" | "match.made" | "pair.matched" | "entity.collected" => {
            s.combo = if s.combo > 0 && s.since <= s.window { s.combo + 1 } else { 1 };
            s.since = 0;
            let c = s.combo;
            g.emit("combo.changed", json!({ "combo": c }));
            put(g, "score", "combo", json!(c));
            if c > 1 {
                g.add_score(10 * (c - 1));
            }
        }
        "answer.wrong" | "match.failed" | "pair.missed" => {
            if s.combo > 0 {
                s.combo = 0;
                g.emit("combo.changed", json!({ "combo": 0 }));
                put(g, "score", "combo", json!(0));
            }
        }
        "tick" => {
            if s.combo > 0 {
                s.since += TICK_US;
                if s.since > s.window {
                    s.combo = 0;
                    g.emit("combo.changed", json!({ "combo": 0 }));
                    put(g, "score", "combo", json!(0));
                }
            }
        }
        _ => {}
    }
});

struct AccuracyPercent {
    last: i64,
}
system!(AccuracyPercent, "score.accuracy_percent", |s, ev, g| {
    if ev.name != "answer.correct" && !is_miss(&ev.name) {
        return;
    }
    let total = g.stats.correct + g.stats.wrong;
    if total == 0 {
        return;
    }
    let pct = (100 * g.stats.correct * 2 + total) / (2 * total);
    g.add_score(pct - s.last);
    s.last = pct;
    put(g, "score", "accuracy", json!(pct));
});

struct LivesBonus {
    per_life: i64,
    lives: Option<i64>,
}
system!(LivesBonus, "score.lives_bonus", |s, ev, g| {
    match ev.name.as_str() {
        "lives.changed" => s.lives = ev.data["lives"].as_i64(),
        "game.over" => {
            let lives = s.lives.or_else(|| g.custom.get("lives").and_then(Value::as_i64)).unwrap_or(0).max(0);
            let bonus = lives * s.per_life;
            g.add_score(bonus);
            put(g, "score", "lives_bonus", json!(bonus));
        }
        _ => {}
    }
});

fn par_view(g: &mut Game, par: i64, bonus: i64) {
    let hit = g.score >= par;
    let gap = par - g.score;
    put(g, "score", "par", json!({ "par": par, "bonus": bonus, "hit": hit, "gap": gap.max(0) }));
}

struct ParTarget {
    par: i64,
    bonus: i64,
}
system!(ParTarget, "score.par_target",
    init |s, g| { par_view(g, s.par, s.bonus); },
    |s, ev, g| {
        match ev.name.as_str() {
            "score.changed" => par_view(g, s.par, s.bonus),
            "game.over" => {
                if g.score >= s.par {
                    g.add_score(s.bonus);
                }
                par_view(g, s.par, s.bonus);
            }
            _ => {}
        }
    });

struct PerfectBonus {
    bonus: i64,
}
system!(PerfectBonus, "score.perfect_bonus", |s, ev, g| {
    if ev.name == "game.over" {
        let perfect = g.stats.wrong == 0 && g.stats.correct > 0;
        if perfect {
            g.add_score(s.bonus);
        }
        put(g, "score", "perfect", json!(perfect));
    }
});

struct CollectCount {
    per_item: i64,
    count: i64,
}
system!(CollectCount, "score.collect_count", |s, ev, g| {
    if ev.name == "entity.collected" {
        s.count += 1;
        g.add_score(s.per_item);
        put(g, "score", "collected", json!(s.count));
    }
});

struct WordLength {
    per_letter: i64,
    words: i64,
}
system!(WordLength, "score.word_length", |s, ev, g| {
    if ev.name == "word.submitted" && ev.data["valid"].as_bool().unwrap_or(false) {
        let letters = ev.data["word"].as_str().unwrap_or("").chars().filter(|c| c.is_alphanumeric()).count() as i64;
        s.words += 1;
        g.add_score(letters * s.per_letter);
        put(g, "score", "words", json!(s.words));
    }
});

struct RhythmAccuracy {
    perfect: i64,
    good: i64,
    counts: [i64; 3],
}
system!(RhythmAccuracy, "score.rhythm_accuracy", |s, ev, g| {
    if ev.name != "beat.hit" {
        return;
    }
    let (slot, pts) = match ev.data["grade"].as_str().unwrap_or("miss") {
        "perfect" => (0, s.perfect),
        "good" => (1, s.good),
        _ => (2, 0),
    };
    s.counts[slot] += 1;
    g.add_score(pts);
    put(g, "score", "rhythm", json!({ "perfect": s.counts[0], "good": s.counts[1], "miss": s.counts[2] }));
});

fn parse_points(v: &Value) -> Vec<(f64, f64)> {
    let Some(arr) = v.as_array() else { return Vec::new() };
    arr.iter()
        .filter_map(|p| match p {
            Value::Array(a) => Some((a.first()?.as_f64()?, a.get(1)?.as_f64()?)),
            Value::Object(_) => Some((p["x"].as_f64()?, p["y"].as_f64()?)),
            _ => None,
        })
        .collect()
}

/// Resample a polyline to `n` evenly spaced points and fit it into the unit box.
fn normalize_shape(pts: &[(f64, f64)], n: usize) -> Vec<(f64, f64)> {
    if pts.is_empty() {
        return Vec::new();
    }
    let mut cum = vec![0.0];
    for w in pts.windows(2) {
        let d = ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
        cum.push(cum.last().copied().unwrap_or(0.0) + d);
    }
    let total = cum.last().copied().unwrap_or(0.0);
    let mut out = Vec::with_capacity(n);
    let mut seg = 0;
    for i in 0..n {
        let target = if n > 1 { total * i as f64 / (n - 1) as f64 } else { 0.0 };
        while seg + 2 < pts.len() && cum[seg + 1] < target {
            seg += 1;
        }
        if pts.len() == 1 || total <= 0.0 {
            out.push(pts[0]);
            continue;
        }
        let span = (cum[seg + 1] - cum[seg]).max(1e-9);
        let t = ((target - cum[seg]) / span).clamp(0.0, 1.0);
        out.push((pts[seg].0 + (pts[seg + 1].0 - pts[seg].0) * t, pts[seg].1 + (pts[seg + 1].1 - pts[seg].1) * t));
    }
    let (minx, maxx) = out.iter().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.0), a.1.max(p.0)));
    let (miny, maxy) = out.iter().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.1), a.1.max(p.1)));
    let scale = (maxx - minx).max(maxy - miny).max(1e-9);
    let (cx, cy) = ((minx + maxx) / 2.0, (miny + maxy) / 2.0);
    out.into_iter().map(|p| ((p.0 - cx) / scale, (p.1 - cy) / scale)).collect()
}

/// Shape similarity in 0..=1 (1 = identical up to translation, scale and drawing direction).
fn shape_similarity(a: &[(f64, f64)], b: &[(f64, f64)]) -> f64 {
    const N: usize = 32;
    let (a, b) = (normalize_shape(a, N), normalize_shape(b, N));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let dist = |x: &[(f64, f64)], y: &[(f64, f64)]| -> f64 {
        x.iter().zip(y).map(|(p, q)| ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt()).sum::<f64>() / N as f64
    };
    let rev: Vec<(f64, f64)> = b.iter().rev().copied().collect();
    let d = dist(&a, &b).min(dist(&a, &rev));
    (1.0 - d * 2.0).clamp(0.0, 1.0)
}

struct DrawingSimilarity {
    threshold: f64,
}
system!(DrawingSimilarity, "score.drawing_similarity", |s, ev, g| {
    if ev.name != "input.draw" {
        return;
    }
    let reference = g.custom.get("reference_shape").map(parse_points).unwrap_or_default();
    if reference.len() < 2 {
        g.warn("score.drawing_similarity has no reference shape (use content.reference_drawing)");
        return;
    }
    let sim = shape_similarity(&parse_points(&ev.data["points"]), &reference);
    put(g, "score", "drawing_similarity", json!(r2(sim)));
    let pass = sim >= s.threshold;
    if pass {
        g.add_score((sim * 100.0).round() as i64);
    }
    if g.round.active && !g.round.locked {
        g.round.locked = true;
        resolve_round(g, pass);
    }
});

/// Resolve the active round as correct/wrong and announce it (as rule.single_answer does).
fn resolve_round(g: &mut Game, correct: bool) {
    let round = g.round_no;
    if correct {
        g.round.outcome = Outcome::Correct;
        g.round.locked = true;
        let ms = g.round.elapsed_us / 1000;
        g.emit("answer.correct", json!({ "round": round, "ms": ms }));
    } else {
        if g.round.outcome != Outcome::Correct {
            g.round.outcome = Outcome::Wrong;
        }
        g.emit("answer.wrong", json!({ "round": round, "index": -1 }));
    }
}

// ---------------------------------------------------------------- content

/// Append the items of `kind` (seeded-shuffled when items are shuffled) to the round order.
fn claim_order(g: &mut Game, kind: &str, cap: usize) {
    let mut mine: Vec<usize> = g.items.iter().enumerate().filter(|(_, it)| it.kind == kind).map(|(i, _)| i).collect();
    if g.shuffle_items {
        g.rng.shuffle(&mut mine);
    }
    if cap > 0 {
        mine.truncate(cap);
    }
    for i in mine {
        if !g.order.contains(&i) {
            g.order.push(i);
        }
    }
}

fn items_of(g: &Game, kind: &str) -> Vec<Item> {
    g.items.iter().filter(|it| it.kind == kind).cloned().collect()
}

fn normalize_text(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

struct WordList {
    min: i64,
    max: i64,
}
system!(WordList, "content.word_list", |s, ev, g| {
    if ev.name != "session.loaded" {
        return;
    }
    let mut seen: Vec<String> = Vec::new();
    let mut words: Vec<String> = Vec::new();
    let mut hints = Map::new();
    for it in items_of(g, "word") {
        let w = it.prompt.trim().to_string();
        let len = w.chars().count() as i64;
        if len < s.min || (s.max > 0 && len > s.max) || seen.contains(&w.to_lowercase()) {
            continue;
        }
        seen.push(w.to_lowercase());
        if let Some(c) = &it.clue {
            hints.insert(w.clone(), json!(c));
        }
        words.push(w);
    }
    if g.shuffle_items {
        g.rng.shuffle(&mut words);
    }
    g.custom.insert("words".into(), json!(words));
    put(g, "content", "words", json!(words));
    put(g, "content", "word_hints", Value::Object(hints));
});

struct EmojiSet {
    count: i64,
}
system!(EmojiSet, "content.emoji_set", |s, ev, g| {
    if ev.name != "session.loaded" {
        return;
    }
    let mut set: Vec<String> = Vec::new();
    for it in items_of(g, "emoji") {
        let tokens: Vec<String> = if it.choices.is_empty() {
            it.prompt.split_whitespace().map(str::to_string).collect()
        } else {
            it.choices.clone()
        };
        for t in tokens {
            if !set.contains(&t) {
                set.push(t);
            }
        }
    }
    if g.shuffle_items {
        g.rng.shuffle(&mut set);
    }
    set.truncate(s.count.max(0) as usize);
    put(g, "content", "emoji", json!(set));
});

/// Content kinds that play as multiple-choice rounds (caption, fill-in-the-blank, audio clip).
struct QuizKind {
    id: &'static str,
    kind: &'static str,
    default_prompt: &'static str,
    clip_ms: i64,
}
impl System for QuizKind {
    fn id(&self) -> &'static str {
        self.id
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        match ev.name.as_str() {
            "session.loaded" => claim_order(g, self.kind, 0),
            "round.started" => {
                let Some(item) = g.current_item().cloned() else { return };
                if item.kind != self.kind {
                    return;
                }
                if g.round.choices.is_empty() {
                    let mut idxs: Vec<usize> = (0..item.choices.len()).collect();
                    if g.shuffle_choices {
                        g.rng.shuffle(&mut idxs);
                    }
                    let answer = item.answer.unwrap_or(0).max(0) as usize;
                    g.round.correct = idxs.iter().position(|i| *i == answer).unwrap_or(0);
                    g.round.choices = idxs.iter().map(|i| item.choices[*i].clone()).collect();
                    g.round.states = vec!["idle"; idxs.len()];
                }
                g.round.prompt = if item.prompt.is_empty() { self.default_prompt.to_string() } else { item.prompt.clone() };
                g.round.clue = item.clue.clone();
                if self.kind == "caption" {
                    g.round.media_url = item.media_url.clone();
                }
                if self.kind == "audio" {
                    put(g, "content", "audio", json!({ "url": item.media_url, "clip_ms": self.clip_ms, "round": g.round_no }));
                }
            }
            _ => {}
        }
    }
}

struct PairDeck {
    pairs: i64,
}
system!(PairDeck, "content.pair_deck", |s, ev, g| {
    if ev.name != "session.loaded" {
        return;
    }
    let mut pairs = items_of(g, "pair");
    pairs.truncate(s.pairs.max(0) as usize);
    let mut cards: Vec<Value> = Vec::new();
    for (i, it) in pairs.iter().enumerate() {
        let b = it.choices.first().cloned().or_else(|| it.clue.clone()).unwrap_or_default();
        cards.push(json!({ "pair": i, "face": it.prompt, "media_url": it.media_url }));
        cards.push(json!({ "pair": i, "face": b, "media_url": Value::Null }));
    }
    g.rng.shuffle(&mut cards);
    put(g, "content", "deck", json!({ "pairs": pairs.len(), "cards": cards }));
});

struct ImageSequence {
    length: i64,
}
system!(ImageSequence, "content.image_sequence", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => {
            let mut chrono = items_of(g, "sequence");
            chrono.truncate(s.length.max(0) as usize);
            let mut shown = chrono.clone();
            g.rng.shuffle(&mut shown);
            if shown.len() > 1 && shown.iter().zip(&chrono).all(|(a, b)| a.id == b.id) {
                shown.rotate_left(1);
            }
            let view = |l: &[Item]| -> Vec<Value> {
                l.iter().map(|i| json!({ "id": i.id, "media_url": i.media_url, "label": i.prompt })).collect()
            };
            let answer: Vec<&str> = chrono.iter().map(|i| i.id.as_str()).collect();
            put(g, "content", "sequence", json!({ "shown": view(&shown), "answer": answer }));
        }
        _ => {}
    }
});

struct RiddleSet {
    attempts: i64,
    accepted: Vec<String>,
}
const RIDDLE_ATTEMPTS: i64 = 3;
system!(RiddleSet, "content.riddle_set", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => claim_order(g, "riddle", 0),
        "round.started" => {
            let Some(item) = g.current_item().cloned() else { return };
            if item.kind != "riddle" {
                s.accepted.clear();
                return;
            }
            s.attempts = 0;
            s.accepted = item.choices.iter().map(|c| normalize_text(c)).filter(|c| !c.is_empty()).collect();
            g.round.prompt = item.prompt.clone();
            g.round.clue = item.clue.clone();
            let letters = item.choices.first().map(|c| c.chars().filter(|x| x.is_alphanumeric()).count()).unwrap_or(0);
            put(g, "content", "riddle", json!({ "active": true, "hint": item.clue, "letters": letters,
                "attempts_left": RIDDLE_ATTEMPTS, "answer": Value::Null }));
        }
        "input.text" => {
            if !g.round.active || g.round.locked || s.accepted.is_empty() {
                return;
            }
            let guess = normalize_text(ev.data["text"].as_str().unwrap_or(""));
            if guess.is_empty() {
                return;
            }
            if s.accepted.contains(&guess) {
                resolve_round(g, true);
            } else {
                s.attempts += 1;
                if s.attempts >= RIDDLE_ATTEMPTS {
                    g.round.locked = true;
                }
                resolve_round(g, false);
                put(g, "content", "riddle", json!({ "active": true, "attempts_left": (RIDDLE_ATTEMPTS - s.attempts).max(0),
                    "hint": g.round.clue, "answer": Value::Null }));
            }
        }
        "round.ended" => {
            if !s.accepted.is_empty() {
                let answer = g.current_item().and_then(|i| i.choices.first().cloned());
                put(g, "content", "riddle", json!({ "active": false, "answer": answer }));
            }
        }
        _ => {}
    }
});

struct TriviaCategory {
    category: String,
}
impl TriviaCategory {
    fn matches(&self, it: &Item) -> bool {
        if self.category.is_empty() || self.category == "general" {
            return true;
        }
        let c = self.category.to_lowercase();
        let id = it.id.to_lowercase();
        id.starts_with(&format!("{c}:")) || id.starts_with(&format!("{c}/"))
    }
}
system!(TriviaCategory, "content.trivia_category", |s, ev, g| {
    if ev.name != "session.loaded" {
        return;
    }
    let ok: Vec<usize> = g.items.iter().enumerate().filter(|(_, it)| s.matches(it)).map(|(i, _)| i).collect();
    let base: Vec<usize> = if g.order.is_empty() {
        g.items.iter().enumerate().filter(|(_, it)| it.kind == "question" || it.kind.is_empty()).map(|(i, _)| i).collect()
    } else {
        g.order.clone()
    };
    let mut order: Vec<usize> = base.into_iter().filter(|i| ok.contains(i)).collect();
    if order.is_empty() {
        g.warn(format!("content.trivia_category found no '{}' questions; using all", s.category));
        order = ok;
    } else if g.order.is_empty() && g.shuffle_items {
        g.rng.shuffle(&mut order);
    }
    g.order = order;
    put(g, "content", "category", json!(s.category));
});

struct UserMediaPool {
    max: i64,
    pool: Vec<Value>,
    filled: i64,
}
system!(UserMediaPool, "content.user_media_pool", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => {
            let mut media = items_of(g, "media");
            if g.shuffle_items {
                g.rng.shuffle(&mut media);
            }
            media.truncate(s.max.max(0) as usize);
            s.pool = media
                .iter()
                .filter(|m| m.media_url.is_some())
                .map(|m| json!({ "id": m.id, "url": m.media_url, "caption": m.prompt }))
                .collect();
            put(g, "content", "media", json!(s.pool));
        }
        "tick" => {
            if g.round.active && g.round_no != s.filled {
                s.filled = g.round_no;
                if g.round.media_url.is_none() && !s.pool.is_empty() {
                    let pick = &s.pool[(g.round_no.max(1) as usize - 1) % s.pool.len()];
                    g.round.media_url = pick["url"].as_str().map(str::to_string);
                }
            }
        }
        _ => {}
    }
});

struct MapPins {
    target: Option<(f64, f64, f64)>,
}
system!(MapPins, "content.map_pins", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => claim_order(g, "pin", 0),
        "round.started" => {
            s.target = None;
            let Some(item) = g.current_item().cloned() else { return };
            if item.kind != "pin" {
                return;
            }
            let num = |i: usize| item.choices.get(i).and_then(|c| c.trim().parse::<f64>().ok());
            if let (Some(x), Some(y)) = (num(0), num(1)) {
                let r = num(2).unwrap_or(0.12);
                s.target = Some((x, y, r));
                g.round.prompt = format!("Where is {}?", item.prompt);
                g.round.clue = item.clue.clone();
                put(g, "content", "pin", json!({ "name": item.prompt, "radius": r, "target": Value::Null }));
            }
        }
        "input.tap" => {
            let Some((tx, ty, r)) = s.target else { return };
            if !g.round.active || g.round.locked {
                return;
            }
            let (Some(x), Some(y)) = (ev.data["x"].as_f64(), ev.data["y"].as_f64()) else { return };
            let hit = ((x - tx).powi(2) + (y - ty).powi(2)).sqrt() <= r;
            g.round.locked = true;
            resolve_round(g, hit);
        }
        "round.ended" => {
            if let Some((tx, ty, r)) = s.target {
                let name = g.current_item().map(|i| i.prompt.clone()).unwrap_or_default();
                put(g, "content", "pin", json!({ "name": name, "radius": r, "target": { "x": tx, "y": ty } }));
            }
        }
        _ => {}
    }
});

struct ReferenceDrawing;
system!(ReferenceDrawing, "content.reference_drawing", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => claim_order(g, "shape", 0),
        "round.started" => {
            let Some(item) = g.current_item().cloned() else { return };
            if item.kind != "shape" {
                return;
            }
            let pts: Vec<Value> = item
                .choices
                .iter()
                .filter_map(|c| {
                    let (x, y) = c.split_once(',')?;
                    Some(json!([x.trim().parse::<f64>().ok()?, y.trim().parse::<f64>().ok()?]))
                })
                .collect();
            g.round.prompt = format!("Draw: {}", item.prompt);
            g.custom.insert("reference_shape".into(), json!(pts));
            put(g, "content", "shape", json!({ "name": item.prompt, "points": pts }));
        }
        _ => {}
    }
});

const BEAT_PERFECT_MS: i64 = 80;
const BEAT_GOOD_MS: i64 = 160;
const BEAT_CATCH_MS: i64 = 250;

struct Beatmap {
    notes: Vec<i64>,
    judged: Vec<bool>,
    ticks: u64,
    started: bool,
    counts: [i64; 3],
}
impl Beatmap {
    fn publish(&self, g: &mut Game) {
        let t = ms_of(self.ticks);
        let upcoming: Vec<i64> =
            self.notes.iter().zip(&self.judged).filter(|(n, j)| !**j && **n <= t + 2000).map(|(n, _)| *n).collect();
        put(g, "content", "beats", json!({ "t_ms": t, "total": self.notes.len(), "upcoming": upcoming,
            "perfect": self.counts[0], "good": self.counts[1], "miss": self.counts[2] }));
    }
}
system!(Beatmap, "content.beatmap", |s, ev, g| {
    match ev.name.as_str() {
        "session.loaded" => {
            s.notes = items_of(g, "beat")
                .iter()
                .flat_map(|it| it.choices.iter().filter_map(|c| c.trim().parse::<i64>().ok()))
                .collect();
            s.notes.sort_unstable();
            s.judged = vec![false; s.notes.len()];
            s.publish(g);
        }
        "session.started" => {
            s.started = true;
            s.ticks = 0;
        }
        "tick" if s.started => {
            s.ticks += 1;
            let t = ms_of(s.ticks);
            for i in 0..s.notes.len() {
                if !s.judged[i] && t > s.notes[i] + BEAT_GOOD_MS {
                    s.judged[i] = true;
                    s.counts[2] += 1;
                    g.emit("beat.hit", json!({ "grade": "miss", "note": i }));
                }
            }
            s.publish(g);
        }
        "input.tap" if s.started => {
            let t = ms_of(s.ticks);
            let best = (0..s.notes.len())
                .filter(|i| !s.judged[*i] && (s.notes[*i] - t).abs() <= BEAT_CATCH_MS)
                .min_by_key(|i| ((s.notes[*i] - t).abs(), *i));
            if let Some(i) = best {
                let off = (s.notes[i] - t).abs();
                s.judged[i] = true;
                let grade = if off <= BEAT_PERFECT_MS {
                    s.counts[0] += 1;
                    "perfect"
                } else if off <= BEAT_GOOD_MS {
                    s.counts[1] += 1;
                    "good"
                } else {
                    s.counts[2] += 1;
                    "miss"
                };
                g.emit("beat.hit", json!({ "grade": grade, "note": i, "offset_ms": off }));
                s.publish(g);
            }
        }
        _ => {}
    }
});

// ---------------------------------------------------------------- social

/// Leaderboard snapshot: `entries` is `[{name, score}]` from content; the player is inserted as "you".
fn board(g: &Game, entries: &Value, top: usize, fin: bool) -> Value {
    let me = copy_at(g, "social", "me").get("name").and_then(Value::as_str).unwrap_or("You").to_string();
    let mut rows: Vec<(String, i64, bool)> = entries
        .as_array()
        .map(|a| {
            a.iter()
                .map(|e| (e["name"].as_str().unwrap_or("?").to_string(), e["score"].as_i64().unwrap_or(0), false))
                .collect()
        })
        .unwrap_or_default();
    rows.push((me, g.score, true));
    rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.2.cmp(&b.2)).then(a.0.cmp(&b.0)));
    let you_rank = rows.iter().position(|r| r.2).map_or(0, |i| i + 1);
    let row = |i: usize, r: &(String, i64, bool)| json!({ "rank": i + 1, "name": r.0, "score": r.1, "you": r.2 });
    let mut out: Vec<Value> = rows.iter().enumerate().take(top).map(|(i, r)| row(i, r)).collect();
    if you_rank > top {
        out.push(row(you_rank - 1, &rows[you_rank - 1]));
    }
    json!({ "rows": out, "you_rank": you_rank, "total": rows.len(), "final": fin })
}

fn is_final(name: &str) -> bool {
    name == "game.over" || name == "session.ended"
}

struct ChallengeFriend {
    max: i64,
}
system!(ChallengeFriend, "social.challenge_friend", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let score = g.score;
    put(g, "social", "challenge", json!({ "ready": true, "max_recipients": s.max, "score": score }));
    if ev.name == "game.over" {
        g.emit("challenge.sent", json!({ "mode": "challenge", "score": score, "max_recipients": s.max }));
    }
});

struct FriendsLeaderboard {
    top: usize,
}
system!(FriendsLeaderboard, "social.friends_leaderboard", |s, ev, g| {
    if ev.name == "session.loaded" || is_final(&ev.name) {
        let entries = copy_at(g, "social", "friends");
        let b = board(g, &entries, s.top, is_final(&ev.name));
        put(g, "social", "friends_leaderboard", b);
    }
});

struct GroupScoreboard {
    friends: bool,
}
system!(GroupScoreboard, "social.group_scoreboard", |s, ev, g| {
    if ev.name == "session.loaded" || is_final(&ev.name) {
        let entries = copy_at(g, "social", if s.friends { "friends" } else { "group" });
        let mut b = board(g, &entries, 20, is_final(&ev.name));
        b["scope"] = json!(if s.friends { "friends" } else { "group" });
        put(g, "social", "group_scoreboard", b);
    }
});

struct GhostReplay {
    opacity: f64,
    ticks: u64,
    last: Option<i64>,
}
impl GhostReplay {
    fn ghost_score(&self, g: &Game) -> i64 {
        let ghost = copy_at(g, "social", "ghost");
        let t = ms_of(self.ticks);
        match ghost["series"].as_array() {
            Some(series) => series
                .iter()
                .filter(|p| p[0].as_i64().unwrap_or(i64::MAX) <= t)
                .last()
                .and_then(|p| p[1].as_i64())
                .unwrap_or(0),
            None => ghost["score"].as_i64().unwrap_or(0),
        }
    }
    fn publish(&mut self, g: &mut Game) {
        let score = self.ghost_score(g);
        let name = copy_at(g, "social", "ghost")["name"].as_str().unwrap_or("Ghost").to_string();
        let delta = g.score - score;
        put(g, "social", "ghost", json!({ "name": name, "opacity": self.opacity, "score": score, "delta": delta, "ahead": delta > 0 }));
        if self.last != Some(score) {
            self.last = Some(score);
            g.emit("ghost.updated", json!({ "score": score }));
        }
    }
}
system!(GhostReplay, "social.ghost_replay",
    init |s, g| { s.publish(g); },
    |s, ev, g| {
        match ev.name.as_str() {
            "tick" => {
                s.ticks += 1;
                s.publish(g);
            }
            "score.changed" => s.publish(g),
            _ => {}
        }
    });

struct AsyncVersus;
system!(AsyncVersus, "social.async_versus", |s, ev, g| {
    if ev.name != "session.loaded" && !is_final(&ev.name) {
        return;
    }
    let opp = copy_at(g, "social", "opponent");
    let fin = is_final(&ev.name);
    let status = match (fin, opp["score"].as_i64()) {
        (true, Some(o)) if g.score > o => "win",
        (true, Some(o)) if g.score < o => "lose",
        (true, Some(_)) => "tie",
        (true, None) => "waiting",
        _ => "pending",
    };
    let score = g.score;
    put(g, "social", "versus", json!({ "opponent": opp, "you": score, "status": status, "same_seed": true }));
    if ev.name == "game.over" {
        g.emit("challenge.sent", json!({ "mode": "async_versus", "score": score }));
    }
});

struct CoopScore;
fn coop_publish(g: &mut Game) {
    let others = copy_at(g, "social", "coop");
    let members: Vec<Value> = others.as_array().cloned().unwrap_or_default();
    let others_total: i64 = members.iter().map(|m| m["score"].as_i64().unwrap_or(0)).sum();
    let mine = g.score;
    put(g, "social", "coop", json!({ "mine": mine, "others": others_total, "pool": mine + others_total, "members": members }));
}
system!(CoopScore, "social.coop_score",
    init |s, g| { coop_publish(g); },
    |s, ev, g| {
        if ev.name == "score.changed" || is_final(&ev.name) {
            coop_publish(g);
        }
    });

struct ReactionStickers;
system!(ReactionStickers, "social.reaction_stickers",
    init |s, g| {
        let counts = copy_at(g, "social", "reactions");
        put(g, "social", "reactions", json!({ "available": ["🔥", "😂", "👏", "😮", "❤️"], "enabled": false, "counts": counts }));
    },
    |s, ev, g| {
        if ev.name == "game.over" {
            let counts = copy_at(g, "social", "reactions");
            put(g, "social", "reactions", json!({ "available": ["🔥", "😂", "👏", "😮", "❤️"], "enabled": true, "counts": counts }));
        }
    });

struct CommentOnResult;
system!(CommentOnResult, "social.comment_on_result",
    init |s, g| {
        let items = copy_at(g, "social", "comments");
        put(g, "social", "comments", json!({ "enabled": false, "max_len": 140, "items": items }));
    },
    |s, ev, g| {
        if ev.name == "game.over" {
            let items = copy_at(g, "social", "comments");
            put(g, "social", "comments", json!({ "enabled": true, "max_len": 140, "items": items }));
        }
    });

struct TagFriendInPhoto;
fn people_in(g: &Game) -> (Option<String>, Vec<Value>) {
    let media = g.current_item().and_then(|i| i.media_id.clone());
    let people = media
        .as_ref()
        .and_then(|m| copy_at(g, "social", "tags").get(m).and_then(Value::as_array).cloned())
        .unwrap_or_default();
    (media, people)
}
system!(TagFriendInPhoto, "social.tag_friend_in_photo", |s, ev, g| {
    match ev.name.as_str() {
        "round.started" => {
            let (media, people) = people_in(g);
            put(g, "social", "tags", json!({ "media_id": media, "count": people.len(), "people": Value::Null }));
        }
        "round.ended" => {
            let (media, people) = people_in(g);
            put(g, "social", "tags", json!({ "media_id": media, "count": people.len(), "people": people }));
        }
        _ => {}
    }
});

struct Rematch;
system!(Rematch, "social.rematch", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let score = g.score;
    put(g, "social", "rematch", json!({ "available": true, "same_seed": true, "score": score }));
    if ev.name == "game.over" {
        g.emit("challenge.sent", json!({ "mode": "rematch", "score": score }));
    }
});

struct Spectate {
    ticks: u64,
    seq: u64,
}
system!(Spectate, "social.spectate", |s, ev, g| {
    if ev.name != "tick" {
        return;
    }
    s.ticks += 1;
    if s.ticks % 6 == 0 {
        s.seq += 1;
        let frame = json!({ "seq": s.seq, "t_ms": ms_of(s.ticks), "score": g.score, "round": g.round_no,
            "total_rounds": g.total_rounds, "streak": g.streak, "time_left_ms": g.time_left_ms() });
        put(g, "social", "spectate", frame);
    }
});

struct FollowCreator;
system!(FollowCreator, "social.follow_creator",
    init |s, g| { put(g, "social", "follow", json!({ "show": false, "creator": Value::Null })); },
    |s, ev, g| {
        if ev.name == "game.over" {
            let creator = copy_at(g, "social", "creator");
            put(g, "social", "follow", json!({ "show": true, "creator": creator }));
        }
    });

// ---------------------------------------------------------------- share

fn share_emit(g: &mut Game, kind: &str) {
    g.emit("share.requested", json!({ "kind": kind }));
}

fn result_line(g: &Game) -> String {
    let total = g.stats.correct + g.stats.wrong;
    format!("{}: {} pts, {}/{} correct, best streak {}", g.title, g.score, g.stats.correct, total, g.stats.best_streak)
}

struct ReplayClip {
    max_seconds: i64,
    ticks: u64,
}
system!(ReplayClip, "share.replay_clip", |s, ev, g| {
    if ev.name == "tick" {
        s.ticks += 1;
    } else if is_final(&ev.name) {
        let start = (s.ticks as i64 - s.max_seconds * 60).max(0);
        put(g, "share", "replay_clip", json!({ "max_seconds": s.max_seconds, "start_tick": start, "end_tick": s.ticks, "total_ticks": s.ticks }));
        if ev.name == "game.over" {
            share_emit(g, "replay_clip");
        }
    }
});

struct DailyStreak;
system!(DailyStreak, "share.daily_streak", |s, ev, g| {
    if ev.name != "session.loaded" && !is_final(&ev.name) {
        return;
    }
    let info = copy_at(g, "share", "daily_streak");
    let days = info["days"].as_i64().unwrap_or(0);
    let counted = info["played_today"].as_bool().unwrap_or(false);
    let now = if is_final(&ev.name) && !counted { days + 1 } else { days };
    put(g, "share", "daily_streak", json!({ "days": now, "text": format!("🔥 {now}-day streak on {}", g.title) }));
    if ev.name == "game.over" {
        share_emit(g, "daily_streak");
    }
});

struct EmojiGrid {
    correct: String,
    wrong: String,
    cells: Vec<Option<bool>>,
}
system!(EmojiGrid, "share.result_emoji_grid", |s, ev, g| {
    let (ok, round) = match ev.name.as_str() {
        "answer.correct" => (true, ev.data["round"].as_i64().unwrap_or(g.round_no)),
        "answer.wrong" | "timer.expired" => (false, ev.data["round"].as_i64().unwrap_or(g.round_no)),
        "game.over" => {
            share_emit(g, "result_emoji_grid");
            return;
        }
        _ => return,
    };
    let idx = (round.max(1) - 1) as usize;
    if s.cells.len() <= idx {
        s.cells.resize(idx + 1, None);
    }
    if s.cells[idx] != Some(true) {
        s.cells[idx] = Some(ok);
    }
    let marks: Vec<&str> = s.cells.iter().map(|c| if *c == Some(true) { s.correct.as_str() } else { s.wrong.as_str() }).collect();
    let rows: Vec<String> = marks.chunks(5).map(|c| c.concat()).collect();
    put(g, "share", "emoji_grid", json!({ "grid": rows.join("\n"), "rows": rows }));
});

struct InviteLink;
system!(InviteLink, "share.invite_link", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let url = copy_at(g, "share", "invite_url");
    let text = format!("Can you beat {} in {}?", g.score, g.title);
    put(g, "share", "invite", json!({ "url": url, "text": text }));
    if ev.name == "game.over" {
        share_emit(g, "invite_link");
    }
});

struct StoryExport {
    aspect: String,
}
system!(StoryExport, "share.story_export", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let (w, h) = if s.aspect == "1:1" { (1080, 1080) } else { (1080, 1920) };
    let story = json!({ "aspect": s.aspect, "width": w, "height": h, "title": g.title, "score": g.score,
        "headline": g.share_headline, "emoji": g.theme["emoji"], "palette": g.theme["palette"] });
    put(g, "share", "story", story);
    if ev.name == "game.over" {
        share_emit(g, "story_export");
    }
});

struct CopyResultText;
system!(CopyResultText, "share.copy_result_text", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let mut text = result_line(g);
    if let Some(grid) = g.ext_view.get("share").and_then(|o| o.get("emoji_grid")).and_then(|o| o["grid"].as_str()) {
        text = format!("{text}\n{grid}");
    }
    put(g, "share", "text", json!(text));
    if ev.name == "game.over" {
        share_emit(g, "copy_result_text");
    }
});

struct QrChallenge;
system!(QrChallenge, "share.qr_challenge", |s, ev, g| {
    if !is_final(&ev.name) {
        return;
    }
    let base = copy_at(g, "share", "challenge_url");
    let payload = match base.as_str().filter(|u| !u.is_empty()) {
        Some(u) => format!("{u}{}beat={}", if u.contains('?') { "&" } else { "?" }, g.score),
        None => format!("sg://challenge?beat={}", g.score),
    };
    put(g, "share", "qr", json!({ "payload": payload }));
    if ev.name == "game.over" {
        share_emit(g, "qr_challenge");
    }
});

// ---------------------------------------------------------------- feel

struct SoundPack {
    pack: String,
}
system!(SoundPack, "feel.sound_pack",
    init |s, g| { put(g, "sound", "pack", json!(s.pack)); },
    |s, ev, g| {});

struct MusicLoop {
    track: String,
    volume: f64,
}
impl MusicLoop {
    fn publish(&self, g: &mut Game, playing: bool) {
        put(g, "sound", "music", json!({ "track": self.track, "volume": self.volume, "playing": playing }));
    }
}
system!(MusicLoop, "feel.music_loop",
    init |s, g| { s.publish(g, false); },
    |s, ev, g| {
        match ev.name.as_str() {
            "session.started" | "session.resumed" => s.publish(g, true),
            "session.paused" | "session.ended" => s.publish(g, false),
            _ => {}
        }
    });

struct PaletteCycle {
    period_s: i64,
    ticks: u64,
}
system!(PaletteCycle, "feel.palette_cycle", |s, ev, g| {
    if ev.name != "tick" {
        return;
    }
    s.ticks += 1;
    let period_ms = s.period_s * 1000;
    let hue = (ms_of(s.ticks) % period_ms) * 360 / period_ms;
    put(g, "style", "palette_cycle", json!({ "hue": hue, "period_s": s.period_s }));
});

/// A style setting that is fixed for the whole session (`view.ext.style[key]`).
struct StyleFlag {
    id: &'static str,
    key: &'static str,
    val: Value,
}
impl System for StyleFlag {
    fn id(&self) -> &'static str {
        self.id
    }
    fn init(&mut self, g: &mut Game) {
        put(g, "style", self.key, self.val.clone());
    }
    fn on_event(&mut self, _ev: &Event, _g: &mut Game) {}
}

struct CameraZoom {
    amount: f64,
    n: u64,
}
system!(CameraZoom, "feel.camera_zoom", |s, ev, g| {
    if ev.name == "answer.correct" && !flag(g, "a11y", "reduced_motion") {
        s.n += 1;
        put(g, "fx", "zoom", json!({ "amount": s.amount, "n": s.n }));
    }
});

struct CozyMode;
system!(CozyMode, "feel.cozy_mode",
    init |s, g| {
        put(g, "style", "cozy", json!(true));
        let mut m = match g.theme.take() {
            Value::Object(m) => m,
            _ => Map::new(),
        };
        m.insert("mood".into(), json!("cozy"));
        g.theme = Value::Object(m);
    },
    |s, ev, g| {});

// ---------------------------------------------------------------- meta

/// Rescale the active round's timer by `f`, preserving time already spent.
fn scale_timer(g: &mut Game, f: f64) {
    let total = g.round.time_total_us;
    let spent = total - g.round.time_left_us;
    let total2 = (total as f64 * f) as i64;
    g.round.time_total_us = total2;
    g.round.time_left_us = (total2 - spent).max(1);
}

struct DailySeed;
system!(DailySeed, "meta.daily_seed",
    init |s, g| { put(g, "meta", "daily_seed", json!({ "enabled": true, "date": Value::Null })); },
    |s, ev, g| {
        if ev.name == "session.loaded" {
            let date = copy_at(g, "meta", "date");
            put(g, "meta", "daily_seed", json!({ "enabled": true, "date": date }));
        }
    });

struct AdaptiveDifficulty {
    aggr: f64,
    level: f64,
    scaled: i64,
}
system!(AdaptiveDifficulty, "meta.adaptive_difficulty",
    init |s, g| { put(g, "meta", "difficulty", json!(s.level)); },
    |s, ev, g| {
        match ev.name.as_str() {
            "round.ended" => {
                let step = s.aggr * 0.1;
                s.level = if g.round.outcome == Outcome::Correct { (s.level + step).min(1.0) } else { (s.level - step).max(0.0) };
                s.level = r2(s.level);
                put(g, "meta", "difficulty", json!(s.level));
                g.emit("difficulty.changed", json!({ "level": s.level }));
            }
            "tick" => {
                if g.round.active && g.round_no != s.scaled && g.round.time_total_us > 0 {
                    s.scaled = g.round_no;
                    scale_timer(g, 1.25 - 0.5 * s.level);
                }
            }
            _ => {}
        }
    });

struct Analytics {
    counts: BTreeMap<String, u64>,
}
system!(Analytics, "meta.analytics_events", |s, ev, g| {
    if ev.name == "tick" {
        return;
    }
    *s.counts.entry(ev.name.clone()).or_insert(0) += 1;
    if is_final(&ev.name) {
        let report = json!({ "counts": s.counts, "score": g.score, "correct": g.stats.correct, "wrong": g.stats.wrong,
            "best_streak": g.stats.best_streak, "rounds": g.round_no });
        put(g, "meta", "analytics", report);
    }
});

struct AbVariant {
    variants: i64,
}
system!(AbVariant, "meta.ab_variant", |s, ev, g| {
    if ev.name == "session.loaded" {
        let v = g.rng.below(s.variants as u32) as i64;
        g.custom.insert("ab_variant".into(), json!(v));
        put(g, "meta", "ab_variant", json!(v));
    }
});

struct DebugOverlay {
    ticks: u64,
    recent: VecDeque<String>,
}
system!(DebugOverlay, "meta.debug_overlay", |s, ev, g| {
    if ev.name == "tick" {
        s.ticks += 1;
        if s.ticks % 6 != 0 {
            return;
        }
    } else {
        s.recent.push_back(ev.name.clone());
        if s.recent.len() > 8 {
            s.recent.pop_front();
        }
    }
    let recent: Vec<&String> = s.recent.iter().collect();
    put(g, "meta", "debug", json!({ "tick": s.ticks, "recent": recent, "score": g.score, "round": g.round_no,
        "warnings": g.warnings.len() }));
});

fn moderation_reasons(text: &str) -> Vec<&'static str> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    let run = lower.chars().fold((0usize, 0usize), |(best, cur), c| {
        if c.is_ascii_digit() {
            (best.max(cur + 1), cur + 1)
        } else if matches!(c, ' ' | '-' | '(' | ')' | '+' | '.') {
            (best, cur)
        } else {
            (best, 0)
        }
    });
    if run.0 >= 9 || (lower.contains('@') && lower.rsplit('@').next().map_or(false, |d| d.contains('.'))) {
        out.push("contact_info");
    }
    if ["http://", "https://", "www."].iter().any(|k| lower.contains(k)) {
        out.push("link");
    }
    if ["idiot", "stupid", "loser", "hate you", "kill yourself"].iter().any(|k| lower.contains(k)) {
        out.push("abusive_language");
    }
    out
}

struct ModerationHint;
system!(ModerationHint, "meta.content_moderation_hint", |s, ev, g| {
    if ev.name != "session.loaded" {
        return;
    }
    let mut flags: Vec<Value> = Vec::new();
    for it in &g.items {
        let mut texts: Vec<&str> = vec![it.prompt.as_str()];
        texts.extend(it.choices.iter().map(String::as_str));
        texts.extend(it.clue.as_deref());
        let mut reasons: Vec<&'static str> = texts.iter().flat_map(|t| moderation_reasons(t)).collect();
        reasons.dedup();
        for r in reasons {
            flags.push(json!({ "item": it.id, "reason": r }));
        }
    }
    if !flags.is_empty() {
        g.warn(format!("content moderation hint: {} flagged item field(s)", flags.len()));
    }
    put(g, "meta", "moderation", json!({ "count": flags.len(), "flags": flags }));
});

struct InputRecorder {
    count: u64,
}
system!(InputRecorder, "meta.input_recorder",
    init |s, g| { put(g, "meta", "input_recorder", json!({ "recording": true, "count": 0 })); },
    |s, ev, g| {
        if ev.name == "input.raw" {
            s.count += 1;
            put(g, "meta", "input_recorder", json!({ "recording": true, "count": s.count }));
        }
    });

struct CheatGuard {
    min_ms: i64,
    flagged: bool,
    rejected: i64,
}
system!(CheatGuard, "meta.cheat_guard", |s, ev, g| {
    match ev.name.as_str() {
        "round.started" => s.flagged = false,
        "answer.correct" => {
            if ev.data["ms"].as_i64().unwrap_or(i64::MAX) < s.min_ms {
                s.flagged = true;
                let round = g.round_no;
                g.warn(format!("meta.cheat_guard: implausible answer time in round {round}"));
            }
        }
        "round.ended" if s.flagged => {
            s.flagged = false;
            s.rejected += 1;
            let earned = g.round_points;
            g.add_score(-earned);
            put(g, "meta", "cheat_guard", json!({ "rejected": s.rejected, "min_answer_ms": s.min_ms }));
        }
        _ => {}
    }
});

fn locale_strings(locale: &str) -> Vec<(&'static str, &'static str)> {
    let lang = locale.split('-').next().unwrap_or("en");
    let t: [&str; 8] = match lang {
        "es" => ["¡Correcto!", "Incorrecto", "¡Se acabó el tiempo!", "Fin del juego", "Puntos", "Jugar de nuevo", "Compartir", "Pausa"],
        "fr" => ["Correct !", "Incorrect", "Temps écoulé !", "Partie terminée", "Score", "Rejouer", "Partager", "Pause"],
        "de" => ["Richtig!", "Falsch", "Zeit abgelaufen!", "Spiel vorbei", "Punkte", "Nochmal spielen", "Teilen", "Pause"],
        "pt" => ["Correto!", "Errado", "Tempo esgotado!", "Fim de jogo", "Pontos", "Jogar de novo", "Compartilhar", "Pausa"],
        _ => ["Correct!", "Wrong", "Time's up!", "Game over", "Score", "Play again", "Share", "Paused"],
    };
    ["correct", "wrong", "times_up", "game_over", "score", "play_again", "share", "paused"].into_iter().zip(t).collect()
}

struct Locale {
    locale: String,
}
impl Locale {
    fn publish(&self, g: &mut Game) {
        let mut strings = Map::new();
        for (k, v) in locale_strings(&self.locale) {
            strings.insert(k.to_string(), json!(v));
        }
        if let Some(over) = g.copy.get("locales").and_then(|l| l.get(&self.locale)).and_then(Value::as_object) {
            for (k, v) in over {
                strings.insert(k.clone(), v.clone());
            }
        }
        let lang = self.locale.split('-').next().unwrap_or("en");
        let dir = if matches!(lang, "ar" | "he" | "fa" | "ur") { "rtl" } else { "ltr" };
        put(g, "meta", "locale", json!({ "locale": self.locale, "dir": dir, "strings": strings }));
    }
}
system!(Locale, "meta.locale",
    init |s, g| { s.publish(g); },
    |s, ev, g| {
        if ev.name == "session.loaded" {
            s.publish(g);
        }
    });

struct SchemaVersion {
    version: i64,
}
system!(SchemaVersion, "meta.schema_version",
    init |s, g| {
        put(g, "meta", "schema_version", json!(s.version));
        if s.version != 1 {
            g.warn(format!("meta.schema_version: unsupported schema version {}", s.version));
        }
    },
    |s, ev, g| {});

struct HotSeat {
    players: usize,
    scores: Vec<i64>,
    start_score: i64,
}
impl HotSeat {
    fn current(&self, g: &Game) -> usize {
        (g.round_no.max(1) as usize - 1) % self.players
    }
    fn publish(&self, g: &mut Game, winner: Value) {
        let cur = self.current(g);
        put(g, "meta", "hot_seat", json!({ "players": self.players, "current": cur, "scores": self.scores, "winner": winner }));
    }
}
system!(HotSeat, "meta.hot_seat",
    init |s, g| {
        s.scores = vec![0; s.players];
        s.publish(g, Value::Null);
    },
    |s, ev, g| {
        match ev.name.as_str() {
            "round.started" => {
                s.start_score = g.score;
                g.banner = format!("Player {}'s turn", s.current(g) + 1);
                s.publish(g, Value::Null);
            }
            "round.ended" => {
                let cur = s.current(g);
                s.scores[cur] += g.score - s.start_score;
                s.publish(g, Value::Null);
            }
            "game.over" => {
                let best = s.scores.iter().copied().max().unwrap_or(0);
                let leaders: Vec<usize> = (0..s.players).filter(|i| s.scores[*i] == best).collect();
                let winner = if leaders.len() == 1 { json!(leaders[0]) } else { json!("tie") };
                s.publish(g, winner);
            }
            _ => {}
        }
    });

// ---------------------------------------------------------------- accessibility

/// A fixed accessibility setting (`view.ext.a11y[key]`).
struct A11yFlag {
    id: &'static str,
    key: &'static str,
    val: Value,
}
impl System for A11yFlag {
    fn id(&self) -> &'static str {
        self.id
    }
    fn init(&mut self, g: &mut Game) {
        put(g, "a11y", self.key, self.val.clone());
    }
    fn on_event(&mut self, ev: &Event, g: &mut Game) {
        if self.key == "reduced_motion" && ev.name == "feedback.confetti" {
            g.confetti_us = 0;
        }
    }
}

struct HighContrast;
system!(HighContrast, "accessibility.high_contrast",
    init |s, g| {
        put(g, "a11y", "high_contrast", json!(true));
        put(g, "a11y", "palette", json!({ "bg": "#000000", "bg2": "#000000", "fg": "#ffffff", "accent": "#ffff00",
            "good": "#00ff6a", "bad": "#ff3b30" }));
    },
    |s, ev, g| {});

struct ColorblindPalette {
    mode: String,
    last_good: bool,
}
impl ColorblindPalette {
    fn colors(&self) -> (&'static str, &'static str) {
        if self.mode == "tritanopia" {
            ("#009e73", "#d55e00")
        } else {
            ("#0072b2", "#e69f00")
        }
    }
}
system!(ColorblindPalette, "accessibility.colorblind_palette",
    init |s, g| {
        let (good, bad) = s.colors();
        put(g, "a11y", "colorblind", json!({ "mode": s.mode, "good": good, "bad": bad, "symbols": true }));
    },
    |s, ev, g| {
        match ev.name.as_str() {
            "answer.correct" => s.last_good = true,
            "answer.wrong" | "timer.expired" => s.last_good = false,
            "feedback.flash" => {
                let (good, bad) = s.colors();
                if let Some(f) = g.flash.as_mut() {
                    f.0 = (if s.last_good { good } else { bad }).to_string();
                }
            }
            _ => {}
        }
    });

struct ScreenReaderLabels {
    announce: String,
    n: u64,
}
impl ScreenReaderLabels {
    fn publish(&self, g: &mut Game) {
        let total = g.round.choices.len();
        let choices: Vec<String> = g
            .round
            .choices
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let state = match g.round.states.get(i).copied().unwrap_or("idle") {
                    "correct" => ". Correct answer",
                    "wrong" => ". Your answer, incorrect",
                    _ => "",
                };
                format!("Choice {} of {}: {}{}", i + 1, total, c, state)
            })
            .collect();
        let mut status = format!("Round {} of {}. Score {}. Streak {}.", g.round_no, g.total_rounds, g.score, g.streak);
        if g.round.active && g.round.time_total_us > 0 {
            status.push_str(&format!(" {} seconds left.", (g.round.time_left_us + 999_999) / 1_000_000));
        }
        put(g, "a11y", "labels", json!({ "status": status, "prompt": g.round.prompt, "choices": choices,
            "announce": self.announce, "announce_n": self.n }));
    }
}
system!(ScreenReaderLabels, "accessibility.screen_reader_labels", |s, ev, g| {
    let said = match ev.name.as_str() {
        "answer.correct" => Some("Correct.".to_string()),
        "answer.wrong" => Some("Incorrect.".to_string()),
        "timer.expired" => Some("Time is up.".to_string()),
        "game.over" => Some(format!("Game over. Final score {}.", g.score)),
        "round.started" => Some(format!("Round {}.", g.round_no)),
        "tick" => None,
        _ => return,
    };
    if let Some(t) = said {
        s.announce = t;
        s.n += 1;
    }
    s.publish(g);
});

struct ExtendedTime {
    mult: f64,
    scaled: i64,
}
system!(ExtendedTime, "accessibility.extended_time",
    init |s, g| { put(g, "a11y", "time_multiplier", json!(s.mult)); },
    |s, ev, g| {
        if (ev.name == "tick" || ev.name == "round.started") && g.round.active && g.round_no != s.scaled && g.round.time_total_us > 0 {
            s.scaled = g.round_no;
            scale_timer(g, s.mult);
        }
    });

struct Captions {
    items: Vec<(u64, String, i64)>,
    next: u64,
}
system!(Captions, "accessibility.captions", |s, ev, g| {
    let text = match ev.name.as_str() {
        "answer.correct" => "[chime] Correct answer".to_string(),
        "answer.wrong" => "[buzz] Wrong answer".to_string(),
        "timer.expired" => "[buzz] Time is up".to_string(),
        "game.over" => "[fanfare] Game over".to_string(),
        "tick" => {
            if s.items.is_empty() {
                return;
            }
            for it in s.items.iter_mut() {
                it.2 -= TICK_US;
            }
            s.items.retain(|it| it.2 > 0);
            let list: Vec<Value> = s.items.iter().map(|(id, t, _)| json!({ "id": id, "text": t })).collect();
            put(g, "a11y", "captions", Value::Array(list));
            return;
        }
        _ => return,
    };
    s.next += 1;
    s.items.push((s.next, text, 2_500_000));
    if s.items.len() > 3 {
        s.items.remove(0);
    }
    let list: Vec<Value> = s.items.iter().map(|(id, t, _)| json!({ "id": id, "text": t })).collect();
    put(g, "a11y", "captions", Value::Array(list));
});
