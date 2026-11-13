# Gap: open text (the player types or asks freely, or a character judges them)

Owner: Claude for Karthik (gap agent), 2026-11-12. Branch `gap-open-text`, pushed to `harness-v2`.

## Which requests need it

| Request | Kevin32 | What's hard |
|---|---|---|
| Lateral-thinking puzzles: "I ask yes/no questions to solve them" | #26 | answering questions the player writes in their own words |
| Rizz simulator: an NPC rates pickup lines from "cringe" to "W rizz" | #23 | a character judging what you say |
| Krillion-style typed answers (Greek myths) | #4 | typing; matching is already solved by `typed_answer` + `fuzzy_match` |
| "Wordle but with a different thing" | #12 | typing a guess from a list; solved by `fuzzy_match` against the roster |

Likely next: twenty questions, interrogate a suspect, ask the oracle, a debate or roast judge, convince the bouncer,
caption contests judged by a character.

On today's catalog the planner already reaches for the right shape on #26 ("typed questions are matched against the
puzzle's pre-written fact list ... no free-form AI answering", `kevin32/plans/26.json`), but had no tool for it, so
it listed `typed_answer` + `fuzzy_match`. Those match a short *answer* against a name; a whole question against a
fact needs a different matcher (measured below). #23 planned `quiz` with one "smooth" line and three "cringe" lines,
which loses the rating scale that is the joke.

## The constraint

Games replay deterministically (same seed and inputs give the same score, `MicrogameEngine.verify`), and Muse is
reachable only through the server. So whatever answers the player must either be fixed when the game is made, or be
recorded into the run so a replay sees the same answer.

## What exists (read from the code)

- **Engine:** text input is done. `{"text": "submit" | "change"}` input sources with `text {value}`,
  `presentation.text_field`, `placeholder` and `max_len` (`engine/SPEC-v0.2.md` section 4). The JS wrapper has
  `game.text(kind, value)`, the replay log records `{"t", "text": "submit", "value"}`, `mg-cli verify` replays it, and
  the Rust sim bot types random text.
- **App runtime (`FacebookClone/Bubbles/Runtime/web/bubble-kit-microgame.js`):** forwards pointer and swipe only.
  There is no `game.text(...)` call and no field, so a text-source game shows nothing to type into on the phone.
- **Playtest bots (`authoring/playtest/bots.mjs`):** taps, keys and swipes only; an input with a text source is
  treated as a pointer input. A game that only takes text can't pass the gate.
- **Expander:** `typed_answer` (Artem) and `fuzzy_match` type on the `keyboard` fragment grid (letters, space,
  delete, submit). Matching is deterministic and shared by phone, bots and replays.
- **Server:** no endpoint calls Muse during play.

## Options

### A. Build-time fact banks (built here)

Muse writes, when the game is made: the case (setup, hidden solution), 30–60 **facts** (a yes/no/irrelevant/partly
reply plus the concept words players use) and the solutions. At play time a deterministic **intent matcher** maps the
typed question to a fact.

The matcher (`authoring/expander/intent.mjs`) works like this:
- a fact is concept groups ("hiccup=hiccough | scare=fright=startle"); it fits when every group has a word in the
  question;
- the words go through `fuzzy_match`'s normalizing, then a root (-ing, -ed, -ly, final e, doubled consonant), and
  one typo is forgiven on words of 5+ letters;
- the fact with the most groups wins, then the one whose words explain more of the question;
- no fit gives "Ask another way" and costs no question, because a wrong yes/no is worse than no answer.

`fuzzy_best` on whole questions doesn't work: it scores string similarity, so "was the gun loaded" is closest to
whichever fact *sounds* like it.

**Measured, real Muse** (muse-wonder-1.0, low effort; `authoring/tools/fixtures/qa-eval.json`,
`node authoring/tools/qa-eval.mjs`). There are 2 puzzles: Kevin's bar-and-water riddle and an original one Muse
wrote. For each, I wrote 15 questions the way a player would, seeing only the setup, then labelled them from the
solution. These questions are held out: no bank was built or repaired with them.

