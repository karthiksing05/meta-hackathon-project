// checks.js: the Bubble runtime test suite, shared by Node (run-node.js) and JavaScriptCore
// (run-jsc.sh). A plain script with no Node APIs: it defines BubbleRuntimeChecks.run(env) next to
// the loaded runtime and only needs Bubble plus the seed files.
//
//   env = { Bubble, seeds: [{name, json}], world (bubble-demo-world.json, optional), print(line),
//           now() (ms), clock: "cpu" | "wall", engine: "node" | "jsc", quick (fewer bot runs) }
//   Speed budgets are only asserted on a CPU clock: wall time on a busy machine is noise.
//   returns { passed, failed, failures: [..], skipped: [..], timings: {label: {n, avg, max}} }
(function (root) {
  "use strict";

  const COMMON = ["input.tap", "flow.run_retry", "flow.rounds", "flow.daily_gate", "share.emoji_grid",
    "share.score_card", "feel.mood_preset", "feel.sfx_on_action", "content.seed"];
  const ENGINE_SEEDS = ["newinsf-daily-fog-words", "picnic-icebreaker-whos-coming", "hill-hopper", "hill-hopper-2",
    "fog-drift", "moving-day"];
  const PARAM_TYPES = ["number", "integer", "boolean", "string", "enum", "string_list"];

  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
  function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  function codes(v) { return v.errors.map((e) => e.code); }
  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  function run(env) {
    const B = env.Bubble;
    const print = env.print;
    const now = env.now;
    const quick = !!env.quick;
    let passed = 0;
    let failed = 0;
    const failures = [];
    const skipped = [];
    const timings = {};

    function ok(cond, name, detail) {
      if (cond) passed++;
      else {
        failed++;
        const line = name + (detail ? ": " + detail : "");
        failures.push(line);
        print("  FAIL " + line);
      }
      return !!cond;
    }
    function section(title) { print("\n" + title); }
    function timed(label, fn) {
      const t0 = now();
      const out = fn();
      const ms = now() - t0;
      const t = timings[label] || (timings[label] = { n: 0, total: 0, max: 0 });
      t.n++; t.total += ms; if (ms > t.max) t.max = ms;
      return out;
    }
    function sim(m, o) { return timed("simulate (one run)", () => B.simulate(m, o)); }

    // ------------------------------------------------------------------ catalog and metadata
    section("Catalog and metadata");
    ok(B.version === "1.0.0", "Bubble.version is 1.0.0", B.version);
    ok(B.engine_version === 1, "Bubble.engine_version is 1");
    const cat = timed("catalogJSON", () => JSON.parse(B.catalogJSON()));
    const formulaIds = cat.formulas.map((f) => f.id);
    const conceptIds = cat.concepts.map((c) => c.id);
    ok(cat.version === "1.0.0" && cat.playfield.w === 360 && cat.playfield.h === 640 && cat.playfield.tick_rate === 60, "catalog header (version, 360x640 at 60 Hz)");
    ok(formulaIds.indexOf("dodge") >= 0 && formulaIds.indexOf("guess") >= 0, "dodge and guess formulas are registered", formulaIds.join(", "));
    ok(cat.load_warnings.length === 0, "no load warnings", JSON.stringify(cat.load_warnings));
    for (const id of COMMON) ok(conceptIds.indexOf(id) >= 0, "common concept " + id + " exists");
    ok(cat.palettes.length === 5 && cat.sounds.length >= 5 && cat.haptics.length >= 5 && Object.keys(cat.glue_slots).length >= 5, "palettes, sounds, haptics and glue slots are listed");
    let metaProblems = [];
    for (const c of cat.concepts) {
      if (cat.kinds.indexOf(c.kind) < 0 || c.id.split(".")[0] !== c.kind) metaProblems.push(c.id + ": kind");
      if (!c.describe || c.describe.length < 12) metaProblems.push(c.id + ": describe");
      if (!Array.isArray(c.emits) || !Array.isArray(c.consumes)) metaProblems.push(c.id + ": emits/consumes");
      for (const name of Object.keys(c.params)) {
        const p = c.params[name];
        if (PARAM_TYPES.indexOf(p.type) < 0) metaProblems.push(c.id + "." + name + ": type");
        if (!p.describe) metaProblems.push(c.id + "." + name + ": describe");
        if ((p.type === "number" || p.type === "integer") && (!(p.min > -1e9) || !(p.max < 1e9) || p.default < p.min || p.default > p.max)) metaProblems.push(c.id + "." + name + ": range");
        if (p.type === "enum" && (!p.values.length || p.values.indexOf(p.default) < 0)) metaProblems.push(c.id + "." + name + ": enum values");
      }
    }
    // Metadata quality for the concepts this suite's owners ship (other kits get the same check in their own suites).
    const ownKits = /^(input|flow|share|feel|content|score|rule|behavior|social|space|entity)\./;
    metaProblems = metaProblems.filter((p) => ownKits.test(p));
    ok(metaProblems.length === 0, "every concept has a describe line, typed params with describe, numeric ranges and valid defaults", metaProblems.slice(0, 8).join("; "));
    for (const f of cat.formulas) {
      ok(f.describe && f.content && f.content.describe && f.content.schema && f.has_bot, "formula " + f.id + " has describe, content schema and a bot");
      const examples = [f.example].concat(f.examples || []).filter(Boolean);
      ok(examples.length > 0, "formula " + f.id + " has an example");
      examples.forEach((ex, i) => {
        const v = B.validate(ex);
        ok(v.ok, "formula " + f.id + " example " + i + " (" + ex.id + ") validates", JSON.stringify(v.errors));
        if (v.ok) {
          const r = sim(ex, { bot_seed: 1, bot_skill: 0.7 });
          ok(r.ok && r.ticks > 60, "formula " + f.id + " example " + i + " plays with its bot", r.error || r.outcome + " in " + r.ticks + " ticks");
        }
      });
    }

    // ------------------------------------------------------------------ seeds
    section("Seeds");
    const valid = [];
    const byId = {};
    for (const s of env.seeds) {
      let m;
      try { m = JSON.parse(s.json); } catch (e) { ok(false, s.name + " is JSON", String(e)); continue; }
      if (formulaIds.indexOf(m.formula) < 0) {
        skipped.push(s.name + " (formula \"" + m.formula + "\" isn't loaded here)");
        continue;
      }
      const v = timed("validate (one seed)", () => B.validate(m));
      ok(v.ok, s.name + " validates", JSON.stringify(v.errors));
      ok(!m._placeholder, s.name + " is not a placeholder");
      byId[m.id] = m;
      if (v.ok) valid.push(m);
      print("  " + (v.ok ? "ok   " : "BAD  ") + m.id + " (" + m.formula + ")" + (v.warnings.length ? "  warnings: " + v.warnings.map((w) => w.message).join(" | ") : ""));
    }
    const ownSeeds = ENGINE_SEEDS.filter((id) => byId[id]);
    if (ownSeeds.length) {
      ok(ownSeeds.length === ENGINE_SEEDS.length, "all six engine seeds are present", ownSeeds.join(", "));
      for (const id of ownSeeds) ok(byId[id]._seed && typeof byId[id]._seed.creator_id === "string", id + " keeps its _seed block");
      ok(ownSeeds.some((id) => byId[id].glue && Object.keys(byId[id].glue).length), "at least one engine seed uses glue");
      if (byId["moving-day"]) ok(byId["moving-day"]._seed.creator_id === "me", "moving-day belongs to me");
      const h1 = byId["hill-hopper"], h2 = byId["hill-hopper-2"];
      if (h1 && h2) {
        ok(h1.chain && h2.chain && h1.chain.id === "chain-hill-hopper" && h2.chain.id === h1.chain.id && h1.chain.index === 1 && h2.chain.index === 2 &&
          h1.chain.next === "hill-hopper-2" && h2.chain.prev === "hill-hopper", "hill-hopper 1 and 2 form chain-hill-hopper");
        const seeds = quick ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6, 7, 8];
        const t1 = mean(seeds.map((bs) => sim(h1, { bot_seed: bs, bot_skill: 0.7 }).duration_sec));
        const t2 = mean(seeds.map((bs) => sim(h2, { bot_seed: bs, bot_skill: 0.7 }).duration_sec));
        ok(t2 < t1 && t2 > 8, "level 2 is harder than level 1 but survivable (bot 0.7 survives " + fmt(t1) + " s vs " + fmt(t2) + " s)");
      }
      const fog = byId["newinsf-daily-fog-words"];
      if (fog) {
        const words = fog.content.words || [];
        ok(words.length >= 5, "Fog Words has a word list");
        if (env.world && Array.isArray(env.world.sf_words)) {
          const pool = env.world.sf_words.map((w) => String(typeof w === "string" ? w : w.word || "").toUpperCase());
          ok(words.every((w) => pool.indexOf(w) >= 0), "Fog Words uses sf_words from the demo world", words.filter((w) => pool.indexOf(w) < 0).join(", "));
        }
      }
      const picnic = byId["picnic-icebreaker-whos-coming"];
      if (picnic) {
        const people = picnic.content.people || [];
        ok(people.length >= 5 && people.every((p) => p.name && p.avatar && p.facts && p.facts.length), "picnic icebreaker has people with names, portraits and facts");
        if (env.world && Array.isArray(env.world.people)) {
          const going = {};
          for (const p of env.world.people) if (p.going_to_picnic) going[p.id] = p;
          ok(people.every((p) => going[p.id] && p.name.indexOf(going[p.id].first_name) === 0), "picnic people are the demo world's picnic guests",
            people.filter((p) => !going[p.id]).map((p) => p.id).join(", "));
        }
      }
    }

    // ------------------------------------------------------------------ bot simulations
    section("Bot runs (skills 0.2 / 0.5 / 0.9)");
    const skills = [0.2, 0.5, 0.9];
    const botSeeds = quick ? [1, 2, 3] : [1, 2, 3, 4, 5, 6];
    for (const m of valid) {
      const rows = {};
      let errors = 0;
      for (const skill of skills) {
        rows[skill] = botSeeds.map((bs) => {
          const r = sim(m, { bot_seed: bs, bot_skill: skill });
          if (!r.ok) { errors++; ok(false, m.id + " bot run", r.error); }
          return r;
        });
      }
      if (errors) continue;
      const all = [].concat(rows[0.2], rows[0.5], rows[0.9]);
      ok(all.every((r) => ["success", "fail", "timeout"].indexOf(r.outcome) >= 0 && r.duration_sec <= 90.01), m.id + ": outcomes and durations are sane");
      ok(median(rows[0.9].map((r) => r.duration_sec)) >= 6, m.id + ": a strong bot doesn't fail instantly", "median " + fmt(median(rows[0.9].map((r) => r.duration_sec))) + " s");
      ok(rows[0.2].some((r) => r.outcome !== "timeout"), m.id + ": a weak bot's run ends (not endless)");
      ok(mean(rows[0.9].map((r) => r.score)) >= mean(rows[0.2].map((r) => r.score)), m.id + ": skill helps (mean score 0.9 >= 0.2)",
        fmt(mean(rows[0.9].map((r) => r.score))) + " vs " + fmt(mean(rows[0.2].map((r) => r.score))));
      ok(all.every((r) => r.share && r.share.headline && r.share.score_text), m.id + ": every run has a share headline and score text");
      if (m.concepts.some((c) => c.use === "share.emoji_grid")) ok(all.every((r) => typeof r.share.emoji_grid === "string" && r.share.emoji_grid.length > 0), m.id + ": emoji grid is filled");
      const line = skills.map((s) => s + ": " + rows[s].map((r) => r.outcome[0] + r.score + "/" + Math.round(r.duration_sec) + "s").join(" ")).join("  ");
      print("  " + m.id + "  " + line);
    }

    // ------------------------------------------------------------------ determinism
    section("Determinism and replays");
    for (const m of valid) {
      const opts = { bot_seed: 3, bot_skill: 0.6 };
      const a = JSON.parse(B.simulateJSON(JSON.stringify(m), JSON.stringify(opts)));
      const a2 = JSON.parse(B.simulateJSON(JSON.stringify(m), JSON.stringify(opts)));
      delete a2.ms;
      const aNoMs = copy(a); delete aNoMs.ms;
      ok(JSON.stringify(aNoMs) === JSON.stringify(a2), m.id + ": same options give an identical run");
      // Replay exactly like BubbleJSRuntime.verify: no bot, max_ticks = max(total + 120, 600). A run the
      // bot timed out replays with its own cap (a real run always ends by a rule).
      const replay = copy(a.replay);
      const maxTicks = a.outcome === "timeout" ? a.ticks : Math.max(a.replay.total_ticks + 120, 600);
      const b = JSON.parse(B.simulateJSON(JSON.stringify(m), JSON.stringify({ bot: false, replay, max_ticks: maxTicks })));
      const same = b.ok && a.outcome === b.outcome && a.score === b.score && a.ticks === b.ticks && JSON.stringify(a.events) === JSON.stringify(b.events);
      ok(same, m.id + ": replay reproduces score, ticks and event counts",
        a.outcome + " " + a.score + " @" + a.ticks + " vs " + b.outcome + " " + b.score + " @" + b.ticks + (b.error ? " " + b.error : ""));
      ok(a.replay.tick_rate === 60 && a.replay.total_ticks === a.ticks && Array.isArray(a.replay.inputs) && a.replay.seed !== undefined, m.id + ": replay log shape");
      const variety = {};
      for (const bs of [1, 2, 3, 4, 5]) { const r = sim(m, { bot_seed: bs, bot_skill: 0.6 }); variety[r.outcome + r.score + "@" + r.ticks] = 1; }
      ok(Object.keys(variety).length >= 2, m.id + ": bot seeds vary the runs");
    }

    // ------------------------------------------------------------------ negative cases
    section("Negative cases");
    const dodge = cat.formulas.find((f) => f.id === "dodge");
    const guess = cat.formulas.find((f) => f.id === "guess");
    const base = copy(dodge.example);
    function variant(edit) { const m = copy(base); edit(m); return B.validate(m); }
    function expect(code, v, name, text) {
      const hit = v.errors.find((e) => e.code === code);
      ok(!v.ok && !!hit && (!text || hit.message.indexOf(text) >= 0), name + " -> " + code + (text ? " (" + text + ")" : ""), JSON.stringify(v.errors));
    }
    function setParam(m, use, params) { const c = m.concepts.find((x) => x.use === use); c.params = Object.assign({}, c.params, params); }
    function glue(m, slot, source) { m.glue = { "glue.test": { slot, source } }; }
    ok(B.validate(base).ok, "the dodge example is valid before mutation");
    expect("unknown_concept", variant((m) => { m.concepts.find((c) => c.use === "input.tap").use = "input.tapp"; }), "unknown concept", "Did you mean \"input.tap\"");
    expect("unknown_formula", variant((m) => { m.formula = "dodg"; }), "unknown formula", "Did you mean \"dodge\"");
    expect("param_range", variant((m) => setParam(m, "behavior.gravity", { strength: 99 })), "param out of range");
    expect("param_type", variant((m) => setParam(m, "behavior.gravity", { strength: "strong" })), "param of the wrong type");
    expect("param_range", variant((m) => setParam(m, "entity.obstacle", { style: "spikes" })), "enum value not allowed");
    const unknownParam = variant((m) => setParam(m, "behavior.gravity", { strenght: 0.3 }));
    ok(unknownParam.ok && unknownParam.warnings.some((w) => w.code === "param_unknown" && w.message.indexOf("Did you mean \"strength\"") >= 0), "unknown param is a warning with a hint", JSON.stringify(unknownParam.warnings));
    expect("missing_core", variant((m) => { m.concepts = m.concepts.filter((c) => c.use !== "entity.obstacle" && c.use !== "rule.collide_fail"); }), "missing core concept");
    expect("wiring", variant((m) => setParam(m, "score.count", { on: "round.correct" })), "score counts an event nothing emits");
    expect("requires", variant((m) => { m.concepts.push({ use: "behavior.thrust" }); }), "behavior.thrust without input.hold");
    expect("conflicts", variant((m) => { m.concepts.push({ use: "rule.lives" }); }), "rule.lives next to rule.collide_fail");
    expect("structure", variant((m) => { m.concepts = m.concepts.filter((c) => c.use.indexOf("flow.") !== 0); m.concepts.push({ use: "flow.run_retry" }, { use: "flow.daily_gate" }); }), "two flow concepts");
    expect("structure", variant((m) => { m.concepts.push({ use: "input.tap" }); }), "a concept used twice");
    expect("formula_mismatch", variant((m) => { m.concepts.push({ use: "rule.letter_feedback" }); }), "a guess concept in a dodge");
    expect("schema", variant((m) => { delete m.title; }), "missing title");
    expect("engine_version", variant((m) => { m.engine_version = 99; }), "newer engine_version");
    const notJSON = JSON.parse(B.validateJSON("{ not json"));
    ok(!notJSON.ok && notJSON.errors[0].code === "schema", "validateJSON on broken JSON returns a schema error");
    expect("glue_forbidden", variant((m) => glue(m, "score", "function score(run) { return run.base + Math.random(); }")), "glue with Math.random");
    expect("glue_forbidden", variant((m) => glue(m, "score", "function score(run) { fetch('https://example.com'); return run.base; }")), "glue with fetch");
    expect("glue_forbidden", variant((m) => glue(m, "score", "function score(run) { return run.constructor.constructor('return 1')(); }")), "glue reaching for constructor");
    expect("glue_forbidden", variant((m) => glue(m, "score", "function score(run) { return Date.now() % 2; }")), "glue with Date");
    expect("glue_compile", variant((m) => glue(m, "score", "function score(run) { return run.base + ; }")), "glue that doesn't compile");
    expect("glue_compile", variant((m) => glue(m, "score", "function points(run) { return 1; }")), "glue without its slot function");
    expect("glue_slot", variant((m) => glue(m, "teleport", "function teleport() { return 1; }")), "unknown glue slot");
    expect("glue_slot", variant((m) => glue(m, "feedback", "function feedback(guess, target) { return []; }")), "glue for a slot nothing calls");
    const gw = copy(guess.example);
    gw.content = Object.assign({}, gw.content, { target: "A1" });
    expect("content", B.validate(gw), "guess word with a bad target");
    const gwho = copy(guess.examples[1]);
    gwho.content = { people: [] };
    expect("content", B.validate(gwho), "who style with no people");

    // Runtime guards: glue that throws or loops is switched off and the run still ends.
    const throwing = copy(base);
    glue(throwing, "score", "function score(run) { if (run.count > 2) { throw new Error('boom'); } return run.base; }");
    ok(B.validate(throwing).ok, "throwing glue passes validation (it only throws later)");
    const rt = sim(throwing, { bot_seed: 1, bot_skill: 0.9, max_ticks: 1800 });
    ok(rt.ok && rt.score > 2, "glue that throws mid-run is disabled and the run carries on", rt.error || "score " + rt.score);
    const looping = copy(base);
    glue(looping, "score", "function score(run) { var n = 0; while (true) { n++; } return n; }");
    const t0 = now();
    const rl = sim(looping, { bot_seed: 1, bot_skill: 0.9, max_ticks: 900 });
    ok(rl.ok && now() - t0 < 5000, "an endless glue loop is cut off by the loop guard", rl.error || fmt(now() - t0) + " ms");
    const bad = JSON.parse(B.simulateJSON("{ nope", "{}"));
    ok(!bad.ok && typeof bad.error === "string", "simulateJSON on broken JSON returns an error instead of throwing");
    const unknown = B.simulate(Object.assign(copy(base), { formula: "nope" }), {});
    ok(!unknown.ok && typeof unknown.error === "string", "simulate of an invalid manifest returns ok: false", unknown.error);

    // ------------------------------------------------------------------ looks
    section("Looks (LOOKS.md)");
    const LOOK_IDS = ["glow", "paper", "pixel", "neon", "ink", "clay", "riso", "chalk"];
    const looks = cat.looks || [];
    ok(LOOK_IDS.every((id) => looks.some((l) => l.id === id)), "catalog lists all eight looks", looks.map((l) => l.id).join(", "));
    ok(looks.every((l) => l.title && l.describe && Array.isArray(l.moods) && l.energy && Array.isArray(l.fonts) && Array.isArray(l.motifs) && l.example_colors),
      "every look has title, describe, moods, energy, fonts, motifs and example_colors");
    ok(Array.isArray(cat.fonts) && cat.fonts.length >= 6 && Array.isArray(cat.motifs) && cat.motifs.indexOf("hills") >= 0 && Array.isArray(cat.color_roles) && cat.color_roles.length === 7,
      "catalog lists fonts, motifs and the seven color roles");
    for (const l of looks) {
      const c = l.example_colors;
      const cr = Math.min(B.color.contrast(c.ink, c.bg_top), B.color.contrast(c.ink, c.bg_bottom));
      ok(cr >= 4.5, l.id + ": example ink has 4.5:1 contrast on both backgrounds", fmt(cr));
      const m = copy(base);
      m.style = { look: l.id, palette: "custom", colors: copy(c) };
      const v = B.validate(m);
      ok(v.ok && !v.warnings.some((w) => w.code === "style" || w.code === "style_contrast"), l.id + ": example colors validate cleanly", JSON.stringify(v.warnings));
      const st = B.resolveStyle(m.style);
      const pal = st.palette;
      ok(st.look === l.id && pal.look === l.id && pal.primary === c.primary.toUpperCase() && pal.bgTop === c.bg_top.toUpperCase() && pal.accents.length === 4 &&
        ["primary", "secondary", "accent", "ink", "bgTop", "bgBottom", "danger", "surface", "line"].every((k) => typeof pal[k] === "string") && typeof pal.inkOn === "function",
        l.id + ": resolveStyle gives palette roles, custom colors as given");
    }
    function styleVariant(style) { const m = copy(base); m.style = style; return B.validate(m); }
    const vl = styleVariant({ look: "papr" });
    ok(!vl.ok && codes(vl).indexOf("style") >= 0 && /Did you mean "paper"/.test(vl.errors[0].message), "an unknown look is a style error with a suggestion", JSON.stringify(vl.errors));
    const vh = styleVariant({ look: "paper", palette: "custom", colors: { bg_top: "#FFF3DF", bg_bottom: "beige", ink: "#3A2A1E" } });
    ok(vh.ok && vh.warnings.some((w) => w.code === "style_contrast" && /bg_bottom/.test(w.path)), "a bad hex color is a style_contrast warning", JSON.stringify(vh.warnings));
    const vc = styleVariant({ look: "ink", palette: "custom", colors: { bg_top: "#FBF8F1", bg_bottom: "#EFE9DC", ink: "#B9B4A8", primary: "#4F78C9" } });
    ok(vc.ok && vc.warnings.some((w) => w.code === "style_contrast" && /contrast/.test(w.message)), "low ink contrast is a style_contrast warning", JSON.stringify(vc.warnings));
    const vf = styleVariant({ look: "neon", font: "gothic", motif: "volcano" });
    ok(vf.ok && vf.warnings.filter((w) => w.code === "style").length === 2, "an unknown font or motif is a style warning", JSON.stringify(vf.warnings));
    const vn = styleVariant({ palette: "custom" });
    ok(vn.ok && vn.warnings.some((w) => w.code === "style"), "custom palette without colors is a style warning");
    const old = B.resolveStyle({ palette: "mint-pop" });
    ok(old.look === "glow" && old.font === "rounded" && old.palette.id === "mint-pop", "a manifest without look/font keeps glow, rounded and its preset");
    // Rendering only: the same run in every look.
    for (const m of valid) {
      const ref = B.simulate(m, { bot_seed: 3, bot_skill: 0.6 });
      const tryLooks = quick && ENGINE_SEEDS.indexOf(m.id) < 0 ? ["pixel", "ink"] : LOOK_IDS;
      const diff = [];
      for (const look of tryLooks) {
        const mm = copy(m);
        mm.style = Object.assign({}, mm.style, { look });
        const r = B.simulate(mm, { bot_seed: 3, bot_skill: 0.6 });
        if (!(r.outcome === ref.outcome && r.score === ref.score && r.ticks === ref.ticks && JSON.stringify(r.events) === JSON.stringify(ref.events))) diff.push(look);
      }
      ok(!diff.length, m.id + ": identical run in " + tryLooks.length + " looks", diff.join(", "));
    }
    if (ownSeeds.length) {
      const seen = {};
      for (const id of ownSeeds) {
        const st = byId[id].style || {};
        seen[st.look] = 1;
        const c = st.colors || {};
        ok(st.look && st.font && st.motif && st.palette === "custom" && B.color.isHex(c.bg_top) && B.color.isHex(c.bg_bottom) &&
          Math.min(B.color.contrast(c.ink, c.bg_top), B.color.contrast(c.ink, c.bg_bottom)) >= 4.5 && typeof st.cover_prompt === "string" && st.cover_prompt.length > 20,
          id + ": has its own look, font, motif, readable custom colors and a cover prompt");
      }
      ok(Object.keys(seen).length >= 5, "the engine seeds show the range of looks", Object.keys(seen).join(", "));
      const want = { "newinsf-daily-fog-words": "ink", "picnic-icebreaker-whos-coming": "paper", "hill-hopper": "paper", "hill-hopper-2": "neon", "fog-drift": "glow", "moving-day": "clay" };
      ok(ownSeeds.every((id) => byId[id].style.look === want[id]), "seed looks follow LOOKS.md", ownSeeds.map((id) => id + ":" + byId[id].style.look).join(" "));
    }

    // ------------------------------------------------------------------ posters
    section("Posters");
    ok(typeof B.posterRun === "function", "Bubble.posterRun exists");
    ok(dodge.poster_ticks === 90 && guess.poster_ticks === 240, "formulas carry poster_ticks (dodge 90, guess 240)", dodge.poster_ticks + " / " + guess.poster_ticks);
    if (typeof B.posterRun === "function") {
      const pic = byId["picnic-icebreaker-whos-coming"];
      if (pic) {
        const r = B.posterRun(B.createSession(pic));
        const rd = r.state.round;
        ok(rd && rd.picked === -1 && rd.choices.length === 4 && r.tick === rd.start + 34 && !r.ended,
          "picnic poster: the first fact with all four portraits, nobody picked yet", rd ? "tick " + r.tick + ", start " + rd.start + ", picked " + rd.picked : "no round");
        const r2 = B.posterRun(B.createSession(pic));
        ok(r2.tick === r.tick && JSON.stringify(r2.state.round.choices) === JSON.stringify(rd.choices), "the poster moment is deterministic");
      }
      const fw = byId["newinsf-daily-fog-words"];
      if (fw) {
        const r = B.posterRun(B.createSession(fw));
        const kb = r.state.keyboard, wd = r.state.word;
        ok(kb && kb.value.length === 3 && wd && wd.guesses.length === 0 && r.tick < 240, "Fog Words poster: a guess half typed, nothing revealed",
          kb ? "'" + kb.value + "' at tick " + r.tick : "no keyboard");
      }
      const hh = byId["hill-hopper"];
      if (hh) {
        const r = B.posterRun(B.createSession(hh));
        ok(r.tick === 90 && !r.ended && r.state.obstacles !== null, "dodge poster: 1.5 s in, still flying", "tick " + r.tick + (r.ended ? " ended" : ""));
      }
      const noBot = copy(base);
      const r = B.posterRun(B.createSession(noBot), { bot_skill: 0.2 });
      ok(r.tick <= 90, "posterRun takes a bot skill and stops by poster_ticks", "tick " + r.tick);
    }

    // ------------------------------------------------------------------ length (docs/BUBBLES.md 7.9)
    section("Length");
    {
      const lcat = cat;
      ok(Array.isArray(lcat.length_modes) && ["endless", "rounds", "timed", "lives"].every((m) => lcat.length_modes.indexOf(m) >= 0), "catalog lists the four length modes");
      ok(lcat.length_limits && lcat.length_limits.rounds[1] === 50 && lcat.length_limits.seconds[0] === 10 && lcat.length_limits.lives[1] === 9, "catalog lists length limits");
      const declared = lcat.formulas.filter((f) => f.length && Array.isArray(f.length.modes));
      ok(["dodge", "time", "merge", "guess", "group", "answer"].every((id) => declared.some((f) => f.id === id)), "every original kit declares length");
      for (const f of declared) {
        ok(f.length.modes.every((m) => lcat.length_modes.indexOf(m) >= 0), f.id + ": length modes are known");
        ok(f.length.default && f.length.modes.indexOf(f.length.default.mode) >= 0, f.id + ": default length is one of its modes");
        for (const id of Object.keys(f.length.knobs || {})) {
          const k = f.length.knobs[id];
          ok(lcat.length_knobs.indexOf(id) >= 0, f.id + ": knob " + id + " is a known knob id");
          const alts = String(k.concept || "").split("|");
          ok(alts.every((cid) => { const c = lcat.concepts.find((x) => x.id === cid); return c && c.params[k.param]; }), f.id + ": knob " + id + " names a real concept param", k.concept + "." + k.param);
        }
      }
      const dodge = byId["hill-hopper"] || (lcat.formulas.find((f) => f.id === "dodge") || {}).example;
      if (dodge) {
        const withLen = (len) => Object.assign(copy(dodge), { length: len });
        const lcodes = (v) => v.errors.filter((e) => e.code === "length").length;
        ok(B.validate(withLen({ mode: "timed", seconds: 60 })).ok, "a timed length validates");
        ok(lcodes(B.validate(withLen({ mode: "forever" }))) === 1, "an unknown mode is a length error");
        ok(lcodes(B.validate(withLen("10 rounds"))) === 1, "a length that isn't an object is a length error");
        ok(lcodes(B.validate(withLen({ mode: "rounds", rounds: 0 }))) === 1, "rounds 0 is a length error");
        ok(lcodes(B.validate(withLen({ mode: "rounds", rounds: 51 }))) === 1, "rounds 51 is a length error");
        ok(lcodes(B.validate(withLen({ mode: "timed", seconds: 5 }))) === 1, "seconds 5 is a length error");
        ok(lcodes(B.validate(withLen({ mode: "timed", seconds: 301 }))) === 1, "seconds 301 is a length error");
        ok(lcodes(B.validate(withLen({ mode: "lives", lives: 10 }))) === 1, "lives 10 is a length error");
        ok(lcodes(B.validate(withLen({ mode: "lives", lives: 2.5 }))) === 1, "lives 2.5 is a length error");
        const merge = (lcat.formulas.find((f) => f.id === "merge") || {}).example;
        if (merge) ok(lcodes(B.validate(Object.assign(copy(merge), { length: { mode: "lives", lives: 3 } }))) === 1, "a mode the formula doesn't support is a length error");
        const L0 = B.resolveLength(dodge, null);
        ok(L0.mode === "endless" && !L0.locked, "no length resolves to endless, unlocked");
        const L1 = B.resolveLength(withLen({ mode: "timed" }), { length: { default: { mode: "endless" }, numbers: { seconds: 45 } } });
        ok(L1.mode === "timed" && L1.seconds === 45 && L1.locked, "a locked mode without a number takes the formula's suggestion", JSON.stringify(L1));
        const L2 = B.resolveLength(withLen({ mode: "lives" }), null);
        ok(L2.lives === 3, "a locked mode without any suggestion takes the engine's", JSON.stringify(L2));
        ok(B.lengthLabel(B.displayLength(dodge), 42) === "Endless: beat 42", "endless label shows the best", B.lengthLabel(B.displayLength(dodge), 42));
        ok(B.lengthLabel(B.displayLength(withLen({ mode: "rounds", rounds: 10 }))) === "10 rounds", "rounds label");
        ok(B.lengthLabel(B.displayLength(withLen({ mode: "timed", seconds: 60 }))) === "60 seconds", "timed label");
        ok(B.lengthLabel(B.displayLength(withLen({ mode: "lives", lives: 1 }))) === "1 life", "one life label");
        const timedRun = B.simulate(withLen({ mode: "timed", seconds: 10 }), { bot_seed: 3, bot_skill: 1, max_ticks: 3000 });
        ok(timedRun.ok && timedRun.ticks <= 600, "a timed run ends by its seconds", timedRun.outcome + " " + timedRun.ticks);
        ok(timedRun.replay && timedRun.replay.length && timedRun.replay.length.seconds === 10, "the replay records the locked length");
        const again = B.simulate(dodge, { replay: timedRun.replay, max_ticks: 3000 });
        ok(again.ticks === timedRun.ticks && again.score === timedRun.score && again.outcome === timedRun.outcome, "a replay with a length replays on a manifest without one");
        const plain = B.simulate(dodge, { bot_seed: 3, bot_skill: 0.6, max_ticks: 3000 });
        ok(!plain.replay.length && !plain.events["length.round"] && !plain.events["length.end"], "a manifest without length records no length and emits no length events");
      }
    }

    // ------------------------------------------------------------------ normalize
    section("normalizeJSON");
    if (valid.length) {
      const src = valid.find((m) => m._seed) || valid[0];
      const n = JSON.parse(B.normalizeJSON(JSON.stringify(src)));
      ok(n.engine_version === 1 && (!src._seed || JSON.stringify(n._seed) === JSON.stringify(src._seed)), "normalize pins engine_version and keeps _ keys");
      const full = n.concepts.every((c) => {
        const def = cat.concepts.find((x) => x.id === c.use);
        return Object.keys(def.params).every((k) => c.params && c.params[k] !== undefined);
      });
      ok(full, "normalize fills every param default");
      ok(B.validate(n).ok, "a normalized manifest still validates");
    }

    // ------------------------------------------------------------------ speed
    section("Speed (" + env.engine + ", " + (env.clock || "wall") + " ms)");
    const long = byId["hill-hopper"] || base;
    const longRun = timed("simulate 90 s dodge run", () => B.simulate(long, { bot_seed: 2, bot_skill: 1, max_ticks: 5400 }));
    ok(longRun.ok, "long run completes", longRun.error);
    for (let i = 0; i < 5; i++) timed("createSession (prepare)", () => B.createSession(long));
    for (const label of Object.keys(timings)) {
      const t = timings[label];
      t.avg = t.total / t.n;
      print("  " + label + ": avg " + fmt(t.avg) + " ms, max " + fmt(t.max) + " ms (" + t.n + "x)");
    }
    if (longRun.ok) print("  90 s run: " + longRun.ticks + " ticks, " + fmt(longRun.ticks / Math.max(0.01, timings["simulate 90 s dodge run"].avg)) + " ticks/ms");
    // Generous budgets: they catch regressions (allocation storms, accidental O(n^2)), not noise.
    if (env.clock === "cpu") {
    if (timings["validate (one seed)"]) ok(timings["validate (one seed)"].avg < 40, "validate averages under 40 ms", fmt(timings["validate (one seed)"].avg));
    ok(timings["createSession (prepare)"].avg < 20, "createSession averages under 20 ms", fmt(timings["createSession (prepare)"].avg));
    ok(timings["simulate 90 s dodge run"].avg < 3000, "a 90 s simulated run takes under 3 s", fmt(timings["simulate 90 s dodge run"].avg));
    }

    for (const s of skipped) print("  skipped " + s);
    print("\n" + passed + " passed, " + failed + " failed" + (skipped.length ? ", " + skipped.length + " seeds skipped" : ""));
    const out = {};
    for (const k of Object.keys(timings)) out[k] = { n: timings[k].n, avg: Math.round(timings[k].avg * 100) / 100, max: Math.round(timings[k].max * 100) / 100 };
    return { passed, failed, failures, skipped, timings: out };
  }

  const api = { run, ENGINE_SEEDS, COMMON };
  root.BubbleRuntimeChecks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
