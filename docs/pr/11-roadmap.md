# Roadmap

*What is planned or not built yet, at commit `6b1cc85`, in rough order of how much it would change the pitch. Part of the pitch docs; start at [README.md](README.md).*

Nothing in this file is built unless it says so. For what is live, see [03-what-we-built.md](03-what-we-built.md). For proposed fixes to things that are built but wrong, see [open-items.md](open-items.md#proposed-app-fixes).

## Seeding the feed: studio accounts and creator-inspired games

Karthik's decision at 18:00 on Nov 12 (VP-41). It answers "where do the first games come from?", now that the server holds real data only (`0636df3`). Both parts are **planned, not built**. The accounts and their games would live in the backend database, not in app code (Max's rule).

### Meta studio accounts

Meta-run accounts, each specializing in one kind of game, each posting a new game every day:

| Account | What it posts |
|---|---|
| Daily Word | A daily word puzzle |
| Party Night | Party games for a Group or a group chat |
| Story Club | Adventures you play through, with friends' endings |
| Quick Arcade | Short arcade challenges |
| Group Trivia | Trivia a Group plays together |

The feed is never empty, and there is always something to play, remix and challenge a friend on.

### Games inspired by famous creators

"What game would MrBeast make?" Real creators' names are allowed. That is Karthik's call, logged in the build tracker's Decisions table as an exception to the synthetic-people rule for these accounts only. The guardrails:

