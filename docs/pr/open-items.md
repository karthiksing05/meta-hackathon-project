# Open items (internal)

*Internal notes: reconciled numbers, pending decisions, what must land, proposed app fixes and what we still need to prove. Part of the pitch docs; start at [README.md](README.md).*

### 5.5 Open items

**Numbers we reconciled.** Each of these numbers is used the same way, with its label, everywhere in this document.

| Number | What it is | Label |
|---|---|---|
| Hill Drift 58.5 s | The first real end-to-end Muse game, about 08:33 PST on Nov 12, reported in Slack at 08:48: Ember wrote 12 SF hill names, Wonder assembled 15 pieces, 4 bots playtested it | Teammate-reported (not logged) (D11) |
| Hill Drift 25.0 s | A later, logged CLI run of the same sentence at 09:21 PST: Ember brief in 1.1 s, Wonder wrote 8 obstacle labels and composed 14 concepts, a "too easy" draft was repaired, glow look | Measured (D10) |
| Send It 28 s | The level-2 run, Send It 2, logged at 28.4 s. The restyle to pixel took 15.8 s. The first make of Send It was not logged | Measured (D26) |
| Muse time per game | Median 28.0 s, range 15.7 to 40.9 s, over 10 benchmark runs. Replaces "25 to 59 s" and "about a minute" in our notes | Measured (D2) |
| Cover time | Median 20.2 s (9.1 to 34.9 s) while a game is composing, in parallel, adding a median 3.35 s to the total. The "about 11 s alone" in Slack was one standalone call and was not logged | Measured (D3); the 11 s is teammate-reported |
| Runtime tests | Node runner: 318 passed, 0 failed (its main suite prints 310, which is the "310" in Slack). JavaScriptCore runner: 308 passed, 0 failed. Kit tests pass in both engines with 23 fingerprinted runs identical, and 11 of 11 manifests validate. The tracker's 212 and 202 were an earlier count, and the kit runner prints no test count, so "318 kit tests" is dropped | Measured, rerun today at `0a3e8f7` (D17) |
| Score verification | About 4.06 ms of CPU per run in Node. Replaces "about 24 ms" from the Build tracker | Bot-run (D14) |

**Unfinished notes from Karthik (ask him).**

- A Slack note at 10:56 on Nov 12 about the pitch showing specialization breaks off mid-sentence; probably "for Facebook", but that's a guess. Open on Agent Logistics.
- The sketch-input request at 09:55 on Nov 12 also breaks off. Open on Agent Logistics.
- A Brainstorm canvas note about using it as a personal agent (the word is cut off). Does a personal-agent angle belong in the pitch?
- The "What goes into a game?" stack, which Karthik was still working out.
- Brainstorm questions: a campus hook, and finding purpose in the age of AI. In or out?

**Decisions pending.**

- **The name.** "Whims" stays until Karthik picks from brand round 3 (pastel blue to violet, no "blow", maybe a storytelling feel). The Group card still says "Blow a bubble for this group", and the tracker calls Studio "Blow your own"; both conflict with the no-"blow" direction.
- **The one moment judges remember.** Candidates: the Add friend tap on the board, the live Muse build, a rematch landing in the group chat, or the Blend.
- **Story order:** open on wonder (5.2) or on the Group's Daily (Bayan).
- **Whether to mention the AI-agent build story,** since judges score Muse use.
- **What to promise as "what's next"**, including whether Blends appears as a frame in beat 8.
- **Default creator level:** Remix, Compose or Free.
- **Who exactly is the user:** just moved, first job or freshman? The demo assumes someone new in SF.
- **The monetization answer.**

**Must land before the pitch, or drop the claim.**

