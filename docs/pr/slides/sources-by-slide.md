# Sources by slide

*Draft 11 numbering differs; see notes.md. Added 2026-11-13:*

- **Teens chart:** Pew Research Center, Teens, Social Media and AI Chatbots 2025, topline (PI_2025.12.09), "Do you ever use any of the following apps or sites?", US teens 13–17. Facebook 71 (2014-15), 32 (2022), 33 (2023), 32 (2024), 31 (2025); Instagram 52, 62, 59, 61, 63; Snapchat 41, 59, 60, 55, 55; TikTok –, 67, 63, 63, 68; YouTube –, 95, 93, 90, 92.
- **Krillion:** observed on krillion.io, 2026-11-13: Daily Dive #121; "15,362 playing" on its live event banner. Launch July 2026 (Streams Charts / guide pages). No published player count exists.
- **Verifiers:** authoring/verify/README.md, docs/games/FAILURE_CLASSES.md (29 classes, 36 codes), authoring/playtest/bots.mjs (5 bots, 8 profiles, fast win under 15 s), authoring/playtest/score-check.mjs. Results on 45 builds from the Harness Evolution session.
- **Fell short:** Harness Evolution session, 2026-11-13: Muse Image 400 on franchise names (2 of 2), Windowsill Defense 33 blocking, "Wave 1 of 5" at 1.48:1, Muse's art step dropping layout fixes.


*The slides carry no footers (Karthik, 2026-11-13). Each slide's sources and labels are kept here for Q&A and the Devpost.*

- **Slide 1:** Karthik · Kevin · Max · Bayan · Artem
- **Slide 2:** Rituals stick: a 7-day streak makes learners 3.6× likelier to finish a course (Duolingo) [114]. Chats: illustration.
- **Slide 3:** Pew Research Center [54]; Gallup/Meta State of Social Connections [60]; US Census CPS 2023 [63].
- **Slide 4:** LinkedIn [79]; TechCrunch [81]; NBC NY / TODAY 2025-12-29; AP 2026-01-21. Screenshots: NYT Games, krillion.io, 2026-11-13.
- **Slide 5:** © the creators, via Instagram. Views and likes as shown on the Reels. Comments: illustration.
- **Slide 6:** Real screens from the app. Facebook's Instant Games reached 20B+ sessions, and every one was made by a developer [34][35]. Muse removes that bottleneck.
- **Slide 7:** Harness v2 on our server, 2026-11-13: 13 real-Muse builds both ways; checkers on 45 builds.
- **Slide 8:** Same seed for everyone; boards only show Groups you share; everything is opt-in. Blue = competing · violet = collaborating
- **Slide 9:** Real screen from the app (main, 03303ee). Creator payouts [27].
- **Slide 10:** Agent transcripts on Karthik's Mac, 2026-11-11 21:54 to 2026-11-13 06:52 PST (3 lead sessions, 640 subagents and workflow agents; teammates' machines not counted). "Active time" sums the gaps under 5 minutes between an agent's events. "One session alone (estimated)" = the sum of every agent's active time in that task, so it ignores coordination overhead. Tasks: review-merged-surfaces workflow (278 agents, 3.07 h wall, 28.1 h summed), curio-new-games (21 agents, 0.95 h, 7.9 h), together-features (21 agents, 1.72 h, 4.7 h). 80 = cross-session messages received by the two lead sessions. Overall 158.4 agent-hours vs 22.5 h of wall-clock activity. Agents synced through Slack, a shared canvas and CLAUDE.md.
- **Slide 11:** Muse Curios, a new feature in Facebook · made with Muse Spark, Muse Wonder and Muse Image

## Draft 12 additions (slide numbers as of the 26-slide deck)

- **7 (thesis):** restates slides 3–6; Pew topline (71% → 31%) as on slide 4.
- **15 (one request, traced):** Mr. Beast Brainrot Trivia, prompt #2 of Kevin's 32 (harness v2 run 2026-11-12, `game-backups/2026-11-12-kevin47-harness-v2/games/2/`): understanding trivia / tap / Mr. Beast / brainrot; type `multiple_choice_trivia`, tools quiz, timer_bar, score, rounds, question_bank; 3 Muse calls, all muse-wonder-1.0 (draft 76 s, playtest repair 30 s, score review 36 s), 143.4 s; draft 1 blocked `cant_lose` (5 bots 1330–1720, 9–17 s, 5 won); draft 2 passed (320–1390, 20–41 s, 2 lost 3 won); score checks finish, skill_order, idle, spam (max 480), replay, events all pass. Screenshot = that build's poster.png. Catalog size 1,305 types. Greek mythology / Harry Potter rare-answer case: Harness Evolution session.
- **16–17 cases:** Mr. Beast repair and score spread as above.
- **16 (is it playable?):** 5 DEFAULT_BOTS (0.35 / 0.7 / 0.95 / 0.7 seed 2 / 0.7 seed 3), 8 gate profiles, FAST_WIN_SECONDS = 15; speed-read format rejected 3/3 by the gate.
- **17 (does it feel right?):** score-check: skill order, idle not above players, spam bot not beating the median regular, replay determinism, whole numbers; server-side replay for real scores.
- **18 (does it look right?):** verifier on origin/main: frames every 100 ms, motion every 50 ms, 29 failure classes; Windowsill Defense 1.48:1 (33 blocking), Wrath of Zeus "SCOR / E", Fog Over the Bay 1.04:1, Burrito Beat title overflow; 45 builds: unreadable text 178→2, motion 411→34, overlaps 432→136.
- **24 (harness struggles):** prompt 136,944 chars → 105,608–114,465; must-haves 94% (46/49) → 98% (48/49) on 13 builds; Muse Image 400 on franchise names in 2 of 2; art step undoing layout fixes; Wikipedia timeout 4 s → 12 s; parallel lanes 197 s → 161 s.