- **Label each game "inspired by" the creator** ("A Whim inspired by MrBeast"), never as a post *by* them.
- **Mechanics stay original.**
- No face, voice, logo or quotes (our recommendation; see [08-qa.md](08-qa.md#creators-names-and-likeness)).
- Muse's prompts ban real people today, so these games need a reviewed prompt exception, and should be made and checked by the team, not generated on request.

The starter list (one game per creator, from the team thread; ideas, not built):

| Creator | Game | The idea |
|---|---|---|
| MrBeast | Last One Standing | 100 players, one tap per round, half are out each round. The last player wins a (fake) giant check, and the whole Group sees who lasted |
| Gordon Ramsay | Service! | Plate 5 dishes before the ticket times out. Raw food gets you yelled at; a perfect service gets praise |
| Markiplier | Don't Look Behind You | A jump-scare survival run, with a commentary line every time you flinch |
| Mark Rober | Squirrel-Proof | Build a 3-part obstacle course, then watch a bot squirrel try it. Friends try to beat your course |
| Dude Perfect | Trick Shot Ladder | A bank-shot game where each level adds a bounce. Share your hardest shot |
| Emma Chamberlain | Coffee Order Chaos | Remember and build ever more absurd coffee orders |
| Kai Cenat | Stream Raid | Keep chat hype up by picking the right reaction before the meter drops |
| IShowSpeed | Speed Run Dash | A frantic runner where the screen shakes harder the faster you go |
| Taylor Swift | Era Sort | Put songs into the right era as fast as you can; friends race on the same set |
| Bad Bunny | Ritmo | Tap to the beat; the tempo climbs every 8 bars |
| Zach King | Spot the Edit | Find the magic cut in a short scene before it plays again |
| Bobbi Althoff (and interview creators) | Awkward Silence | Pick the reply that keeps the interview going, or don't |
| Khaby Lame | Obviously | A life hack plays out; tap the simple fix before time runs out |
| Ninja or Pokimane | Clutch Moment | A 1-v-3 reaction duel; your best clutch posts to the Group board |
| Bon Appétit-style chef creators | Mise en Place | Prep a recipe's ingredients in order under time pressure |
| Ms Rachel | Sing-Along Shapes | A gentle, no-fail matching game for little kids and parents |
| David Dobrik | Surprise Box | A guess-the-prize game where friends vote on what's in the box |
| Alix Earle | Get Ready With Me | A timed outfit-and-routine pick, scored by your friends |

Notes on the list: Ms Rachel's audience is small children, which conflicts with Whims being adults-only (Meta limits Muse to 18 and over [6]); flag it before building. "Sing-Along Shapes" is also a no-fail game, which today's gate blocks. Song titles in "Era Sort" are themselves copyrighted names; treat it like any franchise request ([08-qa.md](08-qa.md#where-the-ip-line-sits)).

## Make the core thesis real

| Item | Why it matters | State |
|---|---|---|
| Daily generation in the Group UI | "Every Group gets its own game every morning" is the thesis; today it runs only through the CLI or a debug launch | Not built in the UI; works through Studio's daily mode |
| Challenges that cross phones | Challenge Me, sessions and "Sent to" are local to one device | Backend routes for challenges, inbox and results are not built |
| Server generation, end to end | `POST /v1/generate` is live on Prod but has never completed a real run | Deployed, unmeasured |
| Anatomy synced with the game | Friends' devices don't get the agreed anatomy, so their remixes lose it | Not built |
| Real people behind Add friend | Add friend goes to bot rows | Needs real accounts on the server; the demo world was removed on purpose |

## Make "any idea" true

| Item | Why it matters | State |
|---|---|---|
| A genre-aware gate | Calm, puzzle and story games fail today's "must be losable" check (`cant_lose`), so 4 of 11 anatomy-mode games were blocked (D32) | Not built |
| A game-defined share grid | The one engine gap the expressiveness audit found (Wordle-style results) | Named engine gap (`share_grid`) |
| Build and play the 9 expressible test ideas | They fit the format but none has been built (D32) | Not started |
| Score the anatomy mode; re-score franchise requests after the theme fix | Today's numbers are one baseline; anatomy mode is unscored | Runner exists (`run.mjs --anatomy`) |
| Human judges on the eval | Muse judges its own games today | Not started |
| Fix gold retrieval | "star wars deflect" retrieves Aura Farm and Cake Tower, not Rift Run | Known bug |
| Design block, no-LLM quality check and one polish round | Artem's next step for the harness | Just started at 17:19 |
| Style kit (Muse as style director and illustrator) | Muse's own art is weak: characters and palettes (D31) | Uncommitted prototype on Bayan's machine; not run on iOS (D37) |

## Bring people closer, next

| Item | VP | State |
|---|---|---|
| Two-person Blends and "Blend with" on profiles and board rows | VP-40 | Not built; the Group Blend is live |
| Event brackets for everyone you met | VP-40 | Not built |
| Facebook Verified badges on board rows and icebreakers | VP-07 | Not built |
| Bursts shared to Instagram Stories and challenges into WhatsApp | (section 3.3 of [05](05-why-facebook.md)) | Proposal |
| Remix trees with friends highlighted | VP-17 | Not built |
| Friend and Group scopes for server leaderboards; the moments inbox | VP-04, VP-16 | Not built on the server |

## Trust, safety and privacy (needed before any launch)

- An opt-in toggle in the post composer for "use in Whims" (opt-ins are set in demo data today).
- Admin opt-in for Dailies, with preview and veto.
- A moderation step for briefs and content, and "remove me from this game".
- Games about a named person made only by that person or with consent.
- Server-side replay verification of scores.
- Retention and deletion rules for anything the server generates from posts.
- App Store 4.7 items: reporting, an index of games and an age gate.
- Rights checks for franchise requests and creator-inspired games.

## Deeper AI

From the earlier draft's "what's next": photos in requests via Spark; spoken requests via Muse voice transcription; sketch input and play insights (where people tap, fail and quit) feeding the next version; new mechanics as sandboxed plugins; the Muse re-rank term (built, off by default) with a one-line "why"; SAM for cutting objects from a Group photo into game pieces.

## Measure it

The pilot, north star and guardrails are in [06-closer-together-and-engagement.md](06-closer-together-and-engagement.md#how-wed-know-it-works). Quick studies before the demo are in [open-items.md](open-items.md).
