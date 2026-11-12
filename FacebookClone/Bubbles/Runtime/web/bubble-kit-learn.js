// Bubble kit: learn. See docs/BUBBLES.md, 4.6 and 7.8. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// STUB from feat/base: a placeholder formula so the catalog, validator, tests, Studio and the app
// all know "learn" exists. Owner: the learn feature, which replaces space.learn_stub with the real
// concepts, content schema, bot and examples (keeping the formula id and the length contract).
//
// Length contract (docs/BUBBLES.md 7.9): read sdk.length, call sdk.lengthRound() when a round ends
// and sdk.lengthMiss() on a miss; declare `length` on the formula.
// Planned content shape: { lesson: { title, points: [...] }, questions: [{ q, choices, answer, explain }] }
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  B.defineConcept({
    id: "space.learn_stub", kind: "space", version: 1, formulas: ["learn"],
    describe: "Placeholder stage for the learn formula until its kit lands: shows the title; taps score.",
    examples: ["a placeholder learn stage"],
    params: {},
    consumes: [], emits: [], requires: [], conflicts: [], tags: {}, glue: [],
    setup: function (sdk) {
      sdk.layer(sdk.Z.space, function (g) {
        g.text(sdk.manifest.title, g.w / 2, g.h * 0.42, { size: 24, weight: 700, color: g.palette.ink, align: "center" });
        g.text("Tap to score", g.w / 2, g.h * 0.5, { size: 16, weight: 600, color: g.palette.ink, align: "center", alpha: 0.75 });
      });
    }
  });

  B.defineFormula({
    id: "learn",
    title: "Learn",
    describe: "A short lesson card, then practice questions with an explanation after each answer, a recap and a mastery streak.",
    core: ["space.learn_stub"],
    optional: ["input.tap", "score.count", "rule.timer", "share.score_card", "feel.mood_preset"],
    content: { describe: "Placeholder until the learn kit lands.", schema: { type: "object" } },
    length: { modes: ["rounds", "lives", "endless"], default: {"mode": "rounds", "rounds": 8}, knobs: {} },
    bot: {
      decide: function (sdk) {
        // Tap about twice a second; better bots tap a little more often.
        var every = sdk.botSkill > 0.8 ? 24 : sdk.botSkill > 0.5 ? 30 : 40;
        return sdk.tick % every === 12 ? [{ a: "tap", v: [180, 420] }] : [];
      }
    },
    example: {
      id: "example-learn-stub",
      version: 1,
      title: "Hills of SF 101",
      one_line_rule: "Learn the city's hills, then prove it.",
      formula: "learn",
      brief: { intent: "placeholder", audience: "everyone", mood: ["playful"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      style: { look: "chalk", palette: "lilac-haze", emoji: "🎓" },
      concepts: [
        { use: "space.learn_stub" },
        { use: "input.tap" },
        { use: "score.count", params: { on: "input.action", label: "taps" } },
        { use: "rule.timer", params: { seconds: 12, outcome: "success" } }
      ],
      content: {},
      seed: 2026111303
    }
  });
})();
