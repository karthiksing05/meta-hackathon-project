# Video storyboard (draft 2)

*For Karthik's review. Brief: Karthik's 07:49 handoff and his 07:54 follow-up (demo every feature, collaboration first, limitless creativity, flag real screens), his 08:18 positioning notes, and his answers on draft 1 (09:11 and 09:13: the new 1.5 line, about 2:30, soft electronic music, the Tech News Group, four real Muse builds in scene 5, and "the bounds are limitless"). Written 2026-11-13 by Claude (AI agent for Artem). The narration is in [script.md](script.md); claims follow [../narrative.md](../narrative.md), words follow [../STYLE.md](../STYLE.md), and feature status comes from [../demo/FEATURES.md](../demo/FEATURES.md) (`main` at `0249943`).*

**Length:** about 2:30. **Frame:** 1920×1080 (a 9:16 cut for Reels can come from the same scenes later).

**What changed from draft 1:** 1.5 now says "The most frictionless way to break the ice." Scene 2 is a learning Curio. Scene 4 moves to the Tech News Group and is shorter. Scene 5 shows four real harness-v2 Muse builds framed as learn, laugh and play; nothing has to be recorded first any more. The close lands "If you can imagine it, it can be a Curio" right before the tagline. The music is soft electronic.

## How to read the flags

Every shot has one flag, so Karthik can check it against `main`:

- **APP**: a real screen from the app, captured from the simulator or a phone on `main`, then placed inside a cartoon phone frame. The status word follows FEATURES.md ("in the app").
- **MUSE BUILD**: the `poster.png` of a real harness-v2 Muse build from `game-backups/2026-11-12-kevin47-harness-v2/games/<n>/` (muse-wonder-1.0 only, passed the bot gate). Never the later Prod rebuild of the same game, which has Opus or Muse Image art.
- **CARTOON**: illustration only. It shows feelings, places and people, never a feature that isn't built.

Nothing on screen claims live multiplayer, lock-screen push, Daily games or a "made by Muse" label on a game Muse didn't build.

## Style

- **Look:** bold ink outlines (`#1C1E21`, about 6 px at 1080p), flat fills, squash-and-stretch on every pop, tap and landing. Rounded, chunky characters with simple dot eyes. No photoreal people, and no likeness of a real person.
- **Palette:** pastel blue → violet. Backgrounds `#E3EDFF` → `#EEE5FF`; accents from the brand gradient `#0866FF` → `#8A3FFC`; cards `#FFFFFF`; ink `#1C1E21`; secondary `#65676B`. Blue marks competing (challenges, boards, best of 5); violet marks collaborating (Group rounds, making together, remix, sounds). **No pink.**
- **Type:** Figtree (in `../slides/fonts/`), 800 for on-screen words.
- **Phones:** one cartoon phone design used everywhere (rounded, thick outline, a slight wobble when tapped). APP and MUSE BUILD screens sit flat inside it, unfiltered, so they read as the real product.
- **Motion vocabulary:** a score "boings" in with squash-and-stretch; a sent Curio flies as a small card with a blue→violet trail; a notification drops in and bounces twice.
- **Sound:** Karthik's narration over **soft electronic music**: an original bed, or a CC BY track from our sound library credited in the end card. No copied recordings. Small UI ticks on taps.
- **Build:** SVG scenes in HTML, rendered frame by frame with headless Chrome, then cut to Karthik's audio (the same approach as `../slides/mock/render-clip.sh` and `make-mp4.swift`).

## The cast (all synthetic)

| Who | Scene | Look |
|---|---|---|
| Maya and Jordan, old friends | 1 | Maya: round glasses, big curly hair. Jordan: beanie, freckles |
| Rosa (74) and her grandson Leo (19) | 2 | Rosa: silver bun, cardigan, reading glasses on a chain. Leo: hoodie, headphones round his neck |
| Priya, just moved; Dev, a Group member | 3 | Priya: ponytail, climbing chalk bag. Dev: tall, cap on backwards |
| Tech News Group | 4 | A crowd of small, varied characters with laptops, stickers and headphones |
| People with ideas | 5 | Quick cameos by the cast above |

---

## Scene 0: Cold open (0:00–0:10)

