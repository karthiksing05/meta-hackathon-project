# Open items (internal)

*Internal notes: reconciled numbers, pending decisions, what must land, proposed app fixes and what we still need to prove. Part of the pitch docs; start at [README.md](README.md).*

*Internal. Not for the stage.* Status is as of commit `6b1cc85`.

## Proposed app fixes

Things that are built but say something untrue, or that the pitch leans on. Each is a proposal for the team; none is done in this branch (this branch changes docs only).

| # | Issue | Where | Why it matters | Proposed fix |
|---|---|---|---|---|
| 1 | **Fake "Made with Muse in N s" stamps on seed games.** 22 of 33 seed files carry a studio stamp with Muse model names and a hand-written time (28.0 to 55.0 s), and the app shows "Made with Muse in N s · Wonder, Ember, Image" (D39). The games were written by build agents | `FacebookClone/Bubbles/Seeds/*.json` (`studio` block); `BubbleStore+Screens.swift` `studioStampText` | Fabricated provenance on screen. A judge who asks "was this made by Muse?" catches it, and it undercuts every honest Muse claim | Remove the `studio` block from hand-made seeds (they then show no stamp), or mark them `offline: true` so they read "Made with Muse Studio"; keep real stamps only on games imported from logged Muse runs |
| 2 | **"About a minute" copy.** Studio says "Describe a game and Muse makes it in about a minute." Search's empty state says "Muse builds it in about a minute." | `StudioModel.swift` (around line 429); `GroupsSearchScreens.swift` `makeWithMuseDetail` | Matches neither path: ready formulas take a median 28 s, games from scratch a median 99 s (D2, D30) | Drop the number ("Describe a game and Muse makes it") or say "in a minute or two", and let Studio's live steps show the time |
| 3 | **Daily generation isn't in the Group UI.** Making a Daily from members' opted-in posts runs only through the CLI or Studio's daily mode via a debug launch; the in-app Daily is a hand-made seed | Group page; Studio daily mode | The Daily is the core of the Group story (VP-01, VP-18) | Add an admin-only "Make today's Daily" on the Group page that opens Studio in daily mode; or import the logged First Hellos run as today's Daily and say so |
| 4 | **Add friend goes to bot rows.** Board rows and challenge opponents are bot runs by synthetic people (Maya plays at skill 0.9) | Board, head-to-head, Group Blend "taste twin" | The closer-together moment is a tap on a bot. Fine for a demo if we say so; bad if a judge finds out | Say "demo person" on stage; in the app, a small "demo" tag on synthetic rows; later, real accounts from the server |
| 5 | **"Blow a bubble" in code comments** | `BubbleGroupSection.swift` lines 3 and 172 | User-facing copy is already "Make a Whim for this group"; only comments remain | Update the comments when someone next touches the file |
| 6 | **Old brand colors in the docs** | `docs/BUBBLES.md` §2 (lilac, pink and peach gradient) | Contradicts the blue-to-violet brand the app now uses | Update BUBBLES.md §2 in a docs commit, announced (shared file) |
| 7 | **No real push notification** | The app has in-app notifications only | Any "your phone buzzes" opening is staged ([hook.md](hook.md)) | Optional: a local notification for "Maya beat your score" in debug builds, for the demo |
| 8 | **Recommender off means an empty Group Blend** | `GroupBlendSection` shows nothing when the recommender is off or the Group is too small | Beat 5 of the script relies on it | Leave `FB_RECS` unset on the demo phone; check the section on the phone build |

## Asks from Karthik's bus notes

Karthik's notes from the evening of Nov 12, recorded here so they aren't lost. None of these has been asked in Slack by this branch.

