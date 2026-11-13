# Video storyboard (draft 1)

*For Karthik's review. Brief: Karthik's 07:49 handoff and his 07:54 follow-up (demo every feature, collaboration first, limitless creativity, flag real screens), plus his 08:18 positioning notes ("a Curio asks so little of you", fun-first). Written 2026-11-13 by Claude (AI agent for Artem). The narration is in [script.md](script.md); claims follow [../narrative.md](../narrative.md), words follow [../STYLE.md](../STYLE.md), and feature status comes from [../demo/FEATURES.md](../demo/FEATURES.md) (`main` at `0249943`).*

**Length:** about 2:35 at a calm reading pace. **Frame:** 1920×1080 (a 9:16 cut for Reels can come from the same scenes later).

## How to read the flags

Every shot has one flag, so Karthik can check it against `main`:

- **APP**: a real screen from the app, captured from the simulator or a phone on `main`, then placed inside a cartoon phone frame. The status word follows FEATURES.md ("in the app").
- **APP, capture first**: a real screen, but we have to record a real run before we can use it (noted per shot).
- **CARTOON**: illustration only. It shows feelings, places and people, never a feature that isn't built.

Nothing on screen claims live multiplayer, lock-screen push, Daily games or a "made by Muse" label on a game Muse didn't build.

## Style

- **Look:** bold ink outlines (`#1C1E21`, about 6 px at 1080p), flat fills, squash-and-stretch on every pop, tap and landing. Rounded, chunky characters with simple dot eyes. No photoreal people, and no likeness of a real person.
- **Palette:** pastel blue → violet. Backgrounds `#E3EDFF` → `#EEE5FF`; accents from the brand gradient `#0866FF` → `#8A3FFC`; cards `#FFFFFF`; ink `#1C1E21`; secondary `#65676B`. Blue marks competing (challenges, boards, best of 5); violet marks collaborating (Group rounds, making together, remix, sounds). **No pink.**
- **Type:** Figtree (in `../slides/fonts/`), 800 for on-screen words.
- **Phones:** one cartoon phone design used everywhere (rounded, thick outline, a slight wobble when tapped). APP screens sit flat inside it, unfiltered, so they read as the real product.
- **Motion vocabulary:** a score "boings" in with squash-and-stretch; a sent Curio flies as a small card with a blue→violet trail; a notification drops in and bounces twice.
- **Sound:** Karthik's narration; an original light music bed (or a CC BY track from our sound library, credited in the end card). No copied recorded songs. Small UI ticks on taps.
- **Build:** SVG scenes in HTML, rendered frame by frame with headless Chrome, then cut to Karthik's audio (the same approach as `../slides/mock/render-clip.sh` and `make-mp4.swift`).

## The cast (all synthetic)

| Who | Scene | Look |
|---|---|---|
| Maya and Jordan, old friends | 1 | Maya: round glasses, big curly hair. Jordan: beanie, freckles |
| Rosa (74) and her grandson Leo (19) | 2 | Rosa: silver bun, cardigan, reading glasses on a chain. Leo: hoodie, headphones round his neck |
| Priya, just moved; Dev, a Group member | 3 | Priya: ponytail, climbing chalk bag. Dev: tall, cap on backwards |
| Harry Potter fans Group | 4 | A crowd of small, varied characters in scarves of different colors (no house crests or film costumes) |
| People with ideas | 5 | Quick cameos, including the cast above |

---

## Scene 0: Cold open (0:00–0:10)

| # | Time | Picture | Flag | Narration (see script) |
|---|---|---|---|---|
| 0.1 | 0:00–0:04 | A table seen from above. A deck of cards slides in and fans out with a squash; hands of different ages reach in from every edge. | CARTOON | "There's no better way to connect than playing a game." |
| 0.2 | 0:04–0:10 | Three quick vignettes pop in as rounded cards: a family around a board game, two strangers laughing at a trivia table, two old friends fist-bumping. Each card then shrinks into a small phone screen. | CARTOON | "It's how families keep up, how strangers break the ice, and how old friends find their way back." |

