# Demo plan

*The 5-minute pitch with three live demos, presented from Karthik's Mac in Keynote, with Karthik's iPhone shown through Live Video. Slide timing and the spoken lines are in [../slides/notes.md](../slides/notes.md). Claims follow [../narrative.md](../narrative.md). Q&A prep is in [../08-qa.md](../08-qa.md). Written 2026-11-13 by Claude (AI agent for Karthik).*

## The shape

| When | Slide | On the phone | Seconds |
|---|---|---|---|
| 0:00 | Curio (definition) | **Demo 1 starts.** Type the idea and tap Make. Agree the plan when it appears. | about 15, while talking |
| … | Intro slides | Demo 1 builds in the background. Don't touch the phone. | — |
| after the stack slide | Empty Live Video slide | **Demo 1 payoff:** the finished Curio. Play it for about 10 s, then post it to Harry Potter fans. | 40 |
| on the ranking / stack slide | — | **Demo 2:** scroll the Curios feed. A Curio plays inline with its sound. Search for something that doesn't exist, and "Make it with Muse" appears. | 25 |
| on the collaboration slide | — | **Demo 3:** Harry Potter fans' weekly board (Max, Bayan, Artem, Kevin) → tap Add friend on someone you don't know → start a best of 5. | 30 |
| end | Tagline | Phone down. Pause on the tagline. | — |

Total demo time is 95 s. The talk has to fit in the rest, so stay at or under 4:45 to leave slack.

## The path: Karthik and his friends *(seeding on Prod in progress; names and ids to come)*

The demo runs as Karthik. His close friends are Max, Bayan, Artem and Kevin, and the five of them share two Groups: **Harry Potter fans** and **Tech News**. About 150 synthetic users fill out the rest of Facebook with plays, likes, comments and scores. Every beat goes through these people, so "closer together" is something the judges watch happen, not a claim.

| Beat | Where | What the judges see |
|---|---|---|
| Demo 1 payoff | Make → post to **Harry Potter fans** | Karthik's new Curio lands in a Group his friends are in |
| Demo 2 | Curios feed | Friends' Curios and their scores first ("Max beat this"), then a Curio with a sound |
| Demo 2, end | **Tech News** | The GPU-conference Curio, with friends' scores on its board |
| Demo 3 | **Harry Potter fans** weekly board | Friends ranked together, plus a member Karthik doesn't know yet → Add friend → best of 5, or a Group challenge to the friends |

**Say it as it is:** the people around the five of us are synthetic demo accounts. Never quote their plays, likes or scores as real engagement.

## Demo 1: make a Curio live

**Option A (default): one sentence.**
1. Curios tab → Make.
2. Type: *"dodge the fog over Twin Peaks"*. If it gets rehearsed in time, use the story-quiz idea from option B instead.
3. Tap Make. When Muse shows how the game will work, part by part, tap to agree. That starts the build. Planning takes about 30–60 s, then the build about a minute.
4. Go back to the slides. It should be ready at about 1:50.

**Option B (only after one timed dry run on this phone): a story quiz from our own photo.**
This turns the Reel format from the intro into a Curio, live.
1. Signed in as `karthik_s` (uploads need an account; guests can't upload).
2. Curios tab → Make → under the prompt, **Add photos or video** → pick a team or venue photo taken that morning.
3. Optional: **Restyle my photos into the game's look**.
4. Type: *"a Kahoot-style story quiz about this photo"* → Make → agree the plan.
5. Builds with media take noticeably longer. Use option B only if the dry run finished inside 1:50.

**Fallback.** That morning, on this phone and account, make the option A game once and post it to Harry Potter fans. If the live build isn't done at the payoff, say *"it's still being played by the bots, so here's one I made this morning"* and open that one. Come back to the live one at the end if there's time. Never use a hand-made Curio as the fallback: The Podium, Purr Earth, First Things First and One Move were made by hand, so they can't be called made by Muse.

## Demo 2: play shapes the feed

1. Curios tab → scroll two or three Curios. Let one play inline with its sound.
2. Say: *"what I play, finish and replay, who I rematch and who I add, all shape what I see next."*
3. Search for something that doesn't exist yet → **Make it with Muse**.
4. If the feed stutters, swipe again. The posters still make the feed look alive.

Don't show any ranking numbers on the phone. The 70.3% on the slide is simulated, and we say so.

## Demo 3: meet on the board

1. Open Harry Potter fans → its weekly board. Max, Bayan, Artem and Kevin are on it with Karthik.
2. Point to a row for someone you aren't friends with yet: *"same Curio, same seed, so the board is fair."*
3. **Add friend** → the row changes to Requested.
4. Start a **best of 5** with them.
5. If someone asks: challenges to friends and Groups, quiz nights, making one together and remix are on the server, and the app screens are next. Say it plainly.

## Pre-show checklist (the morning of the pitch)

1. The phone runs the latest build, with "Muse Curios" as the feature name. Play through once after installing.
2. Signed in as Karthik (`karthik_s`, or the seeded account if it differs), a member of both Groups: Harry Potter fans and Tech News.
3. Make the Demo 1 fallback and post it to Harry Potter fans.
4. Harry Potter fans' weekly board shows Max, Bayan, Artem and Kevin, plus at least one member who isn't Karthik's friend yet, near his row. Don't add them during rehearsal, or reset afterwards.
4b. Tech News has the GPU-conference Curio pinned or near the top, with friends' scores on its board.
5. The feed has a Curio with a sound behind it.
6. If option B is on: one timed dry run on this phone, with the time written down. Only keep B if it finished inside 1:50.
7. Phone: awake, Do Not Disturb on, brightness up, sound on, cable to the Mac. Keynote Live Video is added on each demo slide and shows the phone.
8. Mac: Figtree installed, Keynote open on the final file, the presenter display on, notifications off.
9. Network: test the venue Wi-Fi with one Make. Keep a phone hotspot ready.

## Rehearsal plan

1. Two full timed run-throughs with the phone, on Keynote. Note where it runs long and trim talk, never the demos.
2. One run where Demo 1 is "late" on purpose, to practise the fallback line.
3. One run with the Q&A questions in [../08-qa.md](../08-qa.md), each answered in 20 s or less.

## Who does what *(proposal; Karthik's call)*

| Person | During the 5 minutes | In Q&A |
|---|---|---|
| Karthik | Presents and drives the phone | Product, the story, the front end |
| Artem | Watches the clock; gives Karthik a signal at 2:00 and 4:30 | The engine, integration, sounds |
| Max | Watches the live build on the server; says "fallback" if it fails | Backend, harness on the server, verified scores |
| Kevin | Holds a second phone with the fallback Curio open | Ranking, Group Blend, notifications |
| Bayan | Follows the slides for anything that breaks | The research and the sources |

## Facts to keep straight on stage

- "About a minute after you agree the plan", not "a minute". Planning comes first.
- "Simulated" with every ranking or Group Blend number.
- Group play is async: same seed, everyone in their own time. Never say "live" multiplayer.
- The app is Facebook. Muse Curios is a feature inside it.
- Hand-made Curios are "the story-quiz format", never "made by Muse".
