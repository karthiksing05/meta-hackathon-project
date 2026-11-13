# Video narration script (draft 2)

*For Karthik to record. Shot numbers match [storyboard.md](storyboard.md). Written 2026-11-13 by Claude (AI agent for Artem); draft 2 follows Karthik's 09:11 and 09:13 notes. Claims follow [../narrative.md](../narrative.md); the tagline is verbatim from [../STYLE.md](../STYLE.md).*

**Read time:** about 2:15 of speech at a calm 2.3 words a second; about 2:30 with the pauses and music beats. Per-scene times are in the table at the end.

## Recording notes

- Record each scene as its own take, with a second of room tone before and after. The video gets timed to your audio, so any pace that feels natural works. Pauses can run long, and the picture will wait for you.
- *(pause)* marks a beat for the picture. Quoted words are what a character types or sends, so read them a little lighter.
- Send WAV or M4A files, one per scene: `scene-0.wav` … `scene-6.wav`.

---

## Scene 0: Cold open

> There's no better way to connect than playing a game. *(0.1)*
>
> It's how families keep up, how strangers break the ice, and how old friends find their way back. *(0.2)*

## Scene 1: Old friends

> Maya and Jordan were best friends. Then life happened. *(1.1)*
>
> Five years later, "hey, long time" feels impossible to send. *(1.2)*
>
> But Jordan's score is right there in her Curios feed. *(1.3)*
>
> *(pause: she plays, 1.4)*
>
> The most frictionless way to break the ice. "Beat my 44?" needs no catch-up, no small talk and no right thing to say. *(1.5)*
>
> Jordan gets 51. *(1.6)* Then: "rematch?" And they're talking again. *(1.7)*

## Scene 2: Across generations

> Rosa is 74. Her grandson Leo is 19, and three time zones away. *(2.1)*
>
> She sends him a Curio about capital cities: "I played this and thought of you." *(2.2)*
>
> Same Curio, same seed, each in their own time. *(2.3)*
>
> Their family Group lines up the results. Grandma's won four in a row. *(2.4)*

## Scene 3: Meeting someone new

> Priya just moved and joined a climbing Group. She doesn't know anyone yet. *(3.1)*
>
> But on the Group's weekly board, Dev is one spot above her. *(3.2)*
>
> Add friend. Best of 5. *(3.3)*
>
> Same Curios, same seeds, so it's fair. No small talk required. *(3.4)*
>
> By Saturday, they're climbing together. *(3.5)*

## Scene 4: A big Group

> A whole Group can play too. Tech News adds its own questions, and Muse builds one quiz from all of them. *(4.1)*
>
> Add a sound, race the weekly board, *(4.2)* remix it. *(4.3)* Even brands get a Curio. *(4.4)*

## Scene 5: Limitless creativity

> And anyone can make one. *(5.1)*
>
> Sayings from around the world. *(5.2)* Escaping the office at 4:59 on a Friday. *(5.3)* Mr. Beast-style brainrot trivia. *(5.4)* Crocodilo versus pineapples. *(5.5)*
>
> Learn something, laugh at something, or just play. *(5.6)*
>
> Muse Spark reads it. Muse Wonder plans it. Muse Image paints it. And five bots play every game before you do. *(5.7)*
>
> Other apps are feature-first. Curios are fun-first: the connection comes with the play. *(5.8)*

## Scene 6: Close

> Muse Curios. If you can imagine it, it can be a Curio. *(6.1)*
>
> *(pause)*
>
> When the world is your muse, how will you create the content of tomorrow? *(6.2)*

---

## Timing

| Scene | Words | Target | Starts at |
|---|---|---|---|
| 0 Cold open | 28 | 10 s | 0:00 |
| 1 Old friends | 61 | 32 s | 0:10 |
| 2 Across generations | 50 | 23 s | 0:42 |
| 3 Meeting someone new | 46 | 24 s | 1:05 |
| 4 A big Group | 35 | 17 s | 1:29 |
| 5 Limitless creativity | 67 | 34 s | 1:46 |
| 6 Close | 26 | 10 s | 2:20 |
| **Total** | **313** | **about 2:30** | |

## Fact check

Every claim in the narration, and where it holds:

| Line | Holds because |
|---|---|
| "Jordan's score is right there in her Curios feed" | The Curios feed puts friends' Curios and scores first (FEATURES.md 5; DEMO_PLAN Demo 2) |
| "The most frictionless way to break the ice" | Karthik's wording (09:11) |
| "Beat my 44?" | Challenges are in the app: friends only, up to 20 (FEATURES.md 6) |
| "a Curio about capital cities" | Capital Clues is on Prod (Karthik, 07:32). Not called made by Muse |
| "Same Curio, same seed, each in their own time" | Group play is async on the same seed (FEATURES.md, "Async, not live") |
| "Their family Group lines up the results" | Group rounds: results line up in the Group (FEATURES.md 7) |
| "Add friend. Best of 5." / "same seeds, so it's fair" | Weekly board with Add friend, best of 5, scores replayed on the server (FEATURES.md 2–4). The picture shows Dev accepting before the match, as the app requires (PHONES.md, gap 2) |
| "Muse builds one quiz from all of them" | Make one together: each entry keeps its maker's name (FEATURES.md 8) |
| "Add a sound, race the weekly board, remix it" | Sounds, the weekly board and remix with credit are in the app (FEATURES.md 3, 9, 11) |
| "Even brands get a Curio" | The sponsored Curio card is in the app (FEATURES.md 13). Payouts and targeting aren't claimed |
| The four games in scene 5 | Real harness-v2 Muse builds (muse-wonder-1.0) that passed the bot gate: #11 Finish the Saying, #29 One Quick Thing: Escape 5pm, Mr. Beast Brainrot Trivia (slide 15) and #19 Crocodilo vs Pineapples (Claude for Karthik, 09:11). Shown from their own `poster.png`, not the Prod rebuilds |
| "Muse Spark reads it. Muse Wonder plans it. Muse Image paints it." | Karthik's wording in the handoff; matches the harness slides (14–15). It describes the pipeline: the four builds above were made by Muse Wonder alone, so the picture keeps them out of the Muse Image step |
| "five bots play every game before you do" | Five bots play every game to the end before it's published (slide 16) |
| "Learn something, laugh at something, or just play" / "If you can imagine it, it can be a Curio" | Karthik's 09:13 note: education, entertainment or pure interactivity; the bounds are limitless |
| "fun-first", "I played this and thought of you" | Karthik's positioning notes, 2026-11-13 08:18 (narrative.md, Positioning) |
| Tagline | Verbatim (STYLE.md) |
