# What we built

*What a person does with Whims, step by step, what is live and what is coming at commit `6b1cc85`, and the terms a judge may not know. Part of the pitch docs; start at [README.md](README.md).*

**Whims, in one line:** low-pressure, short-form games anyone makes from a sentence with Muse and plays with their friends, Groups and Events inside Facebook. Create on a whim, play on a whim.

## What a person does, step by step

1. **Describe.** Type one sentence in Muse Studio, for example "a chill game for my new running club about SF hills", or "dodge the fog over Twin Peaks, but gravity flips every tap". Or do nothing: a Group has a Daily Whim and an Event has an icebreaker.
2. **Agree the brief and how the game works.** Muse reads the sentence back as a short brief ("I read this as chill and social, for your new running club in San Francisco"). For a game made from scratch, a "How the game works" card lays out the parts (loop, verbs, pieces, rules, how it ends) and tags each one Known, Approximate or New to Muse. Muse asks only about parts it guessed and isn't sure of. Edit anything before the build.
3. **Build.** Studio shows Muse's real steps, including the bot lanes. There are two paths:
   - a **ready formula** (dodge, timing, merge, guess, sort, answer): a median of 28 s in our 10-run benchmark (D2);
   - **made from scratch** on the Rust/WASM microgame engine, with Muse writing the rules: a median of 99 s in the 12-request harness baseline (D30).

   Either way the game is validated and played by 5 bots before anyone sees it, and Muse repairs drafts that fail.
4. **Try it and change it.** Play it in Studio. "Change the game" (when there is an anatomy) maps what you say onto the parts it changes, then rebuilds. Tweaks, a new look and level 2 are one tap each.
5. **Share.** Pick friends, chats or Groups. The game page shows "How Muse made it" and who it was "Sent to". (Share replaced "Float" in Studio.)
6. **Play together.** Everyone it reaches gets the same game on the same seed, so scores are fair and can be checked.
7. **Meet and come back.** Your score lands on the board next to people you don't know yet: watch the replay of the person above you, then tap Add friend. Challenge Me turns a run into a head-to-head in a chat. Tomorrow there is a new Daily.

## What Muse does that could not be done without it

The full case is in [04-why-ai.md](04-why-ai.md). In short:

- **It turns any described idea into a game that plays the way the person meant**, with new mechanics where needed, and says which parts are new to it (D30 to D33).
- **It makes a game about these people, not a template.** Muse turned 7 of 7 picnic guests' opted-in intros into an icebreaker that pairs each name with facts from that person's intro, and 5 of 5 opted-in Group posts into a Daily (D8). Our keyword template, given the same 10 prompts, made only 2 on-topic games; Muse made 10 of 10 on-topic, as judged by one agent (D7).
- **It does the whole build.** Ember writes the brief; Wonder composes the game with tool calls, writes its content and repairs drafts that fail bot testing; Muse Image paints the cover (D1, D5). On the microgame path Muse also writes the art (SVG sprites) and picks sound sets.
- **It makes making cheap enough for everyone.** A game a day for every Group, or one for each Event, is only possible when nobody has to write it by hand.

## What is live, what is local, and what is coming (at `6b1cc85`)

