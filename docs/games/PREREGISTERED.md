# Preregistered games: brainy games and story quizzes

Written 2026-11-13, before any of these games was built. Karthik asked for two things:

1. "We don't have enough intellectually saturating games. Let's preregister and create and add more
   intellectual games."
2. "A couple games which are kind of pointless with respect to score, but mostly just more interactive
   ways of telling a story, like a funny video clip that's been broken up into a set of Kahoot-style
   answers … and a way to reflect that in real text."

This page fixes the list, what each game must do, and how each one is judged, **before** building. The
criteria below are frozen: results are added in the **Results** section at the end, failures included,
and nothing above that section changes after the first build.

## How the games are made

- **Hand-made gold games (4):** written by Claude in the authoring format (`authoring/games/gold_*.authoring.json`),
  expanded deterministically, with no Muse call. They join the gold set (`authoring/gold/`), and seed catalog
  types point at them, so the planner hands them to Muse as worked examples. Gold games are original (gold-set
  rule): no franchise names in them.
- **Muse games (10):** the full harness (Go planner `harness-query --muse --plan`, then the Studio compose with the
  verifier hooks, on the tall 360 × 780 canvas), with the gold games above in the catalog.
- **Fixes go to the source:** catalog types, checklists, fragments and gold examples in `authoring/`, never by
  hand-editing a Muse build. A Muse build that fails stays failed in the results.
- **Muse budget:** at most 14 full builds (a plan plus a compose is one build) and 20 image calls.
- **Canvas:** every game uses the tall canvas (`look.canvas: "tall"`).

## Acceptance criteria (the same for every game)

A game passes only if all of these hold:

1. **Gate:** it passes the five-bot playtest gate under its catalog `gate_profile`.
2. **Verifier:** `authoring/verify` reports **0 blocking findings** on every frame, and the rule proof holds.
3. **Look (Claude judge):** rendered intro, mid and end frames score **at least 4/5** on each of cohesion,
   hierarchy, restraint, theme fit and polish, with no text crossing a sprite.
4. **Engagement (blind):** a separate Claude judge, who sees the rendered frames and the game's content but not
   whether it is hand-made or Muse-made, scores **at least 4/5** on "intellectually engaging" (brainy games) or
   "funny" (story quizzes).
5. **Score and group play:** the score model below ships as declared (the score check passes, or `ranked: false`
   for the story quizzes), and the manifest carries a `group_play` block that compares same-seed runs as below.
6. **Content rules:** the content source is as listed; real people appear only as labelled parody with cartoon
   art; no copied quotes, audio, video, puzzles or crossword clues.

## The brainy games (10)

| # | Game | Made by | Concept | Skill it tests | Why it's deep, not trivia-shallow | Score model | Group play | Content source and license |
|---|---|---|---|---|---|---|---|---|
| B1 | **First Things First** (which came first) | gold (hand-made) | Two events from different fields; tap the one that happened first. The reveal shows both years and the gap. | Relative chronology across domains | Pairs are chosen to break intuition (Oxford University vs the Aztec capital, the Great Pyramid vs the last woolly mammoths, fax machines vs the telephone); you reason from anchors, not recall one date | `points`, higher; right answer 100 plus a speed bonus up to 50, a 3-streak multiplier; 12 pairs | same seed, compare score | Historical dates are public facts; all wording original |
| B2 | **One Move** (mate in one) | gold (hand-made) | A drawn chess board; pick the one move that checkmates from four candidate moves | Chess calculation: checks, captures, escape squares | Every wrong candidate is a plausible check that fails for a concrete reason (an escape square, a capture, a block), so you must calculate, not pattern-guess | `points`, higher; 100 per mate, minus time; a wrong move costs one of 3 lives | same seed, compare score | Positions composed for this game (original); chess rules are public |
| B3 | **Rarest Spell** (Harry Potter, Krillion-style) | Muse | Prompts like "Name a spell that attacks"; type an answer; rarer valid answers score more | Depth of recall, risk choice (safe common answer vs rare one) | Rarity tiers reward knowing the long tail and judging what others won't think of | `tiered_points`, higher | same seed, compare score | Spell names from the books, used as facts (real names allowed, Karthik 2026-11-12); prompts original |
| B4 | **Root Words** (etymology chains) | Muse | A word and four candidates; tap the one that shares its root; the reveal names the root and its meaning | Morphology, word-root reasoning | Distractors look alike but come from different roots (e.g. "salary" with "saline", not "salamander"), so you decompose words instead of matching letters | `points`, higher, streak bonus | same seed, compare score | Etymologies are public facts; wording original |
| B5 | **Fermi Duel** (estimate) | Muse | Estimate a quantity ("piano tuners in Chicago") by picking an order of magnitude or a number; points by how close in log terms | Estimation, decomposition | Rewards breaking a question into known factors; closeness scoring means reasoning beats guessing | `points`, higher, by log error | same seed, compare score | Reference values from public statistics; wording original |
| B6 | **Logic Grid Mini** (zebra puzzle) | Muse | Three people, three attributes, a few clues; mark the grid until one answer remains | Deductive elimination | A solution needs chaining several clues; no clue alone answers anything | `time_to_complete`, lower, finished runs only | same seed, compare time | Puzzles generated for the game (original) |
| B7 | **Cryptic Mini** | Muse | Short cryptic crossword clues (definition plus wordplay); type the answer, hints cost points | Wordplay parsing: anagrams, containers, hidden words | Each clue must be parsed into definition and wordplay, the core skill of cryptics | `points`, higher; fewer hints and less time score more | same seed, compare score | Clues written for the game; no published clue copied |
| B8 | **Proof Order** | Muse | The steps of a classic proof (√2 is irrational, infinitely many primes) shuffled; tap them in order | Logical dependency | Each step depends on earlier ones, so the order is forced by logic, not by memory of the text | `points`, higher; correct placements, fewer mistakes | same seed, compare score | Classic proofs are public domain mathematics; wording original |
| B9 | **Capital Clues** (map deduction) | Muse | Clues about a country appear one at a time (borders, rivers, climate); name it or its capital as early as you can | Geographic deduction | Earlier answers score more, so you reason from partial clues instead of waiting for the giveaway | `points`, higher; more points for fewer clues | same seed, compare score | Geography facts; the repo's geo pack (`authoring/content/geo`) |
| B10 | **Predict the Experiment** | Muse | A short experiment setup (drop a feather and hammer on the Moon, a balloon over a flame with water) and three outcomes; pick one, then the reveal explains why | Physical intuition, scientific reasoning | Outcomes are chosen so naive intuition is often wrong; the explanation teaches the principle | `points`, higher, streak bonus | same seed, compare score | Classic experiments are public knowledge; wording original |