- Messenger group-chat play and Challenge Me (not wired at `0a3e8f7`).
- Import the real Muse games we demo (First Hellos, Picnic Pals, Hill Drift, Send It); none were in the build at `0a3e8f7`.
- Whims in Facebook Search and "Make it with Muse".
- The collaboration batch: Games in Groups, making games together, Games about me, story games, Learn, quiz night, length settings and the Customize panel.
- The "New" badge, or drop it from beat 9.
- Labeled "Coming" frames for Challenge Me, story games and Blends.
- Rework the tracker's demo around closer together (still open on the tracker).
- An opt-in switch on posts, or a clear answer for how authors opt in.
- The blue-to-purple rebrand in the app (code and BUBBLES.md §2 still show lilac, pink and peach).
- The public README and docs: the README doesn't mention Whims, lists a Marketplace tab and says the code has never been compiled; FEATURE_PARITY.md shows the old tab bar; the BUBBLES.md seed table leaves out This or That: Picnic and Trivia Thursday: SF.
- Confirm the backups exist: offline composer, pre-made real Muse games, the paused seed library.
- Don't claim Muse reads photos: Spark 1.3 is listed for photos, but photo input isn't built.
- Fix or stop citing the seeds' "Made with Muse" stamps and invented times (some dated Nov 10).

**Numbers still to get.**

- Cold start from tapping the tab, and memory: unmeasured. Measure on the demo phone (section 11).
- Usage for ages 18 to 25: we have Pew figures for 18 to 29 [52][53] and for teens [54], nothing narrower.
- The teen chatbot figure (64%) and the teen daily-use figure in our notes: check against Pew's own pages or drop them.
- Flappy Bird figures from the Taxonomy canvas: fact-check or drop.
- The submission deadline: it isn't in the brief.

## 11. What we still need to prove, and quick ways to get the data

| Gap | Why it matters | Quick way to close it before the demo |
|---|---|---|
| What Facebook context adds (context ablation) | Our "why Facebook" thesis says the value is the context; D7 only compares against a template | Run Muse twice on the same sentences: once with the Group, Event and member context, once with none. People rate the pairs blind on "mentions real members or facts", "would you play this with this Group" and "would you add someone after playing". About an hour |
| Muse relevance judged by people, not one agent | Our AI-essential claim (D7) | Blind rating: 4 teammates rate the 10 Muse and 10 offline games as on-topic or not, order shuffled (about 20 minutes) |
| Game against text icebreaker | Answers "why a game at all?" | Hallway test with three arms: play the icebreaker; read an AI-written "meet who's coming" summary; read the plain guest list. Then ask each tester to name 3 guests, and ask whether they'd add one |
| How long people take, and whether they finish | Bot timings are a proxy (D15) | Hallway test: 5 to 10 people play the Daily and the icebreaker on a team iPhone; record time and completion |
| Daily generation in the normal UI | VP-01 and VP-18 are Debug/CLI only today | Wire Studio's daily mode into the Group page for admins, so the core thesis is Live |
| Phone performance and memory | Simulator only, teammate-reported (D18) | Measure warm switch, fps and memory on a team iPhone with Instruments, and save the log |
| Perceived wait | The game is ready at 21.0 s but shown at 28.0 s (D3) | Let people play once the game passes its checks, and fade the cover in later |
| Repairs on Group Dailies | Both logged Dailies needed a repair for the same rule (D5, D10) | Teach Wonder the one-flow rule in the daily prompt; saves about 12 s |
| Cost per game | No input-token counts (D9) | Log input tokens in the CLI and rerun the 10-prompt bench |
| Opt-in, moderation and anti-abuse | Named gaps (VP-21, section 5.4) | Add a composer toggle, a basic content check and "remove me"; until then, say "not built" |
| Venue network | Latency was measured on one network | Rerun 3 prompts on the venue Wi-Fi; keep a recorded backup run |
| Unverified sources | Some claims rest on secondary press | Check the Business Insider original on Pocket [44] and confirm Muse Ember on a Meta page [29], or cut them. Check whether the FY2025 10-K keeps the young-adult and "particularly younger users" sentences [12]. Verify events in WhatsApp Communities. Check whether "friend bubbles" is already a Facebook Reels feature name before settling the product name |
| Real usage | Every "Helps people" rating in section 4 | The pilot in section 9; none can be measured before the demo |