"In the app" means on `main` at `6b1cc85` and reachable through the normal UI. The newest phone install anyone confirmed is `ee12c04` (on Karthik's, Artem's and Bayan's phones); nothing after it is confirmed on a phone (D38). Every other person in the demo is synthetic.

| Piece | Status | What is true |
|---|---|---|
| Muse Studio: Describe, Brief with "How the game works", Build, Try with "Change the game", Share | In the app | Real Muse from the app. The anatomy is saved on this device only; friends' devices don't get it |
| Microgames on the Rust/WASM engine | In the app | 8 `mg-*` seed games; the engine adds about 1.5 MB and 8 to 15 ms to the first microgame |
| Muse-made art and sound in games | In the app | SVG sprites with a sanitizer, 6 synthesized sound sets; sound is on by default with one app-wide mute |
| Whims feed ranked by the recommender (`game-recs.js` 0.5) | In the app | On by default (`FB_RECS=off` turns it off). Not yet confirmed on a phone after the merge |
| Group Blend on a Group page | In the app | Games picked for everyone, "Make our Blend game" (opens Studio with the Blend's prompt) and a "Taste twin" with Add friend. Members are synthetic |
| Challenge Me, group-chat play, Rematch, Challenge back | In the app, one device | Friends' scores are bot runs on the same seed, with replays. Nothing crosses phones: "Sent to" is local |
| Games tab in Groups, weekly board with Most improved, Challenge the Group, Search for games with "Make it with Muse" | In the app | Synthetic members and history |
| Make it together, Games about me, Remix with send back, story adventures, quiz night, Learn, length settings, saves | In the app | The collaboration batch, merged at 13:08 on Nov 12 |
| Event icebreaker | In the app | The in-app icebreaker is a hand-made seed; real Muse made Picnic Pals in a logged CLI run (D10) |
| Daily Whim | In the app as a hand-made seed | **Making a Daily from members' posts runs only through the CLI or a debug launch.** It is not in the Group UI |
| Board with Add friend | In the app | Rows are bot runs by synthetic people (Maya plays at skill 0.9). **Add friend goes to a bot row**, not a real person |
| "Made with Muse in N s" on seed games | In the app, **inaccurate** | 22 of 33 seed files carry studio stamps with hand-written times of 28 to 55 s (D39). Those games were written by build agents, not by Muse |
| "Muse makes it in about a minute" (Studio and Search copy) | In the app, **inaccurate** | Ready-formula games take a median 28 s, games from scratch a median 99 s |
| Backend (api and games servers) | Live on Prod | Runs Kevin's recommender in Go, ranked feed, search, Blend and generate; the Muse key is on the server. **Server generation has never completed a real end-to-end run**; the app's server path has only run against a mock (`FB_API=live` or `FB_GENERATE=mock`) |
| Demo world on the server | Removed | `0636df3` deleted the seed tool and bot scores: the server holds real data only. Friends, Groups, Blend and the feed stay |
| Gold set (16 hand-made example games) and gold retrieval in Muse's prompt | On `main` | Full gate 36 of 36. Nobody has measured whether gold examples improve Muse's games |
| Harness eval suite and anatomy mode | On `main` | Baseline measured (D30); anatomy mode run but not scored (D32) |
| Style kit (Muse as style director and illustrator) | Unpushed prototype | Not on any branch in the repo; not run on iOS (D37) |
| Two-person Blends, Event brackets, "Blend with" on profiles | Not built | Design only |
| Meta studio accounts and creator-inspired games | Not built (planned) | Karthik's decision at 18:00, Nov 12. See below and [11-roadmap.md](11-roadmap.md) |
| Admin opt-in for Dailies, opt-in toggle in the post composer, moderation step, "remove me" | Not built | Opt-ins are set in demo data |

## Planned: seeding the feed (not built)

Two ideas to make sure there is always something to play, decided by Karthik at 18:00 on Nov 12:

- **Meta studio accounts.** Meta-run accounts that each specialize in one kind of game and post a new one every day: Daily Word, Party Night, Story Club, Quick Arcade and Group Trivia. They fill the feed on day one, now that the server holds real data only. The accounts and their games belong in the backend database, not in app code.
- **Games inspired by famous creators.** "What game would MrBeast make?" Real creators' names are allowed, as an exception to the synthetic-people rule for these accounts only. Each game says it is *inspired by* the creator ("A Whim inspired by MrBeast"), never that the creator posted it, and the mechanics are original. Examples: MrBeast's "Last One Standing" elimination, Gordon Ramsay's "Service!" kitchen rush, Markiplier's "Don't Look Behind You" jump-scare run and Mark Rober's "Squirrel-Proof" obstacle course. The full starter list is in [11-roadmap.md](11-roadmap.md#seeding-the-feed-studio-accounts-and-creator-inspired-games).

## Terms a judge may not know

| Term | Meaning |
|---|---|
| Whim | One tiny game, described by a small JSON file (a manifest). The code still calls it a Bubble. |
| Formula | A game type the JavaScript runtime knows how to run. Six ship: dodge, timing, merge, guess, sort and answer. A seventh, "make" (create something, then friends judge it), is designed but not in the runtime. |
| Microgame | A game Muse writes from scratch for our Rust/WASM engine: its own rules, state, art and sound, stored as exact JSON text. It runs side by side with the formulas. |
| Concept and kit | Concepts are the 55 tested building blocks a formula game is assembled from (for example a daily gate, a seeded deck, a scoring rule). A kit is the code that runs one formula's concepts. |
| Fragment | A reusable, tested piece of a microgame (33 on `main`), the microgame version of a concept. |
| Game anatomy | Muse's part-by-part read of how a game works, agreed with the maker before the build. Each part is Known, Approximate or New to Muse. |
| Gate | The check every game passes before anyone sees it: it validates, and 5 bots play it. A good game lasts 10 to 120 s, can be lost and can score. |
| Gold set | 16 hand-made example microgames, paired with the request a person would type; Muse sees the two closest ones. |
| Look | One of 8 visual styles (glow, paper, pixel, neon, ink, clay, riso, chalk) that Muse picks per formula game. |
| Seed plus input log | Every run starts from a random seed and records the player's inputs with timestamps. Replaying the same inputs on the same seed reproduces the exact score. That makes scores checkable and lets two people play the identical game. |
| Burst | A short replay of a real run, rendered from its input log (not a video). Tap it to "take over" and play the same game yourself. |
| Daily Whim | One game per Group per day, the same for every member, with one scored run each. |
| Board | A leaderboard with Group, Friends and Everyone scopes (formerly "Bubble Board"). Rows for people you are not friends with have an Add friend button. |
| Share (formerly Float) | Sending a game or your result, with its Burst, to friends, a chat, a Group or the feed. |
| Group Blend | A Group page section: games picked for everyone in the Group, a Blend game Muse makes for all of them, and a "taste twin" to add as a friend. |
| Muse Studio | The maker tool: one sentence in, a validated, bot-tested game with a cover out. |