## The story quizzes (4)

Kahoot-style multiple choice, told as a scripted "clip" broken into beats. Each beat shows a quote card (the line
someone says, or the setup), the player guesses what happens or what was said next, then a reveal panel shows the
real line: the joke, the twist or the disaster. The "right" answer is the funny one. Score text reads as story
("Beat 4 of 8", "You saw it coming"), not points. Every clip is an original script written as text plus cartoon
panels; no recorded audio or video is used.

| # | Game | Made by | Concept | What it tests | Why it's funny, not random | Score model | Group play | Content source and license |
|---|---|---|---|---|---|---|---|---|
| S1 | **The Podium** (a press conference goes badly) | gold (hand-made) | A fictional mayor's press conference about a new bridge, in 8 beats; guess what he says next | Comic timing, reading the room | Each beat escalates; the real line is worse than every option you're offered, so the reveal lands as a punchline | `ranked: false`; the end card says how many twists you called | `opinion_compare`: friends see how often they picked the same answers | Original script; the mayor is fictional |
| S2 | **Purr Earth** (a nature documentary narrated by a cat) | gold (hand-made) | A cat narrates a wildlife film and keeps getting distracted (birds, a box, its own tail); guess its next line | Spotting the pattern in a character's voice | The cat's logic is consistent, so the joke is guessable once you learn it, which makes calling a twist satisfying | `ranked: false`; twists called | `opinion_compare` | Original script; cartoon art |
| S3 | **Debate Night** (politicians' press interview goes badly) | Muse | Real politicians as labelled parody caricatures in a disastrous interview; guess the next blunder | Comic timing | Escalating, clearly absurd lines; a PARODY label on screen; no line reads as real reporting | `ranked: false` | `opinion_compare` | Original parody script; cartoon caricatures only (never photoreal) |
| S4 | **The Interview** (a job interview gone wrong) | Muse | A candidate's job interview where every answer goes sideways | Comic timing | The candidate's misplaced confidence escalates beat by beat | `ranked: false` | `opinion_compare` | Original script |

## Source fixes planned before building

- A new **`story_quiz`** fragment: beats shown in a fixed order (not shuffled), a quote-card frame with the
  speaker and the line, three or four answer buttons, then a reveal panel with the real line and the punchline;
  pace text as story ("Beat 3 of 8"). It takes an optional media asset per beat (a picture frame now, a video
  later) so it can use uploaded photos. It keeps the player's picks in state (`picks`) for group compare, and
  counts `called` (twists guessed) for the end card.
- A catalog type for the story quiz, a checklist for it, and seed gold types pointing at the four gold games.
- Gold entries for the four gold games (`authoring/gold/`).

## Results

Filled in after building. Nothing above this line changes.