| Bank | Muse calls | Right | "Ask another way" | Wrong reply |
|---|---|---|---|---|
| First draft (first prompt, first matcher) | 1 | 23/30 (77%) | 3 | 4 |
| First draft, final matcher | 1 | 24/30 (80%) | 3 | 3 |
| A second first draft (prompt asks for a fact per person and object) | 1 | 20/30 (67%) | 5 | 5 |
| **Refined: Muse writes 40 probe questions with true replies, the matcher answers them, Muse repairs the failures once** | 3 | **28/30 (93%)** | 1 | 1 |

- On Muse's own probe questions, the repair took failures from 14/40 to 2/40 (bar) and from 22/40 to 2/40 (alarm).
- The tail is bank coverage, not the matcher. "Is she afraid of fire" had no fire fact. "Does she race to stop it
  so it doesn't wake anyone" landed on the "race" fact.
- Negation ("for something other than drinking") is a known limit.
- Two first drafts of the same puzzle differ by 4 right answers, so the refine round matters more than the prompt.
- Each refined bank costs about 2 minutes and 3 Muse calls at build time (bank 35–65 s, probe 14–27 s, repair
  40–71 s).
- In the engine, a question takes about 30 ms on a 55-fact bank (keystrokes included).
- Honest caveat: 30 questions is small, and one matcher rule (both words need 5+ letters before a typo counts, so
  "than" never hits "thank") was added after seeing the held-out set.

UX that makes the remaining misses fair: the game shows **which question it answered** ("Did he drink the water?
No"), so a near-miss reads as "it heard me differently", not as a lie.

Cost: built. Replay risk: none, because the bank is content. Needs: Artem for the native text field (keyboard grid
until then), and Bayan for bots that type (below).

### B. Choice-based judging (built here)

The character's line, 3–4 replies, a 0–100 rating and a reaction for each are written at build time, in the
character's voice. The player picks a reply. This is a fully deterministic, ranked score. It fits rizz, convince the
bouncer, roast or debate judges, and caption contests with a judge. It is the honest version of "an AI rates
anything I type": the person sees the scale, the reactions and the variety, and no typing is judged.

Cost: built (`npc_judge`). Replay risk: none.

In `spec.social` this is `result.kind: "score"` (the summed ratings), and friends on the same seed see the same
lines and replies. A `qa_bank` game is a score too: fewer questions to solve ranks higher.

### C. Muse while someone plays (`POST /v1/games/{id}/ask`)

The game sends the typed text to the server, Muse answers, and the reply comes back as an input event that the
replay log records. Verification replays the recorded reply and never calls Muse again.

- **Measured:** muse-spark-1.3 at `minimal` answered two yes/no questions from the hidden story in **1.7 s and
  4.3 s** (124 and 290 completion tokens). It got both right, and the bank missed both.
- Free-text judging ("rate my own pickup line") would need more tokens. HARNESS_V2 measured 5–12 s for spark at
  `minimal` on JSON tasks.
- **Cost:** one call per question. A 20-question puzzle is 20 calls per player per run, against 3 calls once at
  build time for A.
- **Abuse:** free text from players goes to Muse and comes back on screen. It needs a moderation pass, per-user and
  per-game rate limits, and a length cap.
- **Determinism:** fine if the reply is an input event, but the engine has no async host input today. Artem would
  have to add one (the runtime injects `{"ask_reply": {seq, reply}}` and the log records it).
- **Fairness:** two friends on the same seed can get different answers to the same question, which weakens "same
  game, compare after" (see `group-play.md`).

Cost: Max (endpoint, limits, cost), Artem (async input in the runtime and the log), about 1–2 days together. It is
too slow per turn for anything timed, and acceptable for a calm yes/no puzzle.

### Hybrid: A first, C only for misses

The bank answers what it can (93% after refining, instantly, for free). Only "Ask another way" questions go to the
server, at most a few per run, and the recorded reply goes into the log. Later, the misses logged across all players
can feed a nightly repair of the bank (a new game version), so C's use shrinks over time.

## Recommendation

1. **Ship A and B now.** That's `qa_bank` and `npc_judge`, on the keyboard grid. The refine round (probe plus one
   repair) is part of A, not optional: it is the difference between 77% and 93%.
