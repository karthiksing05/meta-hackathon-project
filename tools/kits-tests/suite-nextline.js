// Kit test suite: nextline, guess what they say next (docs/BUBBLES.md 7.7). Owner: the nextline feature.
// Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers itself on KitSuites.
//
// Checks:
//   - every episode in the example and the seeds has exactly 3 decoys, distinct from the answer
//     and each other, and the validator rejects content that breaks that;
//   - a timer expiry counts as wrong and breaks the streak;
//   - a faster right answer scores more than a slower one;
//   - replays reproduce the per-round results (the share tag's r= list) exactly;
//   - the length contract: rounds caps the run, and the tag counts the rounds played.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "nextline",
  run: function (env) {
    var Bubble = env.Bubble;
    var fail = env.fail, ok = env.ok, print = env.print;
    if (env.wanted.indexOf("nextline") < 0) return;
    var nl = env.manifests.filter(function (x) { return x.manifest && x.manifest.formula === "nextline" && x.valid; });
    if (!nl.length) { fail("nextline: no valid manifests to test"); return; }

    function lower(s) { return String(s || "").trim().toLowerCase(); }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    // 1. Decoys.
    var episodes = 0;
    nl.forEach(function (x) {
      (x.manifest.content.episodes || []).forEach(function (e, i) {
        episodes++;
        var where = x.name + " episode " + (i + 1);
        if (!Array.isArray(e.decoys) || e.decoys.length !== 3) { fail(where + ": needs exactly 3 decoys"); return; }
        var seen = [lower(e.answer)];
        e.decoys.forEach(function (d) {
          if (seen.indexOf(lower(d)) >= 0) fail(where + ": decoy \"" + d + "\" repeats the answer or another decoy");
          seen.push(lower(d));
        });
      });
    });
    print("  decoys: " + episodes + " episodes, 3 distinct decoys each");
    var base = nl[0].manifest;
    function rejects(mutate, what) {
      var m = copy(base);
      mutate(m.content.episodes[0]);
      var v = JSON.parse(Bubble.validateJSON(JSON.stringify(m)));
      if (v.ok) fail("nextline: validator accepted " + what);
      else ok("validator rejects " + what);
    }
    rejects(function (e) { e.decoys = e.decoys.slice(0, 2); }, "2 decoys");
    rejects(function (e) { e.decoys[1] = e.answer; }, "a decoy equal to the answer");
    rejects(function (e) { e.next_who = "Nobody"; }, "a next_who outside the cast");

    // A probe concept that records the rule's state every tick (test only).
    if (!Bubble.catalog().concepts.some(function (c) { return c.id === "feel.nextline_probe"; })) {
      Bubble.defineConcept({
        id: "feel.nextline_probe", kind: "feel", version: 1, formulas: ["*"],
        describe: "Kit tests only: records the nextline rule's state every tick.", examples: ["kit tests"],
        params: {}, consumes: ["clock.tick"], emits: [], requires: [], conflicts: [], tags: {}, glue: [],
        setup: function (sdk) { sdk.on("clock.tick", function () { if (PROBE.fn) PROBE.fn(sdk); }); }
      });
    }
    var PROBE = this.PROBE || (this.PROBE = { fn: null });
    function withProbe(m) { var c = copy(m); c.concepts.push({ use: "feel.nextline_probe" }); return c; }

    // Runs `m` with scripted inputs and reports each round's freeze tick and right tile.
    function play(m, inputs) {
      var info = { freezes: [], answers: [], results: null };
      PROBE.fn = function (sdk) {
        var a = sdk.state.nextline;
        if (!a) return;
        if (a.phase === "ask" && a.t0 === sdk.tick) { info.freezes[a.index] = sdk.tick; info.answers[a.index] = a.answerTile; }
        info.results = a.results;
      };
      var replay = { seed: m.seed, tick_rate: 60, total_ticks: 60 * 150, inputs: inputs };
      var r = JSON.parse(Bubble.simulateJSON(JSON.stringify(m), JSON.stringify({ seed: m.seed, max_ticks: 60 * 150, bot: false, replay: replay })));
      PROBE.fn = null;
      info.run = r;
      return info;
    }
    function tapTile(i, t) { return { t: t, a: "tap", v: [180, 384 + i * 59 + 26] }; }
    // Builds a run round by round: plan(k) returns seconds after the freeze to tap the right tile
    // (or a wrong one with {wrong: s}), or null to let the timer run out.
    function scripted(m, plan) {
      var inputs = [];
      var info = play(m, inputs);
      for (var k = 0; k < 6; k++) {
        if (info.freezes[k] === undefined) break;
        var p = plan(k);
        if (p !== null) {
          var wrong = typeof p === "object";
          var secs = wrong ? p.wrong : p;
          var tile = wrong ? (info.answers[k] + 1) % 4 : info.answers[k];
          inputs.push(tapTile(tile, info.freezes[k] + Math.round(secs * 60)));
          info = play(m, inputs);
        }
      }
      return info;
    }
    var pm = withProbe(base);

    // 2. A time-out is wrong and breaks the streak.
    var t = scripted(pm, function (k) { return k === 0 || k === 1 ? 1.0 : k === 2 ? null : 1.0; });
    var r = t.results || [];
    if (!(r[0] && r[0].correct && r[1] && r[1].correct && r[1].streak === 2)) fail("nextline: two quick right answers should make a streak of 2: " + JSON.stringify(r.slice(0, 2)));
    if (!(r[2] && r[2].timedOut && !r[2].correct && r[2].streak === 0 && r[2].points === 0)) fail("nextline: a time-out should be wrong, score 0 and break the streak: " + JSON.stringify(r[2]));
    if (!(r[3] && r[3].correct && r[3].streak === 1)) fail("nextline: the streak should restart after a time-out: " + JSON.stringify(r[3]));
    else print("  time-out: wrong, 0 points, streak 2 → 0 → 1");
    if (t.run.outcome !== "success") fail("nextline: a scripted run should finish with success, got " + t.run.outcome);

    // 3. Faster right answers score more (same round, same streak).
    var fast = scripted(pm, function (k) { return k === 0 ? 0.6 : null; });
    var slow = scripted(pm, function (k) { return k === 0 ? 5.5 : null; });
    var fp = fast.results && fast.results[0] ? fast.results[0].points : -1;
    var sp = slow.results && slow.results[0] ? slow.results[0].points : -1;
    if (!(fp > sp && sp > 0)) fail("nextline: a faster right answer should score more (" + fp + " vs " + sp + ")");
    else print("  speed: right in 0.6 s scores " + fp + ", in 5.5 s scores " + sp);
    // A wrong pick scores nothing.
    var wrong = scripted(pm, function (k) { return k === 0 ? { wrong: 1.0 } : null; });
    if (!(wrong.results && wrong.results[0] && !wrong.results[0].correct && wrong.results[0].points === 0 && wrong.run.score === 0)) fail("nextline: a wrong pick should score 0");

    // 4. Replays reproduce per-round results (the tag) exactly.
    var checked = 0;
    nl.forEach(function (x) {
      [0.2, 0.6, 0.9].forEach(function (skill, i) {
        var json = JSON.stringify(x.manifest);
        var run = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: x.manifest.seed, max_ticks: 60 * 150, bot: true, bot_seed: 4242 + i, bot_skill: skill })));
        var again = JSON.parse(Bubble.simulateJSON(json, JSON.stringify({ seed: run.replay.seed, max_ticks: run.ticks + 120, bot: false, replay: run.replay })));
        var tag = run.share && run.share.tag, tag2 = again.share && again.share.tag;
        if (!tag || tag.indexOf("right=") !== 0 || tag.indexOf(";r=") < 0) fail(x.name + ": share tag missing right= or r=: " + tag);
        else if (tag !== tag2) fail(x.name + ": replay tag differs: " + tag + " vs " + tag2);
        else checked++;
        // The tag's right= count matches the r= list.
        var m1 = /right=(\d+)\/(\d+)/.exec(tag || ""), list = ((tag || "").split(";r=")[1] || "").split("|");
        if (m1 && list.filter(function (e) { return e.split(":")[2] === "1"; }).length !== Number(m1[1])) fail(x.name + ": right= disagrees with r=: " + tag);
      });
    });
    print("  replays: " + checked + " per-round tags reproduced exactly");

    // 5. Length: rounds caps the run; the tag counts rounds played.
    var three = copy(base);
    three.length = { mode: "rounds", rounds: 3 };
    var r3 = JSON.parse(Bubble.simulateJSON(JSON.stringify(three), JSON.stringify({ seed: three.seed, max_ticks: 60 * 150, bot: true, bot_seed: 9, bot_skill: 0.8 })));
    if (!r3.ok || r3.outcome !== "success" || !/right=\d+\/3;/.test(r3.share && r3.share.tag || "")) fail("nextline: rounds 3 should play 3 rounds: " + JSON.stringify(r3.share));
    else print("  length: rounds 3 plays 3 rounds (" + r3.duration_sec + " s)");
    ["timed", "lives"].forEach(function (mode) {
      var mm = copy(base);
      mm.length = mode === "timed" ? { mode: "timed", seconds: 30 } : { mode: "lives", lives: 2 };
      var rr = JSON.parse(Bubble.simulateJSON(JSON.stringify(mm), JSON.stringify({ seed: mm.seed, max_ticks: 60 * 150, bot: true, bot_seed: 11, bot_skill: 0.5 })));
      if (!rr.ok || rr.outcome === "timeout") fail("nextline: " + mode + " mode should end: " + JSON.stringify({ ok: rr.ok, outcome: rr.outcome, error: rr.error }));
      else if (mode === "timed" && rr.duration_sec > 30 + 26) fail("nextline: timed 30 s ran " + rr.duration_sec + " s");
      else ok(mode + " ends: " + rr.outcome + " after " + rr.duration_sec + " s");
    });
  }
}]);