| # | Time | Picture | Flag | Narration (see script) |
|---|---|---|---|---|
| 0.1 | 0:00–0:04 | A table seen from above. A deck of cards slides in and fans out with a squash; hands of different ages reach in from every edge. | CARTOON | "There's no better way to connect than playing a game." |
| 0.2 | 0:04–0:10 | Three quick vignettes pop in as rounded cards: a family around a board game, two strangers laughing at a trivia table, two old friends fist-bumping. Each card then shrinks into a small phone screen. | CARTOON | "It's how families keep up, how strangers break the ice, and how old friends find their way back." |

## Scene 1: Old friends (0:10–0:42) · *challenges, Curios feed, notifications*

**Who it brings closer:** two friends who drifted apart. **Feature:** a challenge ("beat my score"), sent to a friend. **Positioning:** the most frictionless way to break the ice.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 1.1 | 0:10–0:15 | A photo strip of Maya and Jordan as kids, then teens, then the strip tears. Five calendar pages flutter away. | CARTOON | "Maya and Jordan were best friends. Then life happened." |
| 1.2 | 0:15–0:20 | Maya on her couch, typing "hey, long time…" in a message box. She stares, deletes it letter by letter. The cursor blinks. Her shoulders sag (squash). | CARTOON | "Five years later, 'hey, long time' feels impossible to send." |
| 1.3 | 0:20–0:25 | Maya scrolls Facebook's Curios feed. A card shows Jordan's name and score on a Curio ("Jordan played this"). Her eyebrows pop up. | APP: Curios feed with friends' scores first | "But Jordan's score is right there in her Curios feed." |
| 1.4 | 0:25–0:30 | She plays it: real gameplay inside the cartoon phone. Her score boings in: 44. | APP: a Curio being played, then its result | (music beat) |
| 1.5 | 0:30–0:36 | She taps Challenge, picks Jordan. A small Curio card flies across the screen with a blue trail, carrying "Beat my 44?" Over it, on-screen text: **The most frictionless way to break the ice.** | APP: the challenge sheet (friends only) | "The most frictionless way to break the ice. 'Beat my 44?' needs no catch-up, no small talk and no right thing to say." |
| 1.6 | 0:36–0:39 | Jordan, on a bus, opens the app. The challenge is in Notifications. He grins, plays, gets 51. | APP: Notifications, Games section (in-app inbox, *not* the lock screen) | "Jordan gets 51." |
| 1.7 | 0:39–0:42 | Split screen: "51. rematch? 😄" arrives on Maya's side; she laughs and starts typing a long reply. The torn photo strip from 1.1 reseals itself. | CARTOON (the reply bubble is drawn, not a Messenger screen, since Messenger runs on demo data) | "Then: 'rematch?' And they're talking again." |

## Scene 2: Across generations (0:42–1:05) · *a learning Curio, Group rounds, same seed*

**Who it brings closer:** a grandparent and a grandchild who live far apart. **Feature:** a Group round: the same Curio and seed for everyone, each in their own time, results lined up in the Group. **Positioning:** "I played this and thought of you"; a Curio can teach, too.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 2.1 | 0:42–0:47 | A split screen with a map between them: Rosa at her kitchen table with tea; Leo in a dorm room. Clocks on each side show different times. | CARTOON | "Rosa is 74. Her grandson Leo is 19, and three time zones away." |
| 2.2 | 0:47–0:53 | Rosa finishes a capital-cities Curio and shares it to the family Group with a note: "I played this and thought of you, Leo." The Curio card flies across the map with a violet trail, little capital-city pins popping up along the way. | APP: Capital Clues (on Prod), shared to a Group as a Group round. Not called "made by Muse" | "She sends him a Curio about capital cities: 'I played this and thought of you.'" |
| 2.3 | 0:53–0:59 | Leo plays the same Curio that evening. On-screen chip: **same Curio · same seed · your own time**. | APP: Capital Clues in play | "Same Curio, same seed, each in their own time." |
| 2.4 | 0:59–1:05 | The family Group's round results line up: Rosa on top. Leo flops back on his bed (big squash), then sits up and taps Play again. Rosa sips her tea, smug. | APP: Group round results in the Group | "Their family Group lines up the results. Grandma's won four in a row." |

## Scene 3: Meeting someone new (1:05–1:29) · *weekly Group board, Add friend, best of 5*