2. **Ask Artem for the native text field.** It's the one thing between these games and a real phone keyboard. The
   engine side is already done.
3. **Hold C** until the demo needs it. If we build it, build it only as the hybrid's fallback for misses, with
   Max's limits, never as the main answerer.

**Honest stand-in until then:**
- Typing is the on-screen grid: letters, space, delete, no digits or punctuation, and questions up to 40
  characters.
- An unknown question says "Ask another way".
- "Rate what I type" becomes "pick what you'd say". The plan says so through the catalog: `live_judge` is a `gap`
  with a `when_to_use` that tells the planner what to do instead.

## What was built

| Piece | Path | Notes |
|---|---|---|
| Intent matcher (JS reference + engine version) | `authoring/expander/intent.mjs` | generated into the fragment by `authoring/tools/make-qa-fragment.mjs` (`--check` in tests) |
| `qa-bank/1` content schema, checker, Muse prompts (bank, probe, repair), `toContent` | `authoring/expander/qa-bank.mjs` | `checkBank`: shape, sizes, replies, each fact's own question and paraphrases land on it, stop-word groups, facts that would also solve |
| Muse CLI | `authoring/tools/qa-bank-muse.mjs "<request>" --refine` | key read in memory only |
| Held-out eval | `authoring/tools/qa-eval.mjs`, `authoring/tools/fixtures/qa-eval.json` | the table above |
| `qa_bank` fragment | `authoring/fragments/qa_bank.fragment.json` | Ask and Solve buttons, clues, question budget, wrong-solve cost, reveal, `qa_progress()` for bots |
| `npc_judge` fragment | `authoring/fragments/npc_judge.fragment.json` | rating bands from a `labels` param, reaction, timer, `judged_high`/`judged_low`, `line_done` for rounds |
| Example game | `authoring/games/qa_ask_me_why.authoring.json` | the two refined cases |
| Catalog tools | `fragments.json`: `qa_bank`, `npc_judge` (shipped). `planned.json`: `text_input` (building, rewritten with the exact state), `qa_bank_content` (building), `npc_lines` (planned), `live_judge` (gap) | |
| Catalog types | `types/seed_open_text.json`: `lateral_thinking_yes_no`, `interrogate_typed_questions`, `npc_rates_your_line`, `convince_the_gatekeeper`; 7 eval cases in `eval/seed_open_text.json` | |
| Checklists | `checklists/deduction.json`, `checklists/party_social.json` (type-specific only; the family defaults are left to those families' writers) | |
| Tests | `node authoring/tools/test-qa.mjs` (84 checks with an engine) | the engine agrees with JS on held-out questions; solve, clue and score maths; a wrong solve and running out; replay verifies; `npc_judge` ratings, bands, reactions, timeout and replay |

**Not done:**
- The generator doesn't call the bank step yet. Compose would have to run `bankPrompt` → `probePrompt` →
  `repairPrompt` and put `toContent` into `content`. That is a content-step hook in `pipeline.mjs`, which the
  group-play agent owns (see the last request).
- Until then, compose can write a small bank directly from the fragment's `describe`, without the refine round.

**Gate:** the example passes the bot gate (`node authoring/playtest/run.mjs authoring/games/qa_ask_me_why.authoring.json`).

| Bot | Result | Score | Time |
|---|---|---|---|
| new player | lost on the 150 s limit | 50 | 150 s |
| pro | won | 1025 | 6 s |
| regulars | won | 900–1025 | 10–81 s |

The first run, with a 240 s limit, was blocked as "can't be lost". The bots climb `qa_progress()` by spelling a
fact's or solution's key phrase, so a strong bot solves almost at once by spelling the solution's key words. That
is a fair skill signal for the gate, but not real play. Pro and regular tie at 1025, so the score separates
weakly. The gate is slow on this game: 773 s, mostly lookahead over 30 keyboard taps.

## Requests

**Artem (engine/runtime): the native text field in the app runtime.** Ready to paste:

> Claude (for Karthik) here, following up your Krillion thread (19:42, item 4). The engine side of text input is
> done (SPEC-v0.2 §4: `{"text":"submit"|"change"}`, `presentation.text_field`, `game.text(kind, value)`, the replay
> log records `{"t","text","value"}`, and `mg-cli verify` replays it). The app runtime never wires it:
> `bubble-kit-microgame.js` only forwards pointer and swipe.
>
> Could you add the following?
> 1. When the loaded game has any input with a `text` source, show a native `UITextField` (or an HTML `<input>` in
>    the web view) at `presentation.text_field` `{x, y, w, h, size}`, scaled like the canvas. Use the source's
>    `placeholder` and `max_len` (default 32, max 200). Use the system keyboard with autocorrect on, return key
>    "Send", and no autocapitalisation.
> 2. On return, call `game.text('submit', value)` and clear the field. Optionally call `game.text('change', value)`
>    on each edit, only if the game has a change source.
> 3. Keep the canvas visible above the keyboard: lift the canvas, or let the game place the field and pad the
>    bottom by the keyboard height.
> 4. Make sure the run's replay log (the one the server verifies) includes the text events.
>
> Which prompts need it: #4 (Krillion, Greek myths: names with spaces), #26 (lateral puzzles: full questions), #12
> (typed guesses), and every `typed_answer` game. Today they type on the 30-key grid, with no digits or punctuation.
> When it lands, I'll switch `typed_answer` and `qa_bank` to take an optional text source alongside the grid. If you'd
> rather own that fragment change, say so.

**Bayan (bots and gate): bots that type.** Ready to paste:

> Claude (for Karthik) here. `bots.mjs` drives taps, keys and swipes, and treats a `{"text": ...}` input as a pointer
> input. Once the native text field ships, a typed game that takes text instead of the keyboard grid can't pass the
> gate.
>
> Could the action space get a `type` action? It would call `g.text('submit', s)`, where `s` is drawn from the
> game's `playtest.texts` (a list of strings; the qa_bank and typed_answer games would list their key phrases and
> answers) plus a few random strings for the new-player and spam bots. Lookahead would score it like any other
> action.
>
> For the gate profile, `lateral_thinking_yes_no` and `interrogate_typed_questions` use `puzzle`, and the judge
> games use `trivia`. Shout if you'd rather have a `deduction` profile.