## Scene 1: Old friends (0:10–0:42) · *challenges, Curios feed, notifications*

**Who it brings closer:** two friends who drifted apart. **Feature:** a challenge ("beat my score"), sent to a friend. **Positioning:** a Curio asks so little of you.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 1.1 | 0:10–0:15 | A photo strip of Maya and Jordan as kids, then teens, then the strip tears. Five calendar pages flutter away. | CARTOON | "Maya and Jordan were best friends. Then life happened." |
| 1.2 | 0:15–0:20 | Maya on her couch, typing "hey, long time…" in a message box. She stares, deletes it letter by letter. The cursor blinks. Her shoulders sag (squash). | CARTOON | "Five years later, 'hey, long time' feels impossible to send." |
| 1.3 | 0:20–0:25 | Maya scrolls Facebook's Curios feed. A card shows Jordan's name and score on a Curio ("Jordan played this"). Her eyebrows pop up. | APP: Curios feed with friends' scores first | "But Jordan's score is right there in her Curios feed." |
| 1.4 | 0:25–0:30 | She plays it: real gameplay inside the cartoon phone. Her score boings in: 44. | APP: a Curio being played, then its result | (music beat) |
| 1.5 | 0:30–0:36 | She taps Challenge, picks Jordan. A small Curio card flies across the screen with a blue trail, carrying "Beat my 44?" Over it, on-screen text: **A Curio asks so little of you.** | APP: the challenge sheet (friends only) | "A Curio asks so little of you. 'Beat my 44?' needs no catch-up, no small talk and no right thing to say." |
| 1.6 | 0:36–0:39 | Jordan, on a bus, opens the app. The challenge is in Notifications. He grins, plays, gets 51. | APP: Notifications, Games section (in-app inbox, *not* the lock screen) | "Jordan gets 51." |
| 1.7 | 0:39–0:42 | Split screen: "51. rematch? 😄" arrives on Maya's side; she laughs and starts typing a long reply. The torn photo strip from 1.1 reseals itself. | CARTOON (the reply bubble is drawn, not a Messenger screen, since Messenger runs on demo data) | "Then: 'rematch?' And they're talking again." |

## Scene 2: Across generations (0:42–1:05) · *Group rounds, same seed*

**Who it brings closer:** a grandparent and a grandchild who live far apart. **Feature:** a Group round: the same Curio and seed for everyone, each in their own time, results lined up in the Group. **Positioning:** "I played this and thought of you."

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 2.1 | 0:42–0:47 | A split screen with a map between them: Rosa at her kitchen table with tea; Leo in a dorm room. Clocks on each side show different times. | CARTOON | "Rosa is 74. Her grandson Leo is 19, and three time zones away." |
| 2.2 | 0:47–0:53 | Rosa finishes a word Curio and shares it to the family Group with a note: "I played this and thought of you, Leo." The Curio card flies across the map with a violet trail. | APP: share a Curio to a Group (Group round) | "She sends him a Curio: 'I played this and thought of you.'" |
| 2.3 | 0:53–0:59 | Leo plays the same Curio that evening. On-screen chip: **same Curio · same seed · your own time**. | APP: the Curio in play | "Same Curio, same seed, each in their own time." |
| 2.4 | 0:59–1:05 | The family Group's round results line up: Rosa on top. Leo flops back on his bed (big squash), then sits up and taps Play again. Rosa sips her tea, smug. | APP: Group round results in the Group | "Their family Group lines up the results. Grandma's won four in a row." |

## Scene 3: Meeting someone new (1:05–1:30) · *weekly Group board, Add friend, best of 5*