**Who it brings closer:** two people who share a Group but haven't met. **Features:** the weekly board, Add friend, best of 5. **Positioning:** no small talk needed.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 3.1 | 1:05–1:09 | Priya surrounded by moving boxes in a new apartment. She joins a climbing Group on her phone; a little "Joined" check boings. | CARTOON, then APP for the Group's join button | "Priya just moved and joined a climbing Group. She doesn't know anyone yet." |
| 3.2 | 1:09–1:14 | The Group's weekly board. Dev's row sits one spot above hers, with **Add friend** next to it. The camera pushes in on the button. | APP: weekly Group board with Add friend | "But on the Group's weekly board, Dev is one spot above her." |
| 3.3 | 1:14–1:19 | She taps Add friend (the button wobbles and turns to Requested). Dev accepts on his phone. Then "Play Dev: best of 5" from his profile. | APP: Add friend → Requested; best of 5 from the profile | "Add friend. Best of 5." |
| 3.4 | 1:19–1:24 | Two phones side by side, five round dots between them filling blue one by one: 1–0, 1–1, 2–1, 2–2. On-screen chip: **same Curios · same seeds · fair**. | APP: best of 5 rounds (both phones) | "Same Curios, same seeds, so it's fair. No small talk required." |
| 3.5 | 1:24–1:29 | Round 5 lands; both characters jump. Cut to Saturday: Priya and Dev at the climbing wall, Dev pointing at her phone, both laughing. | CARTOON | "By Saturday, they're climbing together." |

*3.3 now matches the app: Add friend sends a request, and a best of 5 starts once they're friends (PHONES.md, gap 2).*

## Scene 4: A big Group (1:29–1:46) · *make one together, sounds, weekly board, remix, sponsored*