**Max (server): only if we build option C.** Ready to paste:

> Claude (for Karthik) here, with no action needed yet. For free-typed games we ship build-time fact banks (93% of
> held-out player questions answered right, deterministic). If we later want Muse to answer the misses live, the
> shape would be `POST /v1/games/{id}/ask {run_id, seq, text}` → `{reply}`, with these properties:
> - Muse Spark at `minimal` (measured 1.7–4.3 s for a yes/no);
> - per-user and per-game rate limits (say 5 asks per run);
> - a moderation pass on the text;
> - the reply stored against the run, so verification uses the recorded reply.
>
> Cost: at most 5 calls per run, against 0 today. Tell us if any of that is a non-starter.

**Group-play agent (planner and prompts), for later:**
- In `pipeline.mjs`, a content step. When the plan's tools include `qa_bank`, run the qa-bank chain
  (`bankPrompt` → `probePrompt` → `probeFailures` → `repairPrompt`, about 2 min) before compose, and pass
  `toContent(bank)` as the game's content. Gate it behind the existing harness context.
- In the planner prompt, typed "judge what I write" ideas plan `npc_judge` and name `live_judge` in `gaps`. The
  catalog's `when_to_use` already says this.
- Kevin's `twenty_questions` and `twenty_questions_secret_friend` types should list `qa_bank` in `tools` in place
  of `typed_answer`. Those are his files, so I left them.
