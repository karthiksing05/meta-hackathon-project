// Formula kit tests (group, answer, time, merge). Engine-agnostic: runs in Node (run-node.js) and in
// JavaScriptCore's jsc shell (run-jsc.sh) after the runtime, the common kit and every kit are loaded.
//
//   KitTests.run({ print, readText, seeds: [paths], quick, formulas })  -> { failures, report }
//
// Checks: catalog metadata, every example and seed validates, bot simulations across bot seeds
// and skills give sensible outcomes, and replays reproduce score, ticks, outcome and events exactly.
var KitTests = (function () {
  "use strict";
  // story, nextline and learn: the collaboration batch's kits (docs/BUBBLES.md 7), tested by default.
  var KIT_FORMULAS = ["group", "answer", "time", "merge", "story", "nextline", "learn"];
  var SKILLS = [0.15, 0.4, 0.7, 0.95];

  function stableEvents(ev) {
    var keys = Object.keys(ev || {}).sort();
    return keys.map(function (k) { return k + ":" + ev[k]; }).join(",");
  }

  function pct(n, d) { return d ? Math.round(100 * n / d) + "%" : "-"; }

  function quantiles(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    function q(p) { return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }
    return { min: s[0], p10: q(0.1), p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
  }

  function run(env) {
    var print = env.print;
    var failures = [];
    var report = { formulas: {}, seeds: {} };
    function fail(msg) { failures.push(msg); print("  FAIL " + msg); }
    function ok(msg) { if (env.verbose) print("  ok " + msg); }

    var catalog = JSON.parse(Bubble.catalogJSON());
    print("Runtime " + (catalog.version || Bubble.version) + ": " + catalog.formulas.length + " formulas, " + catalog.concepts.length + " concepts");
    var formulas = {};
    catalog.formulas.forEach(function (f) { formulas[f.id] = f; });
    var conceptById = {};
    catalog.concepts.forEach(function (c) { conceptById[c.id] = c; });
    var wanted = env.formulas || KIT_FORMULAS;

    // 1. Catalog metadata for kit formulas and their concepts.
    print("\n[catalog]");
    wanted.forEach(function (fid) {
      var f = formulas[fid];
      if (!f) { fail("formula " + fid + " missing from catalog"); return; }
      if (!f.describe || f.describe.length < 40) fail(fid + ": describe too short");
      if (!f.example) fail(fid + ": no example manifest");
      if (!f.content || !f.content.describe) fail(fid + ": content.describe missing");
      (f.core || []).concat(f.optional || []).forEach(function (entry) {
        entry.split("|").forEach(function (cid) { if (!conceptById[cid.trim()]) fail(fid + ": lists unknown concept " + cid); });
      });
      var mine = catalog.concepts.filter(function (c) { return (c.formulas || []).indexOf(fid) >= 0 && (c.formulas || []).indexOf("*") < 0; });
      mine.forEach(function (c) {
        var where = fid + "/" + c.id;
        if (!c.describe || c.describe.length < 30) fail(where + ": describe too short");
        if (!Array.isArray(c.examples) || !c.examples.length) fail(where + ": examples missing");
        ["consumes", "emits", "requires", "conflicts", "glue"].forEach(function (k) { if (!Array.isArray(c[k])) fail(where + ": " + k + " must be an array"); });
        if (!c.tags || typeof c.tags !== "object") fail(where + ": tags missing");
        if (c.id.split(".")[0] !== c.kind) fail(where + ": id prefix does not match kind " + c.kind);
        Object.keys(c.params || {}).forEach(function (pk) {
          var p = c.params[pk];
          var pw = where + ".params." + pk;
          if (!p.describe) fail(pw + ": describe missing");
          if (!("default" in p)) fail(pw + ": default missing");
          if (p.type === "number" || p.type === "integer") {
            if (typeof p.min !== "number" || typeof p.max !== "number") fail(pw + ": min/max missing");
            else if (p.default < p.min || p.default > p.max) fail(pw + ": default outside range");
          } else if (p.type === "enum") {
            if (!Array.isArray(p.values) || p.values.indexOf(p.default) < 0) fail(pw + ": enum default not in values");
          } else if (p.type === "string") {
            if (typeof p.max_length !== "number") fail(pw + ": max_length missing");
          } else if (p.type === "string_list") {
            if (typeof p.max_items !== "number") fail(pw + ": max_items missing");
          } else if (p.type !== "boolean") fail(pw + ": unknown type " + p.type);
        });
      });
      print("  " + fid + ": " + mine.length + " concepts, example " + (f.example ? f.example.id : "-"));
    });

    // 2. Examples and seeds validate.
    print("\n[validate]");
    var manifests = [];
    wanted.forEach(function (fid) {
      var f = formulas[fid];
      if (!f || !f.example) return;
      manifests.push({ name: "example:" + fid, manifest: f.example });
    });
    (env.seeds || []).forEach(function (path) {
      var m;
      try { m = JSON.parse(env.readText(path)); } catch (e) { fail("seed " + path + " is not JSON: " + e); return; }
      if (wanted.indexOf(m.formula) < 0) return;
      if (m._placeholder) fail(path + " is still a placeholder");
      if (!m._seed) fail(path + " has no _seed metadata");
      manifests.push({ name: m.id, manifest: m, seed: true });
    });
    manifests.forEach(function (x) {
      var v = JSON.parse(Bubble.validateJSON(JSON.stringify(x.manifest)));
      if (!v.ok) fail(x.name + " invalid: " + JSON.stringify(v.errors));
      else ok(x.name + " valid");
      if (v.warnings && v.warnings.length) print("  warn " + x.name + ": " + JSON.stringify(v.warnings));
      x.valid = v.ok;
    });
    print("  " + manifests.filter(function (x) { return x.valid; }).length + "/" + manifests.length + " valid");

    // 3. Bot simulations and 4. replay determinism.
    print("\n[simulate]");
    var botSeeds = env.quick ? 6 : 14;
    manifests.forEach(function (x) {
      if (!x.valid) return;
      var m = x.manifest;
      var json = JSON.stringify(m);
      var rows = [];
      var bySkill = {};
      SKILLS.forEach(function (skill) {
        var outs = { fail: 0, success: 0, timeout: 0, error: 0 }, scores = [], secs = [];
        for (var b = 1; b <= botSeeds; b++) {
          var r = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: b * 101 + Math.round(skill * 1000), bot_skill: skill })));
          if (!r.ok) { outs.error++; fail(x.name + " sim error: " + r.error); continue; }
          outs[r.outcome] = (outs[r.outcome] || 0) + 1;
          scores.push(r.score); secs.push(r.duration_sec);
          rows.push(r);
          if (r.score < 0) fail(x.name + " negative score");
          // Replay determinism on a sample of runs.
          if (b <= (env.quick ? 2 : 4)) {
            var again = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: r.replay.seed, max_ticks: r.ticks + 120, bot: false, replay: r.replay })));
            if (!again.ok) fail(x.name + " replay error: " + again.error);
            else if (again.score !== r.score || again.ticks !== r.ticks || again.outcome !== r.outcome || stableEvents(again.events) !== stableEvents(r.events)) {
              fail(x.name + " replay mismatch (skill " + skill + ", bot " + b + "): " +
                JSON.stringify({ score: [r.score, again.score], ticks: [r.ticks, again.ticks], outcome: [r.outcome, again.outcome] }) +
                (stableEvents(again.events) !== stableEvents(r.events) ? " events differ: " + stableEvents(r.events) + " vs " + stableEvents(again.events) : ""));
            }
            // Same bot seed twice must give the same run.
            var twin = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: b * 101 + Math.round(skill * 1000), bot_skill: skill })));
            if (twin.score !== r.score || twin.ticks !== r.ticks) fail(x.name + " bot run not repeatable");
          }
        }
        var sq = quantiles(scores), dq = quantiles(secs);
        bySkill[skill] = { outcomes: outs, score: sq, secs: dq };
        print("  " + pad(x.name, 34) + " skill " + skill.toFixed(2) + "  success " + pad(pct(outs.success, botSeeds), 4) + " fail " + pad(pct(outs.fail, botSeeds), 4) +
          (outs.timeout ? " TIMEOUT " + outs.timeout : "") +
          "  score p10/p50/p90 " + sq.p10 + "/" + sq.p50 + "/" + sq.p90 + "  secs " + dq.min.toFixed(1) + "–" + dq.max.toFixed(1) + " (p50 " + dq.p50.toFixed(1) + ")");
        if (outs.timeout) fail(x.name + ": " + outs.timeout + " runs timed out at skill " + skill);
      });
      // Sanity: runs last 10–120 s, the best bots score more than the worst, not every run is an instant fail.
      var all = rows.map(function (r) { return r.duration_sec; });
      var dq2 = quantiles(all);
      if (dq2.p10 < 8) fail(x.name + ": too many very short runs (p10 " + dq2.p10 + " s)");
      if (dq2.p90 > 100) fail(x.name + ": runs too long (p90 " + dq2.p90 + " s)");
      var lo = bySkill[SKILLS[0]].score.p50, hi = bySkill[SKILLS[SKILLS.length - 1]].score.p50;
      if (!(hi > lo)) fail(x.name + ": skilled bots should outscore weak ones (" + lo + " vs " + hi + ")");
      var anyFail = SKILLS.some(function (s) { return bySkill[s].outcomes.fail > 0; });
      var anySuccess = SKILLS.some(function (s) { return bySkill[s].outcomes.success > 0; });
      report.seeds[x.name] = { bySkill: bySkill, canFail: anyFail, canSucceed: anySuccess };
      if (!anySuccess && !anyFail) fail(x.name + ": never ends");
      if (!anyFail) print("  note " + x.name + ": no bot run failed (no-fail design?)");
      // Share artifact.
      var sample = rows[rows.length - 1];
      if (sample && sample.share) print("  share " + x.name + ": " + JSON.stringify(sample.share));
    });

    // 5. Merge physics: settling without jitter, bounds, overlaps, bit-exact replays.
    if (wanted.indexOf("merge") >= 0) mergePhysics(env, manifests, fail, report);

    // 5b. Extra suites: each tools/kits-tests/suite-*.js registers one on KitSuites (length modes,
    // story graphs…). Add a new suite file instead of editing this one. Suites never change the
    // fingerprint below.
    var suites = typeof KitSuites !== "undefined" ? KitSuites : [];
    suites.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }).forEach(function (suite) {
      print("\n[suite " + suite.name + "]");
      try {
        suite.run({ Bubble: Bubble, print: print, fail: fail, ok: ok, quick: !!env.quick, wanted: wanted, manifests: manifests, report: report });
      } catch (e) {
        fail("suite " + suite.name + " crashed: " + e);
      }
    });

    // 6. Fingerprint: a hash over fixed runs of every manifest. Node and jsc must print the same one.
    var fp = [];
    manifests.forEach(function (x) {
      if (!x.valid) return;
      for (var b = 1; b <= 2; b++) {
        var r = JSON.parse(Bubble.simulateJSON(JSON.stringify(x.manifest), JSON.stringify({ seed: x.manifest.seed, max_ticks: 60 * 150, bot: true, bot_seed: 7000 + b, bot_skill: 0.86 })));
        fp.push(x.name + ":" + r.outcome + ":" + r.score + ":" + r.ticks + ":" + stableEvents(r.events) + ":" + hashStr(JSON.stringify(r.replay && r.replay.inputs)));
      }
    });
    if (report.mergeHash) fp.push("merge-state:" + report.mergeHash);
    report.fingerprint = hashStr(fp.join("|"));
    print("\nFINGERPRINT " + report.fingerprint + " (" + fp.length + " runs)");

    print("\n" + (failures.length ? failures.length + " FAILURES" : "ALL KIT TESTS PASSED"));
    return { failures: failures, report: report };
  }

  // FNV-1a over a string; Number -> string is fully specified in ECMAScript, so hashes of printed
  // doubles match across engines.
  function hashStr(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0; }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }

  // A test-only concept that hands each run's sdk to the test on every tick (after the kits').
  var PROBE = { onTick: null };
  var probeDefined = false;
  function defineProbe() {
    if (probeDefined) return;
    probeDefined = true;
    Bubble.defineConcept({
      id: "feel.kits_probe", kind: "feel", version: 1, formulas: ["*"],
      describe: "Kit tests only: lets the test read the game state every tick.", examples: ["kit tests"],
      params: {}, consumes: ["clock.tick"], emits: [], requires: [], conflicts: [], tags: {}, glue: [],
      setup: function (sdk) { sdk.on("clock.tick", function () { if (PROBE.onTick) PROBE.onTick(sdk); }); }
    });
  }
  function bodiesHash(st) {
    var parts = [];
    for (var i = 0; i < st.n; i++) parts.push(st.id[i] + "," + st.tier[i] + "," + st.x[i] + "," + st.y[i] + "," + st.px[i] + "," + st.py[i]);
    return hashStr(parts.join(";"));
  }

  function mergePhysics(env, manifests, fail, report) {
    var print = env.print;
    print("\n[merge physics]");
    defineProbe();
    var base = null;
    manifests.forEach(function (x) { if (x.valid && x.manifest.formula === "merge" && (!base || x.seed)) base = x.manifest; });
    if (!base) { fail("no merge manifest to test"); return; }
    function withProbe(m, dropTimer) {
      var c = JSON.parse(JSON.stringify(m));
      if (dropTimer) c.concepts = c.concepts.filter(function (k) { return k.use !== "rule.timer"; });
      c.concepts.push({ use: "feel.kits_probe" });
      return c;
    }
    var usesDrag = base.concepts.some(function (k) { return k.use === "input.drag"; });
    var rise = base.concepts.some(function (k) { return k.use === "space.merge_jar" && k.params && k.params.rise; });
    // A scripted session: 44 drops spread across the jar, then 15 s of stillness.
    var xs = [];
    for (var d = 0; d < 44; d++) xs.push(40 + ((d * 97) % 280));
    var inputs = [], y = rise ? 634 : 110, t = 20;
    xs.forEach(function (x) { inputs.push({ t: t, a: "tap", v: [x, y] }); inputs.push({ t: t + 3, a: "up", v: [x, y] }); t += 34; });
    var endTick = t + 900;
    var replay = { seed: base.seed, tick_rate: 60, total_ticks: endTick, inputs: inputs };
    function scripted(m) {
      var snap = { maxMove: 0, maxSpeed: 0, minN: 999, bad: [], last: null, prev: null, maxPen: 0, n: 0 };
      PROBE.onTick = function (sdk) {
        var st = sdk.state.merge, jar = sdk.state.jar;
        if (!st || !jar) return;
        for (var i = 0; i < st.n; i++) {
          if (!(isFinite(st.x[i]) && isFinite(st.y[i]))) snap.bad.push("NaN at tick " + sdk.tick);
          if (st.x[i] - st.r[i] < jar.L - 0.5 || st.x[i] + st.r[i] > jar.R + 0.5 || st.y[i] + st.r[i] > jar.floor + 0.5) snap.bad.push("body " + st.id[i] + " outside the jar at tick " + sdk.tick);
        }
        if (snap.bad.length > 5) snap.bad.length = 5;
        if (sdk.tick === endTick - 121) snap.prev = st.x.slice(0, st.n).concat(st.y.slice(0, st.n));
        if (sdk.tick >= endTick - 120) {
          for (var k = 0; k < st.n; k++) {
            var vx = st.x[k] - st.px[k], vy = st.y[k] - st.py[k];
            snap.maxSpeed = Math.max(snap.maxSpeed, Math.sqrt(vx * vx + vy * vy));
          }
        }
        if (sdk.tick === endTick - 1) {
          snap.n = st.n;
          if (snap.prev && snap.prev.length === 2 * st.n) {
            for (var q = 0; q < st.n; q++) snap.maxMove = Math.max(snap.maxMove, Math.abs(st.x[q] - snap.prev[q]), Math.abs(st.y[q] - snap.prev[st.n + q]));
          } else snap.maxMove = -1;
          for (var a = 0; a < st.n; a++) for (var b = a + 1; b < st.n; b++) {
            var dx = st.x[b] - st.x[a], dy = st.y[b] - st.y[a], d = Math.sqrt(dx * dx + dy * dy);
            snap.maxPen = Math.max(snap.maxPen, st.r[a] + st.r[b] - d);
          }
          snap.last = bodiesHash(st);
        }
      };
      var r = JSON.parse(Bubble.simulateJSON(JSON.stringify(m), JSON.stringify({ seed: base.seed, max_ticks: endTick, bot: false, replay: replay })));
      PROBE.onTick = null;
      snap.result = r;
      return snap;
    }
    if (!usesDrag) inputs.forEach(function (i) { if (i.a === "up") i.a = "move"; });
    var m1 = withProbe(base, true);
    var a1 = scripted(m1), a2 = scripted(m1);
    if (!a1.result.ok) { fail("merge scripted run failed: " + a1.result.error); return; }
    print("  scripted: " + xs.length + " drops, " + a1.n + " bodies left, score " + a1.result.score + ", outcome " + a1.result.outcome + ", ticks " + a1.result.ticks);
    print("  settled: max move over the last 2 s " + a1.maxMove.toExponential(2) + " pt, max speed " + a1.maxSpeed.toExponential(2) + " pt/substep, max overlap " + a1.maxPen.toFixed(3) + " pt");
    if (a1.bad.length) fail("merge bodies left the jar or went NaN: " + a1.bad.join("; "));
    if (a1.n < 5) fail("merge scripted run left too few bodies to test settling (" + a1.n + ")");
    if (a1.maxMove < 0) fail("merge: bodies changed between the settle snapshots (a late merge?)");
    else if (a1.maxMove > 0.02) fail("merge pile still moving after 15 s (" + a1.maxMove + " pt): jitter or creep");
    if (a1.maxSpeed > 0.005) fail("merge pile not at rest (speed " + a1.maxSpeed + ")");
    if (a1.maxPen > 1.5) fail("merge bodies overlap by " + a1.maxPen.toFixed(2) + " pt after settling");
    if (a1.last !== a2.last) fail("merge scripted run not bit-identical on repeat");
    report.mergeHash = a1.last;
    print("  state hash " + a1.last + " (repeat " + (a1.last === a2.last ? "identical" : "DIFFERENT") + ")");
    // Bot run -> replay of its own input log: final bodies must be bit-identical.
    var m2 = withProbe(base, false);
    for (var s = 0; s < (env.quick ? 3 : 6); s++) {
      var finalA = null, finalB = null;
      PROBE.onTick = function (sdk) { var st = sdk.state.merge; if (st) finalA = bodiesHash(st) + "@" + sdk.tick; };
      var r = JSON.parse(Bubble.simulateJSON(JSON.stringify(m2), JSON.stringify({ seed: base.seed, max_ticks: 60 * 100, bot: true, bot_seed: 900 + s, bot_skill: [0.2, 0.6, 0.9][s % 3] })));
      PROBE.onTick = function (sdk) { var st = sdk.state.merge; if (st) finalB = bodiesHash(st) + "@" + sdk.tick; };
      var rr = JSON.parse(Bubble.simulateJSON(JSON.stringify(m2), JSON.stringify({ seed: r.replay.seed, max_ticks: r.ticks + 120, bot: false, replay: r.replay })));
      PROBE.onTick = null;
      if (finalA !== finalB || r.score !== rr.score) fail("merge bot run " + s + ": replay state differs (" + finalA + " vs " + finalB + ")");
    }
    print("  bot runs replay to bit-identical bodies: checked " + (env.quick ? 3 : 6));
  }

  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }

  return { run: run, KIT_FORMULAS: KIT_FORMULAS };
})();
if (typeof module !== "undefined") module.exports = KitTests;