**Who it brings closer:** two people who share a Group but haven't met. **Features:** the weekly board, Add friend, best of 5. **Positioning:** no small talk needed.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 3.1 | 1:05–1:10 | Priya surrounded by moving boxes in a new apartment. She joins a climbing Group on her phone; a little "Joined" check boings. | CARTOON, then APP for the Group's join button | "Priya just moved to a new city and joined a climbing Group. She doesn't know anyone yet." |
| 3.2 | 1:10–1:15 | The Group's weekly board. Dev's row sits one spot above hers, with **Add friend** next to it. The camera pushes in on the button. | APP: weekly Group board with Add friend | "But on the Group's weekly board, Dev is one spot above her." |
| 3.3 | 1:15–1:20 | She taps Add friend (the button wobbles and turns to Requested), then "Challenge a friend: best of 5". | APP: Add friend → Requested; best of 5 start | "Add friend. Best of 5." |
| 3.4 | 1:20–1:25 | Two phones side by side, five round dots between them filling blue one by one: 1–0, 1–1, 2–1, 2–2. On-screen chip: **same Curios · same seeds · fair**. | APP: best of 5 rounds (both phones) | "Same Curios, same seeds, so it's fair. No small talk required." |
| 3.5 | 1:25–1:30 | Round 5 lands; both characters jump. Cut to Saturday: Priya and Dev at the climbing wall, Dev pointing at her phone, both laughing. | CARTOON | "By Saturday, they're climbing together." |

## Scene 4: A big Group (1:30–1:50) · *make one together, Group quiz, weekly board, sounds, remix, sponsored*

**Who it brings closer:** a whole Group, including the people who usually just lurk. **Features:** make one together, quiz night, weekly board, sounds, remix with credit, sponsored Curios.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 4.1 | 1:30–1:36 | The Harry Potter fans Group. Little question cards fly in from members ("Which house would a Roomba be in?"), each signed with a name, and stack into a deck. The starter taps Make. | APP: make one together (entries with names, then Make) | "A whole Group can play together. Harry Potter fans add their own questions, and Muse builds one quiz from all of them, every name credited." |
| 4.2 | 1:36–1:41 | Quiz night: a sound waveform pulses behind the Curio; members' results line up in the Group. The weekly board reorders with a bounce. | APP: sound behind a Curio; Group results; weekly board | "Put a sound behind it. Race the weekly board." |
| 4.3 | 1:41–1:45 | Someone taps Remix and types a sentence. A new Curio pops out with a caption crediting the original. | APP: Remix, with the credit caption | "Remix it, with credit." |
| 4.4 | 1:45–1:50 | The feed scrolls past a sponsored Curio card from a brand, then a creator's Curio. | APP: the sponsored Curio card (`../slides/img/app-sponsored.png` is a real capture) | "And brands and creators get a Curio of their own." |

## Scene 5: Limitless creativity (1:50–2:22) · *make with Muse: plan, build, 5-bot check*

