# Scroll Games: judge Q&A prep

Answers state what exists today. Say "stub" or "not built" when that is the truth.

**Privacy: are you reading people's photos?**
Personal media is opt-in and off by default. In the create flow the toggle "Use these photos to make my game" sends nothing unless on (`mediaIDsToSend` is empty when off, and the API carries `opt_in_personal_media`). When on, only the selected photos' captions go to Muse; at most a handful are selected. Demo data is synthetic, and the demo photos are Muse-generated with no identifiable faces. Not built: consent from other people in a photo, per-photo permissions, deletion of cached generations.

**Why Facebook?**
The material that makes a game fun is already there: friends, groups, trips, photos, captions. The distribution loop is there too: feed cards, challenges addressed to friends, followed creators. A generic game maker has neither.

**What happens without Muse?**
The engine still runs. Template games play, scores verify, challenges work, and the server falls back to the pre-baked manifest (labeled "Fallback brief"). What is lost is the point: nobody could make a game about their friends' photos in under a minute.

**How does it scale?**
- Cost: about $0.027 per game, mostly Wonder. Plays cost nothing from Muse; they are wasm in the client.
- Latency: brief 1.2 s p50, brief plus generate 6.6 s p50, live build 5.2 s, cache hit 3-5 ms. Speculative generation hides most of the plan time behind the creator's review.
- Caching: Muse results are cached on disk by input hash. Games are static data, so playing is CDN-friendly.
- Verification: replay is the Rust core, 20 ms or less per play.
- Honest limits: JSON-file storage and a single process today. A speculative job never used costs the same as a used one.

**Is AI-written code safe?**
Muse does not write app code. It writes a manifest (data) and a short Rhai script. Limits: 50,000 operations per event dispatch, expression depth 32, string max 1 KB, array max 256, no `eval`, no module imports, `emit` limited to `glue.*` and `feedback.*`. The validator dry-runs every script before a game can be saved. A script that errors at play time is disabled and the game continues. The script cannot touch the network, files or the app. Not claimed: formal proof of memory or time bounds beyond the operation cap.

**Moderation?**
Real, but a prototype. Deterministic pre-checks (blocklists, emails, phones, addresses, spam, length) plus one Muse Ember classification of all player-visible text and photo captions across seven categories. High blocks publish (422, stays draft), low publishes but shows only to the creator, and the verdict is stored on the game. It runs in parallel with validation, so it adds little to the wait (about 1.7 s, $0.0003 per game measured). If Muse is down or slow (5 s) we fall back to the pre-checks and the verdict says "pass-precheck-only". Any user can report a game; two reporters hide it pending review, and there is a queue endpoint. Gaps: it checks captions, not image pixels; pre-checks are English-only and evadable; no human review UI, appeals or Report button in the app; no measured accuracy.

**Are scores fair?**
The runtime is seeded and runs on a fixed 60 Hz step, inputs are recorded with their tick, and the server re-runs them with `sgtool replay`. A submitted score that does not match is stored as unverified. Limit: replay proves the inputs produce the score, not that a human sent them; a bot that answers correctly would verify. Challenges use the sender's seed so both players see the same game.

**Why WebAssembly?**
One engine for iOS WebView, plain browser and server verification, with identical results. 391 KB gzipped, no per-platform game code, and the sandbox boundary is the wasm module. A new game needs no app release.

**Offline and fallbacks?**
- Muse slow or down: repair call, then template fallback; brief falls back too.
- Spend cap reached (default $15): fallback used, labeled `fallback-budget`.
- Server unreachable: the Games tab shows a labeled "Offline: showing sample games" banner and sample photos. Playing a game already loaded works in the WebView; saving a score needs the server and shows "Score not saved".

**Cost?**
About $0.027 per game (Wonder $0.02-0.03, Ember about $0.001). Every call is metered at `/api/usage` and capped by `SG_SPEND_CAP_USD`.

**How reliable is the AI plan?**
Validated first try in 9 of 9 live runs. Failures get one repair call with validator errors, then the template.

**Is the leaderboard / data real?**
Users, groups, photos, games and plays are synthetic seed data. Identity is a fake user via the `X-User` header, default `u_me`. No auth.

**What would you build next?**
More templates and concepts (159 catalog entries are contract-only stubs), human review tools and image moderation, real accounts, consent from other people in photos, real-device testing. The daily game with streaks, Muse-generated demo photos and server-saved follows have shipped and were verified in the iOS simulator.
