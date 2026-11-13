# harness-eval

Measures how well the microgame harness (MicrogameComposer + MicrogamePrompts, docs/BUBBLES.md 7.12)
turns a request into a game that matches it. Each suite entry is generated through the Studio CLI,
unchanged, then scored three ways:

- **Request match (judge):** one Muse call per game with a strict rubric. Each `must_have` is
  present or absent, with a quote from the game; each `must_not` is violated or not; theme 0–2;
  custom rule 0–2 (or n/a); feel 0–2. Each quote is checked against the game's text, which gives
  the "verified" coverage.
- **Keyword pre-check:** hits for the entry's `theme_terms`, matched with nothing but code, in the
  title, instructions, content, node text, art roles and internal names.
- **Logic sanity:** from the bots' gate report: the game can be lost, can be won or scored, runs
  last 10–120 s, and the bots' scores spread out. Calm, no-fail entries don't count "can be lost".
- **Cost:** time to the first valid manifest, repair rounds, total time and bytes.

Node only, no npm packages. The judge reads the same Muse config the CLI uses
(`FacebookClone/Bubbles/Studio/MuseConfig.json`, then `MUSE_API_KEY`) and never prints the key.

## Run

```sh
tools/harness-eval/build-cli.sh            # builds the CLI into tools/harness-eval/.build (gitignored)
OUT=/some/scratch/dir                      # results stay out of the repo

node tools/harness-eval/run.mjs   --out $OUT/baseline      # ~1–3 min a game, run one at a time
node tools/harness-eval/score.mjs $OUT/baseline            # keyword pre-check + logic + judge (~35 s a game)
node tools/harness-eval/report.mjs $OUT/baseline           # → $OUT/baseline/scorecard.md + scorecard.json
```

Useful flags:
- `--only id,id` picks entries. It also takes a category, a specificity or a source, for example
  `--only vague`.
- `--config FILE` sets the Muse config. It works on `run.mjs` and `score.mjs`, which is handy in a
  worktree that has no MuseConfig.json.
- `--fake-muse` (run) runs a scripted Muse, which proves the runner works without a key.
- `--skip-existing` (run) resumes a run.
- `--no-judge` (score) skips the Muse judge.
- `--rejudge` (score) judges again.

`build-cli.sh` compiles `tools/bubble-studio/build.sh`'s sources plus
`FacebookClone/DesignSystem/ProductName.swift`. `build.sh` on beta-version d7b34e3 fails to compile
without that file.

**How the brief is handled.** In the app, `StudioModel.draftBrief` drafts a brief and the composer
gets it. The CLI's `--microgame` mode can't take one, so it composes with `BubbleBrief(intent: request)`.
`run.mjs` still runs `bubble-studio brief` for each entry and saves the result as `app-brief.json`, so
you can see what the app's brief carries.

**Anatomy mode** (`run.mjs --anatomy`) runs the Studio's game-anatomy step before each compose:
1. `anatomy-helper` drafts the anatomy with `GameAnatomyMuse.draft`, using MuseAnatomyPrompts, the fast
   model, the live fragment catalog and calibration.
2. It answers each open question with its first option.
3. The request becomes `<request>\n\n<agreedText(request:)>`, as `StudioModel.microgameRequestText`
   builds it.
4. The same `--microgame` pipeline runs.

The judge still scores against the entry's own request. Reported times include the anatomy step.
Build the helper with `tools/harness-eval/build-anatomy.sh`. It reads the anatomy files from
`FacebookClone/Bubbles/Studio` when they are there, and from `ANATOMY_SRC=<folder>` otherwise.

Each entry's folder holds:
- `entry.json`;
- `app-brief.json`;
- `manifest.json`, `authoring.json` and `game.json`;
- `anatomy.json`, in anatomy mode;
- `cli.log`;
- `run.json`, with validity, repairs, the gate report with every bot run, timings, bytes and errors;
- `score.json`.

## Add ground-truth entries

Put a JSON file in `suite/`, for example `suite/artem.json`, holding one entry or an array of them:

```json
{
  "request": "a star wars game where I deflect blaster shots with a lightsaber",
  "specificity": "vague | some | specific",
  "must_have": ["…"],
  "nice_to_have": ["…"],
  "must_not": ["…"],
  "feel": "fast, heroic",
  "who_with": "friends"
}
```

These fields are optional:
- `id`, made from the request when left out;
- `source`, which defaults to the file name, so `artem.json` gives `artem`;
- `category`;
- `theme_terms`, the words for the keyword pre-check;
- `custom_rule`. A string describes a rule the game must implement, `null` means none (scored n/a), and
  leaving it out lets the judge decide from the request.

Ids must be unique across files. `suite/starter.json` holds the 12 starter entries.

## Compare two runs

```sh
node tools/harness-eval/compare.mjs $OUT/baseline $OUT/after [--out $OUT/compare.md]
```

This shows each aggregate before and after, with a ▲/▼ change, overall and by specificity and
category, then a row per entry: title, must_have, theme, rule, gate and time.

The judge is a model too. Read its `evidence` and `evidenceFound` in `score.json` before you trust a
small change, and compare runs judged by the same model.