**Who it brings closer:** everyone who makes a Curio for someone. **Feature:** make a Curio from one sentence. **Muse plug:** Muse Spark reads the idea, Muse Wonder plans it, Muse Image paints it, five bots play it.

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 5.1 | 1:50–1:54 | A blank Make box on the phone, cursor blinking. The cast from earlier scenes lean in around the phone. | APP: Make with Muse, empty | "And anyone can make one. Just say the idea." |
| 5.2 | 1:54–1:59 | Rosa holds up a photo of a family picnic and types "a story quiz about this photo". It becomes a picture quiz. | APP, capture first: photo → story quiz (needs a signed-in account; record one real run) | "A story quiz from today's photos." |
| 5.3 | 1:59–2:03 | Leo types "brainrot trivia, Mr. Beast as the host". The real Muse-made trivia appears. | APP: Mr. Beast Brainrot Trivia (Muse-made, harness v2; `../slides/img/muse-mrbeast-trivia.png`) | "Mr. Beast-style brainrot trivia." |
| 5.4 | 2:03–2:07 | Priya types "a golden retriever's first day as a waiter". Biscuit's First Day appears. | APP: Biscuit's First Day as a Waiter (Muse-made; `../slides/img/muse-biscuit-waiter.png`) | "A golden retriever's first day as a waiter." |
| 5.5 | 2:07–2:10 | Jordan types "dodge the fog over Twin Peaks". An arcade dodge game appears. | APP, capture first: needs a real Muse build of this prompt (the Demo 1 prompt), or swap in Golden S'more | "Dodge the fog over Twin Peaks." |
| 5.6 | 2:10–2:17 | The pipeline as one cartoon machine. The typed sentence goes in. **Muse Spark** (a lens) highlights the key words; **Muse Wonder** (a blueprint) unfolds the plan, part by part, and a thumb taps "Agree"; **Muse Image** (a brush) paints the scene; then five little bots run through the game and each gets a check. The real Make screen with its bot lanes is shown in a phone beside the machine. | CARTOON machine + APP: Make's plan and build steps with the bot lanes | "Muse Spark reads it. Muse Wonder plans it. Muse Image paints it. And five bots play every game before you do." |
| 5.7 | 2:17–2:22 | Two signs side by side: a grey one, "Feature-first", with a lonely button; a gradient one, "Fun-first", with the whole cast playing around it. The grey sign tips over. | CARTOON | "Other apps are feature-first. Curios are fun-first: the connection comes with the play." |

## Scene 6: Close (2:22–2:35)

| # | Time | Picture | Flag | Narration |
|---|---|---|---|---|
| 6.1 | 2:22–2:27 | The cast's phones zoom out into one shared frame: Maya and Jordan, Rosa and Leo, Priya and Dev, the Group. Each gives a small wave. The words "Muse Curios" draw on in ink and gradient. | CARTOON | "Muse Curios. A new feature in Facebook." |
| 6.2 | 2:27–2:35 | Everything clears to white. The tagline alone, in Figtree 800, center. Small line underneath at the very end: "Muse Curios, a new feature in Facebook · made with Muse Spark, Muse Wonder and Muse Image". | CARTOON (type only) | "When the world is your muse, how will you create the content of tomorrow?" |

---

## Feature coverage

Karthik's list from the 07:54 follow-up, and where each one appears:

| Feature | Status on `main` (FEATURES.md) | Shot |
|---|---|---|
| Curios feed (friends' scores first) | in the app | 1.3 |
| Make with Muse (plan → build, 5-bot check) | in the app | 5.1–5.6 |
| Playing a Curio | in the app | 1.4, 2.3 |
| Group boards (weekly) | in the app | 3.2, 4.2 |
| Challenges | in the app | 1.5–1.6 |
| Best of 5 | in the app | 3.3–3.4 |
| Add friend | in the app | 3.2–3.3 |
| Sounds | in the app | 4.2 |
| Sponsored and creator Curios | in the app (creator payouts and ad targeting are proposals, not shown) | 4.4 |
| Group rounds and quiz nights | in the app | 2.2–2.4, 4.2 |
| Make one together | in the app | 4.1 |
| Remix with credit | in the app | 4.3 |
| Photos in, a story quiz out | in the app (upload needs sign-in) | 5.2 |

**Left out on purpose:** Group Blend and taste twin (its only number is simulated, and the scene would need an explanation), lock-screen push (not verified), the Daily (not built).

## Open questions for Karthik

1. **Length:** about 2:35. Is there a limit for the Devpost video? If it must be under 2:00, scene 4 can shrink to 4.1 and 4.4.
2. **Real screens:** shots 5.2 and 5.5 need real runs recorded first. Is it fine to use Golden S'more in 5.5 instead if the fog build isn't ready?
3. **Scene 4's Group:** the Harry Potter fans Group matches the demo world. Keep it, or use a made-up Group so the cartoon can't be read as franchise art?
4. **Music:** original bed, or a CC BY track from our library, credited?
