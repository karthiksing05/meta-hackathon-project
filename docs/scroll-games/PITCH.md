# Scroll Games: pitch and demo script

## One sentence

Scroll Games turns a sentence and a few friends' photos into a playable, challengeable mini-game in about five seconds, using Meta's Muse models to write the content and the new mechanics, and a small deterministic engine to run it safely.

## 30-second version

Everyone scrolls. Nobody makes anything, because making a game takes a team. We put a Games tab in the Facebook app. You type "a quiz about our Lisbon trip", pick the photos you choose to share, and Muse Ember writes an editable brief in about a second. Muse Wonder plans the game and a small script for a new rule ("final round is worth double") while Ember writes the questions from your photo captions. Five seconds later it is playable. Your friends get a "Beat them?" card in their feed, or a link that opens in any browser at the same seed. The server replays every play, so scores cannot be faked.

## Pre-demo checklist

1. Build the runtime: `scroll-games/scripts/build-runtime.sh` (produces `sgtool` and `player/pkg`, wasm 391 KB gzipped).
2. `MUSE_API_KEY` is in the repo-root `.env` (do not open or show that file on screen). Check `curl localhost:8787/api/health` shows `muse.configured: true` after starting.
3. Start the server: `cd scroll-games/server && go run ./cmd/server` (port 8787).
4. Warm the cache: `node scroll-games/scripts/e2e-test-game.mjs --no-start` once with the exact prompt you will type (about 3 cents). A cache hit is 3-5 ms.
5. Reset data: stop the server, delete `scroll-games/server/data/store.json` (keep `cache.json` so the warm prompt stays warm, keep `usage.json` so spend stays honest), restart. Synthetic users, groups and photos are reseeded.
6. Check spend: `curl localhost:8787/api/usage` is well under the $15 cap.
7. Run the iOS app in the simulator (iPhone, iOS 17+), open the Games tab once so the WebView warms up. Confirm there is no "Offline" banner.
8. Open `http://localhost:8787/player/` or a `/c/<id>` link in a desktop browser tab, ready for step 5 of the run sheet.
9. Screen: simulator on the left, terminal with the server log on the right (no `.env` visible).
10. Real-iPhone check (do once, early; only the simulator has been tested so far): plug in and unlock the phone, pick your team under Signing & Capabilities, and run on the device. On a phone, `localhost` is the phone itself, so open the gear on the Games tab and set the server to `http://<your-Mac's-LAN-IP>:8787` (Mac and phone on the same Wi-Fi; local-network HTTP is already allowed in the app's Info.plist). Play one game and the daily, and watch for stutter in the WebView.

## Fallback plan if Muse is slow or down

- Slow: keep talking over the stage checklist. The build screen shows each stage and its time, so a 10 s build still reads as work happening. Use the pre-warmed prompt, which finishes in milliseconds.
- Down or over cap: the server falls back to the pre-baked template (source `fallback`) and the brief screen labels it "Fallback brief". Say so honestly: "Muse is unreachable, so this is the pre-made manifest; the engine and scoring are identical." Keep one pre-generated, published Lisbon game in the feed to play instead.
- Server unreachable: the app shows a labeled "Offline: showing sample games" banner. Restart the server; do not demo offline data as live.

## Five-minute run sheet

| Time | On screen | Presenter says | Proves |
|---|---|---|---|
| 0:00 | Games tab feed: a "Challenges for you" row from Ana, then friends' games and scores | "This is a feed of games your friends made and scores they want you to beat. The top card is a challenge addressed to me." | Feed bands: challenges first, then you, friends, followed creators, discover |
| 0:30 | Tap a friend's game, play 3 questions, see the result and "You beat Ana's score" line | "It's a real game, not a video. Rust compiled to WebAssembly in a WebView, 391 KB. My score is verified by the server replaying my taps." | Wasm runtime, server replay, beat-them line |
| 1:05 | Tap Make a game. Type "A quiz about our Lisbon trip, playful, a little competitive". Choose the Lisbon group. Photo toggle is off by default; turn it on | "Photos only go to the server if I turn this on. It is off by default." | Opt-in for personal media, synthetic demo data |
| 1:30 | Review brief screen, "From Muse", appears in about a second. Edit the mood or rounds | "Ember wrote this brief in 1.2 seconds. I can change anything. The server has already started building from it." | Ember brief, editable brief, speculative generation |
| 2:00 | Tap Generate. Stage list ticks: plan, content, glue, validate, save, then "Done in ..." | "Wonder plans the manifest and a small script. Ember writes the questions in parallel. Validation takes about 100 ms. Because it started while I was reading the brief, this finished instantly." | Parallel Wonder and Ember, speculative generation (generate after review 13 ms), validator |
| 2:30 | **Muse is load-bearing.** Preview game: questions are drawn from the photos and captions (for example "Where was this sunset?"). Open the glue idea: final round worth double; the banner "Final round, double points!" appears | "Nothing here was pre-written. The questions come from our own photos' captions, and the double-points rule is a script Wonder wrote against our event API. Without Muse this game does not exist: a generic template could not know what is in our photos. The demo photos were themselves generated by muse-image-1.0 from the synthetic captions, and the Pena Palace, Santa Justa Lift and pastéis de nata photos match their questions." | Muse writes content from people's own material and new mechanics via glue |
| 3:15 | Play the preview, finish, preview score. Tap Publish. Note "Moderation: stub (always passes in this demo)" | "It runs in a sandbox: 50,000 operations per event, no eval, no imports. If a script fails, that rule switches off and the game goes on. Moderation is a stub today and I'll say so." | Rhai sandbox limits, honest moderation stub |
| 3:45 | Result screen, tap Challenge friends. Share sheet shows the text "<Name> scored 840 on <title>. Beat them?" and a link | "The link is `/c/<id>`." | Challenge flow |
| 4:00 | Desktop browser: paste the link. Same questions, same order, no app | "Same seed, in a plain browser. A friend without the app can play and gets a Get Scroll Games link." | Browser-playable challenge links, deterministic seeded runtime |
| 4:15 | Games tab: the pinned "Today's daily" card (date, friends played, flame streak, reset countdown). Tap "Keep streak", play, finish. HUD chip "Daily · Nov 12"; result shows "Streak: 4 days" and "#3 among friends on today's daily" | "One seeded game per UTC day, same for everyone. The first verified play counts, later ones are practice, and the server replayed this score." | Daily game, streak, server-verified daily score |
| 4:30 | Terminal: `curl localhost:8787/api/usage` and the e2e timing printout | "Whole build 5.2 seconds, about 2.7 cents. 9 of 9 live plans passed validation first try." | Cost, latency, reliability numbers |
| 4:45 | Back to the feed; the new game and the challenge are at the top in the "You" band | "A sentence became a game that is now in the feed. Thank you." | End-to-end loop |

## Key numbers to have ready

- Live in-app build 5.2 s (plan 5.0 s Wonder, content 2.2 s Ember, in parallel, validate 20-125 ms).
- Brief 1.2 s p50; brief plus generate 6.6 s p50 (was 16.5 s); generate after brief review 13 ms; cache hit 3-5 ms.
- About $0.027 per game. 179 concepts across 14 kinds, 20 implemented.
- Plans validated first try 9 of 9 live runs. Scores verified by server replay.
