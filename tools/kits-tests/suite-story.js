// Kit test suite: story graphs (docs/BUBBLES.md 7.6). Owner: the story feature.
// Loaded by run-node.js and run-jsc.sh before kits-tests-core.js; registers itself on KitSuites.
//
// Checks:
//   - the validator rejects a dangling choice, an orphan scene, a dead-end path (flags), a loop,
//     a graph deeper than 12, a bad timing window and too few endings, and accepts the example;
//   - for the example and every story seed, bot runs over 40 bot seeds reach every ending;
//   - replays reproduce the ending (share tag) and the score exactly;
//   - the tag carries ending, first, found and path, and the score text never names the ending.
var KitSuites = (typeof KitSuites !== "undefined" ? KitSuites : []).concat([{
  name: "story",
  run: function (env) {
    var B = env.Bubble;
    if (env.wanted.indexOf("story") < 0) { env.print("  (story not selected)"); return; }
    var cat = JSON.parse(B.catalogJSON());
    var formula = null;
    cat.formulas.forEach(function (f) { if (f.id === "story") formula = f; });
    if (!formula) { env.fail("story: formula missing"); return; }
    if (!formula.length || formula.length.default.mode !== "rounds" || formula.length.default.rounds || !formula.length.numbers || formula.length.numbers.rounds !== 12) env.fail("story: length default should be rounds with no number (endings end it), suggesting 12 (the depth cap) when locked");
    if (!formula.length || formula.length.modes.join(",") !== "rounds,endless") env.fail("story: length modes should be rounds and endless");

    function copy(x) { return JSON.parse(JSON.stringify(x)); }
    function validate(m) { return JSON.parse(B.validateJSON(JSON.stringify(m))); }
    function sim(m, o) { return JSON.parse(B.simulateJSON(JSON.stringify(m), JSON.stringify(o))); }
    function tagOf(r) {
      var out = {};
      String(r && r.share && r.share.tag || "").split(";").forEach(function (kv) {
        var i = kv.indexOf("=");
        if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
      });
      return out;
    }
    function scene(m, id) { return m.content.scenes.filter(function (s) { return s.id === id; })[0]; }

    // 1. Validator.
    var base = copy(formula.example);
    var v0 = validate(base);
    if (!v0.ok) env.fail("story example should validate: " + JSON.stringify(v0.errors));
    function expectReject(label, mutate, needle) {
      var m = copy(base);
      mutate(m);
      var v = validate(m);
      var hit = !v.ok && v.errors.some(function (e) { return e.code === "content" && (!needle || e.message.indexOf(needle) >= 0); });
      if (!hit) env.fail("story validator should reject " + label + ": " + JSON.stringify(v.errors));
      else env.ok("story validator rejects " + label + " (" + v.errors[0].path + ")");
      return v;
    }
    expectReject("a dangling choice", function (m) { scene(m, "wait").choices[0].to = "nowhere"; }, "isn't a scene");
    expectReject("a dangling skill miss", function (m) { scene(m, "line").choices[1].skill.miss = "nowhere"; }, "isn't a scene");
    expectReject("an orphan scene", function (m) {
      m.content.scenes.push({ id: "orphan", text: "Nobody ever gets here.", choices: [{ text: "Go home", to: "lastloaf" }] });
    }, "can't be reached");
    expectReject("a dead-end path (every choice gated by a flag you may not have)", function (m) {
      // The caught scene's only choice now needs "brave", which a missed tap never sets.
      scene(m, "caught").choices[0].need = ["brave"];
    }, "dead end");
    expectReject("an unreachable ending (its flag is only set after it's needed)", function (m) {
      // The apron needs "sunny", which only Lena's later choice sets: the secret ending can't be reached.
      scene(m, "kitchen").choices[0].need = ["sunny"];
      scene(m, "lena").choices[0].set = ["sunny"];
    }, "can't be reached");
    expectReject("a loop", function (m) { scene(m, "lena").choices.push({ text: "Back to the line", to: "line" }); }, "loops");
    expectReject("a graph that's too deep", function (m) {
      var chain = [];
      for (var i = 0; i < 13; i++) chain.push({ id: "deep" + i, text: "Step " + (i + 1) + " up the longest staircase in the city.", choices: [{ text: "Keep climbing", to: i === 12 ? "lastloaf" : "deep" + (i + 1) }] });
      m.content.scenes = m.content.scenes.concat(chain);
      scene(m, "lena").choices.push({ text: "Take the long stairs", to: "deep0" });
    }, "too deep");
    expectReject("a timing window that's too wide", function (m) { scene(m, "line").choices[1].skill.window = 0.6; });
    expectReject("a single ending", function (m) {
      m.content.scenes = m.content.scenes.filter(function (s) { return s.id !== "bench" && s.id !== "apprentice"; });
      scene(m, "lena").choices[0].to = "lastloaf";
      scene(m, "kitchen").choices[0].to = "lastloaf";
    }, "endings");
    expectReject("scene text over 160 characters", function (m) {
      scene(m, "wait").text = new Array(18).join("Still waiting. ");
    });
    expectReject("an ending scene with choices", function (m) { scene(m, "lastloaf").choices = [{ text: "Again", to: "line" }]; });

    // 2. Every ending is reachable by bots, and 3. replays reproduce ending and score.
    var stories = [{ name: "example:story", manifest: base }];
    env.manifests.forEach(function (x) { if (x.seed && x.valid && x.manifest.formula === "story") stories.push(x); });
    if (stories.length < 3) env.fail("story: expected the example and two story seeds, got " + stories.length);
    var skills = [0.15, 0.4, 0.7, 0.95];
    stories.forEach(function (x) {
      var m = x.manifest;
      var endings = m.content.scenes.filter(function (s) { return s.ending; }).map(function (s) { return s.ending.id; });
      var startChoices = scene(m, m.content.start).choices.map(function (c, i) { return c.id || String(i); });
      var found = {};
      var replays = 0, bad = 0;
      for (var b = 1; b <= 40; b++) {
        var skill = skills[b % skills.length];
        var r = sim(m, { seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: 5000 + b * 37, bot_skill: skill });
        if (!r.ok || r.outcome !== "success") { env.fail(x.name + ": bot run " + b + " didn't reach an ending (" + (r.error || r.outcome) + ")"); bad++; continue; }
        var t = tagOf(r);
        if (endings.indexOf(t.ending) < 0) env.fail(x.name + ": tag names an unknown ending " + JSON.stringify(r.share));
        if (startChoices.indexOf(t.first) < 0) env.fail(x.name + ": tag first is not a start choice: " + t.first);
        if (!/^\d+\/\d+$/.test(t.found || "") || Number(t.found.split("/")[1]) !== endings.length) env.fail(x.name + ": tag found should be n/" + endings.length + ": " + t.found);
        if (!/^\d+x?(\.\d+x?)*$/.test(t.path || "")) env.fail(x.name + ": tag path malformed: " + t.path);
        found[t.ending] = (found[t.ending] || 0) + 1;
        // No spoilers: the score text gives the number, never the ending's title.
        var title = scene(m, m.content.scenes.filter(function (s) { return s.ending && s.ending.id === t.ending; })[0].id).ending.title;
        if (r.share.score_text.indexOf(title) >= 0) env.fail(x.name + ": score text spoils the ending title");
        if (b % 5 === 0) {
          replays++;
          var again = sim(m, { seed: r.replay.seed, max_ticks: r.ticks + 120, bot: false, replay: r.replay });
          if (!again.ok || again.score !== r.score || tagOf(again).ending !== t.ending || again.share.tag !== r.share.tag) {
            env.fail(x.name + ": replay of bot run " + b + " differs: " + JSON.stringify({ score: [r.score, again.score], tag: [r.share.tag, again.share && again.share.tag] }));
          }
        }
      }
      var missing = endings.filter(function (e) { return !found[e]; });
      if (missing.length) env.fail(x.name + ": bots never found " + missing.join(", ") + " in 40 runs " + JSON.stringify(found));
      env.print("  " + x.name + ": " + endings.length + " endings, bots found " + Object.keys(found).map(function (k) { return k + "×" + found[k]; }).join(" ") + "; " + replays + " replays exact" + (bad ? "; " + bad + " bad runs" : ""));
    });

    // 4. Length: an endless story and a rounds story both still end at an ending.
    ["endless", "rounds"].forEach(function (mode) {
      var m = copy(stories[stories.length - 1].manifest);
      m.length = mode === "rounds" ? { mode: "rounds", rounds: 3 } : { mode: "endless" };
      var v = validate(m);
      if (!v.ok) { env.fail("story with length " + mode + " invalid: " + JSON.stringify(v.errors)); return; }
      var r = sim(m, { seed: m.seed, max_ticks: 60 * 150, bot: true, bot_seed: 77, bot_skill: 0.7 });
      if (!r.ok || r.outcome !== "success" || !tagOf(r).ending) env.fail("story with length " + mode + " should end at an ending: " + JSON.stringify({ outcome: r.outcome, tag: r.share && r.share.tag }));
      else if (mode === "rounds" && r.replay.length && r.replay.length.rounds !== 3) env.fail("story replay should carry the locked length");
    });
  }
}]);