**Who it brings closer:** a whole Group, including the people who usually just lurk. **Group:** Tech News (Karthik's "we're all techy"). **Features:** make one together, sounds, weekly board, remix with credit, sponsored Curios.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 4.1 | 1:29–1:35 | The Tech News Group. Little question cards fly in from members, each signed with a name ("How many transistors in a 2026 GPU?", "Which company IPO'd first?"), and stack into a deck. The starter taps Make. | APP: make one together (entries with names, then Make) | "A whole Group can play too. Tech News adds its own questions, and Muse builds one quiz from all of them." |
| 4.2 | 1:35–1:40 | The Group's Curios: Honeypot Watch (the GPU Curio, the new illustrated version) and Lemonade to IPO, each with friends' scores. A sound waveform pulses behind one; the weekly board reorders with a bounce. | APP: Tech News with Honeypot Watch and Lemonade to IPO; a sound behind a Curio; the weekly board | "Add a sound, race the weekly board," |
| 4.3 | 1:40–1:43 | Someone taps Remix and types a sentence. A new Curio pops out with a caption crediting the original. | APP: Remix, with the credit caption | "remix it." |
| 4.4 | 1:43–1:46 | The feed scrolls past a sponsored Curio card from a brand. | APP: the sponsored Curio card (`../slides/img/app-sponsored.png` is a real capture) | "Even brands get a Curio." |

## Scene 5: Limitless creativity (1:46–2:20) · *make with Muse; learn, laugh, play*

**Who it brings closer:** everyone who makes a Curio for someone. **Feature:** make a Curio from one sentence. **The point Karthik wants stressed:** a Curio can be education, entertainment or pure interactivity, and the bounds are limitless. **Muse plug:** Muse Spark reads the idea, Muse Wonder plans it, Muse Image paints it, five bots play it.

The four builds are real harness-v2 Muse builds that passed the bot gate (Karthik's list, 09:11). They're shown in the order learn → laugh → play, so the numbering differs from his note: his 5.2 stays 5.2, his 5.4 is now 5.3, his 5.3 is now 5.4, and his 5.5 stays 5.5.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 5.1 | 1:46–1:49 | A blank Make box on the phone, cursor blinking. The cast from earlier scenes lean in around the phone. | APP: Make with Muse, empty | "And anyone can make one." |
| 5.2 | 1:49–1:53 | **Learn.** Rosa types her idea; *Finish the Saying* appears: trivia on sayings from around the world, with the country lit up on a map. Chip: **learn**. | MUSE BUILD #11: Finish the Saying (2 bots lost, 3 won) | "Sayings from around the world." |
| 5.3 | 1:53–1:57 | **Laugh.** Priya types hers; *One Quick Thing: Escape 5pm* appears: the last person in the office at 4:59 on a Friday, dodging the manager's "one quick thing". Chip: **laugh**. | MUSE BUILD #29: One Quick Thing: Escape 5pm (all 5 bots lost: it's genuinely hard) | "Escaping the office at 4:59 on a Friday." |
| 5.4 | 1:57–2:00 | **Play.** Leo types "brainrot trivia, Mr. Beast as the host". The trivia appears. Chip: **play**. | MUSE BUILD: Mr. Beast Brainrot Trivia (harness v2; `../slides/img/muse-mrbeast-trivia.png`) | "Mr. Beast-style brainrot trivia." |
| 5.5 | 2:00–2:03 | Jordan types his; *Crocodilo vs Pineapples* appears, a Galaga-style shooter, pineapples raining down. Chip: **play**. | MUSE BUILD #19: Crocodilo vs Pineapples (1 bot lost, 4 won). Backup: #3 Tung Tung Subway Chase | "Crocodilo versus pineapples." |
| 5.6 | 2:03–2:06 | The four posters fan out like cards under three chips: **learn · laugh · play**. | CARTOON + the four posters | "Learn something, laugh at something, or just play." |
| 5.7 | 2:06–2:14 | The pipeline as one cartoon machine. The typed sentence goes in. **Muse Spark** (a lens) highlights the key words; **Muse Wonder** (a blueprint) unfolds the plan, part by part, and a thumb taps "Agree"; **Muse Image** (a brush) paints the scene; then five little bots run through the game and each gets a check. The real Make screen with its bot lanes is shown in a phone beside the machine. | CARTOON machine + APP: Make's plan and build steps with the bot lanes | "Muse Spark reads it. Muse Wonder plans it. Muse Image paints it. And five bots play every game before you do." |
| 5.8 | 2:14–2:20 | Two signs side by side: a grey one, "Feature-first", with a lonely button; a gradient one, "Fun-first", with the whole cast playing around it. The grey sign tips over. | CARTOON | "Other apps are feature-first. Curios are fun-first: the connection comes with the play." |

*5.7 is about the pipeline in general. The four builds above were made by Muse Wonder alone, so their posters must not appear inside the Muse Image step.*

## Scene 6: Close (2:20–2:30)

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 6.1 | 2:20–2:24 | The cast's phones zoom out into one shared frame, each showing a different Curio, and keep multiplying outward past the edges of the screen. The words "Muse Curios" draw on in ink and gradient. | CARTOON | "Muse Curios. If you can imagine it, it can be a Curio." |
| 6.2 | 2:24–2:30 | Everything clears to white. The tagline alone, in Figtree 800, center. Small line underneath at the very end: "Muse Curios, a new feature in Facebook · made with Muse Spark, Muse Wonder and Muse Image", plus the music credit if it's CC BY. | CARTOON (type only) | "When the world is your muse, how will you create the content of tomorrow?" |

---

## Feature coverage

Karthik's list from the 07:54 follow-up, and where each one appears:

| Feature | Status on `main` (FEATURES.md) | Shot |
|---|---|---|
| Curios feed (friends' scores first) | in the app | 1.3 |
| Make with Muse (plan → build, 5-bot check) | in the app | 5.1–5.7 |
| Playing a Curio | in the app | 1.4, 2.3 |
| Group boards (weekly) | in the app | 3.2, 4.2 |
| Challenges | in the app | 1.5–1.6 |
| Best of 5 | in the app | 3.3–3.4 |
| Add friend | in the app | 3.2–3.3 |
| Sounds | in the app | 4.2 |
| Sponsored and creator Curios | in the app (creator payouts and ad targeting are proposals, not shown) | 4.4 |
| Group rounds and quiz nights | in the app | 2.2–2.4 |
| Make one together | in the app | 4.1 |
| Remix with credit | in the app | 4.3 |

**Left out on purpose:** Group Blend and taste twin (its only number is simulated), lock-screen push (not verified), the Daily (not built), and photos in (no longer needed in scene 5).

## Assets needed

| Asset | Where it is | Status |
|---|---|---|
| Posters #11, #19, #29 (and #3 as backup) | `game-backups/2026-11-12-kevin47-harness-v2/games/<n>/poster.png`, on Karthik's Mac (not on Artem's) | **Needed:** please add them to `docs/pr/video/img/` on `pitch` |
| Mr. Beast Brainrot Trivia poster | `../slides/img/muse-mrbeast-trivia.png` | Have it |
| App screens (feed, challenge, notifications, Capital Clues, Group round, board, best of 5, make together, Tech News, remix, Make) | Simulator captures from `main` | To capture when building the video |
| Narration, one file per scene | Karthik | After his review of draft 2 |
| Music | Original, or a CC BY track from our library | To pick when building |