| Note (verbatim where quoted) | What it needs | Owner to ask | State |
|---|---|---|---|
| "Explain that bounds are truly limitless with the games that are possible." | Done in the docs: [01-story.md](01-story.md) step 6, [04-why-ai.md](04-why-ai.md), the demo script and the line bank. The claim is framed as "if you can describe a 2D game, Muse can write it", with the seven engine gaps as the roadmap | (docs) | Written |
| "Have a game that can be gyro controlled?" | Device sensors are a named engine gap (`device_sensors`). Needs a device-motion input source in the engine, the runtime bridge passing CoreMotion readings into the WebView, and replay logs that record them | **Artem** (engine) | Ask, not started |
| "Definitely need to prepare an intellectual game (Krillion for Harry Potter?)" | **Clarify "Krillion" with Karthik.** Our notes describe Krillion as a 2026 daily trivia game where rare answers score more. Three candidates the harness can build today are in [07-demo-script.md](07-demo-script.md#prepare-two-more-games-karthiks-bus-notes): "Rarest Spell", "Sort the Sorting" and "Who Cast It?" | Karthik (clarify); whoever runs Studio before the demo | Proposed |
| "Need to market the collaborative aspect of the app!" | Done in the docs: [01-story.md](01-story.md) step 4, [06](06-closer-together-and-engagement.md#marketing-the-collaboration), [hook.md](hook.md) option 12 and the demo script beats 4 to 6 | (docs) | Written |
| Meet someone new, then a 3-game get-to-know-you bracket | Being built on branch `fe-qol`, not merged. The docs call it "in progress" | The `fe-qol` owner | In progress |
| Muse harness ideas: A/B options, back-and-forth, tap-to-edit, thumbnail vs preview, endless-runner and trivia support | Roadmap items in [11-roadmap.md](11-roadmap.md#muse-harness-ideas-karthiks-bus-notes) | Artem (harness) | Roadmap |

**Numbers we reconciled.** Each of these numbers is used the same way, with its label, everywhere in docs/pr.

| Number | What it is | Label |
|---|---|---|
| Hill Drift 58.5 s | The first real end-to-end Muse game, about 08:33 PST on Nov 12, reported in Slack at 08:48: Ember wrote 12 SF hill names, Wonder assembled 15 pieces, 4 bots playtested it | Teammate-reported (not logged) (D11) |
| Hill Drift 25.0 s | A later, logged CLI run of the same sentence at 09:21 PST: Ember brief in 1.1 s, Wonder wrote 8 obstacle labels and composed 14 concepts, a "too easy" draft was repaired, glow look | Measured (D10) |
| Send It 28 s | The level-2 run, Send It 2, logged at 28.4 s. The restyle to pixel took 15.8 s. The first make of Send It was not logged | Measured (D26) |
| Muse time per game | Ready formula: median 28.0 s, range 15.7 to 40.9 s, over 10 benchmark runs (D2). Made from scratch: median 99 s, first valid manifest at 72 s, fastest 53 s, over 12 eval requests (D30). Replaces "25 to 59 s" and "about a minute" in our notes | Measured |
| Interleaving | 70.3% (95% CI 68 to 72%) after the repeat-window fix; 68.5% before. Use 70.3%, always with "simulated" | Simulated (D27) |
| Cover time | Median 20.2 s (9.1 to 34.9 s) while a game is composing, in parallel, adding a median 3.35 s to the total. The "about 11 s alone" in Slack was one standalone call and was not logged | Measured (D3); the 11 s is teammate-reported |
| Runtime tests (at `0a3e8f7`; now 600 and 590, D35) | Node runner: 318 passed, 0 failed (its main suite prints 310, which is the "310" in Slack). JavaScriptCore runner: 308 passed, 0 failed. Kit tests pass in both engines with 23 fingerprinted runs identical, and 11 of 11 manifests validate. The tracker's 212 and 202 were an earlier count, and the kit runner prints no test count, so "318 kit tests" is dropped | Measured, rerun today at `0a3e8f7` (D17) |
| Score verification | About 4.06 ms of CPU per run in Node. Replaces "about 24 ms" from the Build tracker | Bot-run (D14) |

**Unfinished notes from Karthik (ask him).** (From the earlier draft; may be resolved.)

- A Slack note at 10:56 on Nov 12 about the pitch showing specialization breaks off mid-sentence; probably "for Facebook", but that's a guess. Open on Agent Logistics.
- The sketch-input request at 09:55 on Nov 12 also breaks off. Open on Agent Logistics.
- A Brainstorm canvas note about using it as a personal agent (the word is cut off). Does a personal-agent angle belong in the pitch?
- The "What goes into a game?" stack, which Karthik was still working out.
- Brainstorm questions: a campus hook, and finding purpose in the age of AI. In or out?

**Decisions pending.**

- **The name.** "Whims" is the name for now (Slack 14:06, 14:19; `ProductName.display`). The Group card's "Blow a bubble for this group" is fixed in the app; the tracker may still call Studio "Blow your own".
- **The one moment judges remember.** Candidates: the Add friend tap on the board, the live Muse build, a rematch landing in the group chat, or the Blend.
- **Story order:** decided by Karthik: the seven-step spine in [01-story.md](01-story.md). Still open: which opening ([hook.md](hook.md) recommends the notification opening).
- **Whether to mention the AI-agent build story,** since judges score Muse use.
- **What to promise as "what's next"**: the script now says studio accounts and creator games out loud as planned, and shows the Group Blend live.
- **Default creator level:** Remix, Compose or Free.
- **Who exactly is the user:** just moved, first job or freshman? The demo assumes someone new in SF.
- **The monetization answer.**
- **Creators' names.** Karthik allowed real names for creator-inspired games; the Q&A recommends opt-in partnerships for anything built. Confirm the line, and whether Ms Rachel (an audience of small children) stays on the list.
- **Franchise requests on stage.** Recommendation: don't demo a franchise game.

**Must land before the pitch, or drop the claim.**

- ~~Messenger group-chat play and Challenge Me~~: in the app on one device since the collaboration batch.
- ~~Whims in Facebook Search and "Make it with Muse"~~: in the app.
- ~~The collaboration batch~~: merged at 13:08.
- Import the real Muse games we demo (First Hellos, Picnic Pals, Hill Drift, Send It, the fog pinball); check whether any are in the build at `6b1cc85` (none were at `0a3e8f7`).
- A phone build at `6b1cc85` or later, played through once: nothing after `ee12c04` is confirmed on a phone (D38).
- The "New" badge: not built; the new script doesn't use it.
- Labeled "Coming" frames: no longer needed; the new script has one spoken "planned" line.
- Rework the tracker's demo around closer together (still open on the tracker).
- An opt-in switch on posts, or a clear answer for how authors opt in.
- The blue-to-purple rebrand: done in the app (30 of 32 seed covers use the brand gradient); BUBBLES.md §2 still shows lilac, pink and peach (fix 6 above).
- The public README and docs: the README doesn't mention Whims, lists a Marketplace tab and says the code has never been compiled; FEATURE_PARITY.md shows the old tab bar; the BUBBLES.md seed table leaves out This or That: Picnic and Trivia Thursday: SF.
- Confirm the backups exist: offline composer, pre-made real Muse games, the paused seed library.
- Don't claim Muse reads photos: Spark 1.3 is listed for photos, but photo input isn't built.
- Fix or stop citing the seeds' "Made with Muse" stamps and invented times (fix 1 above).

**Numbers still to get.**

- Cold start from tapping the tab, and memory: unmeasured. Measure on the demo phone (section 11).
- Usage for ages 18 to 25: we have Pew figures for 18 to 29 [52][53] and for teens [54], nothing narrower.
- The teen chatbot figure (64%) and the teen daily-use figure in our notes: check against Pew's own pages or drop them.
- Flappy Bird figures from the Taxonomy canvas: fact-check or drop.
- The submission deadline: it isn't in the brief.

## What we still need to prove, and quick ways to get the data

| Gap | Why it matters | Quick way to close it before the demo |
|---|---|---|
| What Facebook context adds (context ablation) | Our "why Facebook" thesis says the value is the context; D7 only compares against a template | Run Muse twice on the same sentences: once with the Group, Event and member context, once with none. People rate the pairs blind on "mentions real members or facts", "would you play this with this Group" and "would you add someone after playing". About an hour |
| Muse relevance judged by people, not one agent or Muse itself | Our AI-essential claim (D7, D30) | Blind rating: 4 teammates rate the 10 Muse and 10 offline games as on-topic or not, order shuffled (about 20 minutes) |
| Game against text icebreaker | Answers "why a game at all?" | Hallway test with three arms: play the icebreaker; read an AI-written "meet who's coming" summary; read the plain guest list. Then ask each tester to name 3 guests, and ask whether they'd add one |
| How long people take, and whether they finish | Bot timings are a proxy (D15) | Hallway test: 5 to 10 people play the Daily and the icebreaker on a team iPhone; record time and completion |
| Daily generation in the normal UI | VP-01 and VP-18 are Debug/CLI only today | Fix 3 above |
| Phone performance and memory | Simulator only, teammate-reported (D18) | Measure warm switch, fps and memory on a team iPhone with Instruments, and save the log |
| Perceived wait | The game is ready at 21.0 s but shown at 28.0 s (D3) | Let people play once the game passes its checks, and fade the cover in later |
| Repairs on Group Dailies | Both logged Dailies needed a repair for the same rule (D5, D10) | Teach Wonder the one-flow rule in the daily prompt; saves about 12 s |
| Cost per game | No input-token counts (D9) | Log input tokens in the CLI and rerun the 10-prompt bench |
| Opt-in, moderation and anti-abuse | Named gaps (VP-21, [08-qa.md](08-qa.md)) | Add a composer toggle, a basic content check and "remove me"; until then, say "not built" |
| Venue network | Latency was measured on one network | Rerun 3 prompts on the venue Wi-Fi; keep a recorded backup run |
| Unverified sources | Some claims rest on secondary press | Check the Business Insider original on Pocket [44] and confirm Muse Ember on a Meta page [29], or cut them. Check whether the FY2025 10-K keeps the young-adult and "particularly younger users" sentences [12]. Verify events in WhatsApp Communities. Check whether "friend bubbles" is already a Facebook Reels feature name before settling the product name |
| Real usage | Every "Helps people" rating in [10](10-value-propositions.md) | The pilot in [06](06-closer-together-and-engagement.md#how-wed-know-it-works); none can be measured before the demo |
| Anatomy mode, scored | It's our best AI story and it's unscored (D32) | Score the existing anatomy run with `score.mjs` and `report.mjs`; compare with `compare.mjs`, keeping the ±10-point noise in mind |
| Franchise themes after the fix | The baseline scored 0.5 of 2 before the theme fix (D30) | Rerun the two franchise entries (`--only franchise`) |
| Server generation, end to end | Deployed but never run for real (D36) | One real `POST /v1/generate` job against Prod, with Max's OK (no Prod pushes for now) |
| Style kit on iOS | Only checked in headless Chrome (D37) | Load one Cable Car look in the app's WKWebView |

## Claims we could not verify for this revision

- Prod's current state (deployed commits, routes) is from teammates' Slack posts (15:03, 16:15, 16:51), not checked by us; we did not call the Prod API.
- The harness scorecard (D30) lives in a local scratch folder, not in the repo, so its numbers are from the scorecard and the Slack thread.
- The test counts in D35 are teammates' runs; we did not rerun them at `6b1cc85`.
- Whether the merged recommender and Group Blend compile and run on a phone at `6b1cc85` (the last commit fixed duplicate hooks from the merge).
- The 2026 attorneys-general settlement in [6]: terms not checked by us.
- The Social Network: we paraphrase the film's premise, not a line from it.

## Catch-up for Slack and the canvas

This branch was written without posting. When it's pushed, the post should say: branch `value-prop`, the pitch moved from `docs/VALUE_PROPOSITION.md` to `docs/pr/`, the new story spine and hook options, statuses updated to `6b1cc85`, and the proposed app fixes above, with owners to be picked.
