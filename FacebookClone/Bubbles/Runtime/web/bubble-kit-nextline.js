// Bubble kit: nextline. See docs/BUBBLES.md, 4.6 and 7.7. Kits only call Bubble.defineFormula and Bubble.defineConcept.
//
// STUB from feat/base: a placeholder formula so the catalog, validator, tests, Studio and the app
// all know "nextline" exists. Owner: the nextline feature, which replaces space.nextline_stub with the real
// concepts, content schema, bot and examples (keeping the formula id and the length contract).
//
// Length contract (docs/BUBBLES.md 7.9): read sdk.length, call sdk.lengthRound() when a round ends
// and sdk.lengthMiss() on a miss; declare `length` on the formula.
// Planned content shape: { episodes: [{ cast: [...], lines: [...], answer: "...", decoys: ["...", "...", "..."] }] }
(function () {
  "use strict";
  var root = typeof globalThis !== "undefined" ? globalThis : this;
  var B = root.Bubble;
  if (!B || typeof B.defineConcept !== "function" || typeof B.defineFormula !== "function") return;

  B.defineConcept({
    id: "space.nextline_stub", kind: "space", version: 1, formulas: ["nextline"],
    describe: "Placeholder stage for the nextline formula until its kit lands: shows the title; taps score.",
    examples: ["a placeholder nextline stage"],
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
    id: "nextline",
    title: "Next line",
    describe: "Guess what they say next: a short scripted scene freezes before the punchline; pick the real line from four tiles against the clock.",
    core: ["space.nextline_stub"],
    optional: ["input.tap", "score.count", "rule.timer", "share.score_card", "feel.mood_preset"],
    content: { describe: "Placeholder until the nextline kit lands.", schema: { type: "object" } },
    length: { modes: ["rounds", "timed"], default: {"mode": "rounds", "rounds": 5}, knobs: {} },
    bot: {
      decide: function (sdk) {
        // Tap about twice a second; better bots tap a little more often.
        var every = sdk.botSkill > 0.8 ? 24 : sdk.botSkill > 0.5 ? 30 : 40;
        return sdk.tick % every === 12 ? [{ a: "tap", v: [180, 420] }] : [];
      }
    },
    example: {
      id: "example-nextline-stub",
      version: 1,
      title: "Thermostat Wars",
      one_line_rule: "Guess what the roommates say next.",
      formula: "nextline",
      brief: { intent: "placeholder", audience: "everyone", mood: ["playful"], energy: "low", competition: "light" },
      structure: { cadence: "endless", scope: "everyone", setter: "ai" },
      style: { look: "riso", palette: "lilac-haze", emoji: "💬" },
      concepts: [
        { use: "space.nextline_stub" },
        { use: "input.tap" },
        { use: "score.count", params: { on: "input.action", label: "taps" } },
        { use: "rule.timer", params: { seconds: 12, outcome: "success" } }
      ],
      content: {},
      seed: 2026111302
    }
  });
})();
