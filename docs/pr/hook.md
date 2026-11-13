# Hook

*Options for the first 15 to 30 seconds of the pitch, before the story "Facebook isn't attractive to young adults" begins. Part of the pitch docs; start at [README.md](README.md).*

The story spine is in [01-story.md](01-story.md) and the timed script in [07-demo-script.md](07-demo-script.md). Whatever hook we pick, it has to end by 0:25, and the presenter should have typed the Studio sentence and tapped Make by about 0:20, so the build runs during the "why" (see the script). Karthik wants to try all kinds of things, so this file lists 12 options: his two first, then ten more. Option 12 was added after his note "Need to market the collaborative aspect of the app!", and it is now the recommended pick.

**What is real in the app for these openings** (commit `6b1cc85`):

- The app's **Notifications tab** has Whims entries: "Today's Daily Whim in New in SF is ready. Play before the fog lifts.", "Diego beat your score in Hill Hopper. Take it back?", "You passed Maya in Fog Words." They are synthetic and already in the list when the app opens. **There is no real iOS push notification or lock-screen banner**: nothing in the app sends one. Any buzzing-phone moment is staged.
- **Group chats** "New in SF crew" and "Picnic planners" exist with synthetic friends, and Challenge Me cards land in them, with the friend's score arriving 2 to 6 s later as a bot run.
- **Sound** is on by default, with synthesized cues for ready, publish and a new best.
- **Studio** makes games from a sentence with real Muse (median 28 s for a ready formula, 99 s from scratch).
- **Creator-inspired games and studio accounts** are planned, not built. Muse's prompt currently bans real people, so a live "MrBeast" request may come back without the name.

---

## 1. Fantastical opening: a sentence becomes a world (Karthik)

**Logline.** Someone opens a laptop, types one sentence, and the world around them turns into the game.

**Script (25 s).**
- 0:00. Dark stage. A presenter sits with a laptop; the big screen shows only the laptop's text box.
- 0:03. They type, slowly enough to read: "a bouncy pinball game about fog over the bay".
- 0:08. They press Enter. On the big screen, fog rolls out of the text box and across the screen; the room lights shift to blue and violet; a pinball and flippers draw themselves; the Bay Bridge appears in the fog. (A pre-made video.)
- 0:16. The pinball drops; the video cuts to the real game on the demo phone, mirrored, being played.
- 0:20. Presenter: "One sentence, and Muse made a world. So why does nobody our age open the app it lives in?"

**What it needs.** A 15-second video or projection (made by us, using the real game's art), a laptop, the mirrored demo phone, and lighting control if the venue has it.

**Rubric.** Originality and Cohesion (20%) first; it also sets up AI Integration (30%) by showing "a sentence becomes a game".

**Risk and fallback.** The video can feel like a trailer for something we didn't build, which hurts Execution ("no unnecessary mockups"). Keep it short, then cut straight to the real game so the judges see the actual output. Fallback: skip the video and type the sentence live with the mirrored phone.

**Hand-off.** "So why does nobody our age open the app it lives in?" leads straight into step 1 of the spine.

## 2. Notification opening: the product's own pull (Karthik)

**Logline.** A phone buzzes: "Maya just beat your score in New in SF." The presenter opens it, and the demo has started.

**Script (20 s).**
- 0:00. The presenter is mid-sentence ("Thanks for having us. We're...") when their phone buzzes loudly.
- 0:03. They glance at it, then show it to the room on the mirror: "Maya just beat your score in New in SF."
- 0:06. "Sorry, I have to take this." They tap. The Notifications tab opens: "You passed Maya in Fog Words." "Diego beat your score in Hill Hopper. Take it back?" They tap through to the game, and its first second plays.
- 0:14. "That's the first time Facebook has made me *want* to open it in years. Let me explain why."

**What it needs.** The demo phone on the Notifications tab (live, synthetic entries). The buzz and banner are **staged**: a second team phone sends a message or a timer goes off at 0:00 so the demo phone vibrates, and the "banner" the room sees is the in-app Notifications tab, not a real push. Say nothing that claims Whims sends push notifications.

**Rubric.** Product Thinking and User Impact (25%): the reason to come back is shown, not claimed. Also cohesion: it opens on a friend, not on a feature.

**Risk and fallback.** A judge may ask "do you send push notifications?": answer that the in-app notifications exist and a real push is not built. If the buzz misfires, the presenter opens the Notifications tab anyway: "this is what greeted me this morning".

**Hand-off.** "...made me *want* to open it" is the exact opposite of the hook's claim, so step 1 starts naturally: "Because right now, almost nobody our age does."

## 3. A judge names a game, and it gets built

**Logline.** "Name any game. Any." A judge says it, and Muse starts building it before we've said who we are.

**Script (25 s).**
- 0:00. Presenter walks to the judges with the demo phone: "Before we say anything: name a game you'd want to play with your friends. Anything."
- 0:05. A judge answers. The presenter types it, reads the "How the game works" card aloud ("Muse understood 11 parts; 2 are new to it"), taps Make.
- 0:18. "That's building now. You'll play it in three minutes. While it builds, here's why we made this."

**What it needs.** The live app with real Muse and good network. A trusted fallback phrase if the judge freezes ("a pinball game about fog over the bay").

**Rubric.** AI Integration (30%) and Execution (25%): a real, unscripted Muse run in front of the judges.

**Risk and fallback.** The judge asks for something calm or puzzle-like, which the gate blocks today (D32), or a real person's name, which the prompt bans. The anatomy card will flag what's new to Muse, which is still a good moment. If the build fails, Studio offers "make it with a ready formula" (median 28 s). It also uses up the judge moment we planned for beat 6; pick one.

**Hand-off.** "While it builds, here's why we made this" leads into the hook story.

## 4. Cold open on the problem: two feeds

**Logline.** Two phones side by side: a dead Facebook feed and a busy chat with your friends.

**Script (20 s).**
- 0:00. Big screen, split in two. Left: a Facebook home feed with a birthday reminder and an ad, last friend post 3 weeks ago. Right: a busy group chat, 214 unread.
- 0:06. Silence for two seconds.
- 0:08. "Left is where our Groups and Events live. Right is where our friends are. We think Whims can move the right side onto the left."

**What it needs.** Two screenshots or two phones. The left can be the clone with a quiet account; the right must be **our own mock**, with no real app's logo or branding, and synthetic names.

**Rubric.** Product Thinking (25%): the problem is shown in two seconds.

**Risk and fallback.** Showing a real rival's interface (for example Instagram's) risks looking like a brand imitation; use an unbranded chat. It can also read as "Facebook is dead" in front of Meta judges: say it with affection. Fallback: one slide with the two numbers, 69% and 79% [52].

**Hand-off.** It *is* step 1 of the spine; go straight to the personal "why".

## 5. The creator moment: "What game would MrBeast make?"

**Logline.** Ask the room what game a famous creator would make, and show the answer.

**Script (25 s).**
- 0:00. "Quick question. If MrBeast made a game, what would it be?" Pause for answers.
- 0:06. Slide: "Last One Standing. 100 players, one tap a round, half are out each round." A short animatic of the elimination.
- 0:14. "Now imagine his whole audience playing it together, inside a Facebook Group. That's what we want to bring back to Facebook: everyone, together."

**What it needs.** A slide and a short animatic. **The creator games are planned, not built**: label it "A Whim inspired by MrBeast (planned)", never as his post. Do not try it live: Muse's prompt bans real people today.

**Rubric.** Originality (20%) and the "way back" story (Product, 25%).

**Risk and fallback.** Using a real creator's name and likeness raises legal and judge questions (see [08-qa.md](08-qa.md#creators-names-and-likeness)). It also leads with a planned feature, which costs Execution points. Fallback: a fictional creator archetype ("a stunt YouTuber").

**Hand-off.** "Bring back everyone, together" is spine step 3, so this hook works best if the pitch then circles back to step 1: "Here's why that matters."

## 6. The stat hook: 44%

**Logline.** One number on a black screen.

**Script (15 s).**
- 0:00. Black screen, white text: "44%".
- 0:03. "In one year, 44% of Facebook users our age deleted the app from their phone." (Pew, 2018 [132])
- 0:09. "We built something to give them a reason to put it back."

**What it needs.** One slide.

**Rubric.** Product Thinking (25%).

**Risk and fallback.** The figure is from 2018, the Cambridge Analytica year; a judge may call it dated. Say the year out loud. Fallback number: "Facebook is the third app for 18-to-29-year-olds, behind YouTube and Instagram" (2026 [52]).

**Hand-off.** Straight into the personal "why": "We're three of those people."

## 7. The group-chat screenshot

**Logline.** "We should hang out!!" Six weeks of silence. Then a challenge card lands.

**Script (25 s).**
- 0:00. The mirrored phone shows the "New in SF crew" chat. Scroll up to an old message: "we should all hang out sometime!!", with no replies.
- 0:07. "Every group chat has this message."
- 0:10. The presenter sends Challenge Me from a Whim into the chat. The card appears; 3 s later "Maya played: 41". "Beat Maya's 41."
- 0:18. "This one got a reply in three seconds. Here's why we built it."

**What it needs.** The live app. The chat and Maya are synthetic, and her score is a bot run on the same seed. The "we should hang out" message would need to be added to the demo chat (not there today), or shown as a slide first.

**Rubric.** Product (25%) and the closer-together priority.

**Risk and fallback.** "Maya replied in 3 seconds" is a bot; say "a demo friend". If the card is slow, narrate it. Fallback: a static screenshot of the chat with the card.

**Hand-off.** "Here's why we built it" leads into "our friends are all on Instagram".

## 8. Two strangers at a picnic

**Logline.** A 20-second story of two people who met because of a leaderboard.

**Script (25 s).**
- 0:00. Slide: a hand-drawn picnic blanket in Dolores Park, two names, Alex and Maya.
- 0:03. "Alex moved to San Francisco two weeks ago and knew nobody. Maya had been there three weeks. They were in the same Facebook Group and had never spoken."
- 0:12. "On Thursday they played the same game. Maya beat Alex by three points. On Saturday, at the Group's picnic, Alex walked up and said: 'You're the 44.'"
- 0:20. "That's a story. Here's why it doesn't happen today."

**What it needs.** One illustration (ours, original), no video.

**Rubric.** Product (25%) and Originality and Cohesion (20%): one relationship through the whole pitch.

**Risk and fallback.** It is fiction; say "imagine" or "this is the story we want to make true", never imply it happened. Fallback: tell it without the slide.

**Hand-off.** "Here's why it doesn't happen today" is the hook, and Alex and Maya carry through beat 5 of the script.

## 9. Sound first, in the dark

**Logline.** Lights down. You hear a game before you see one.

**Script (20 s).**
- 0:00. Lights down (or the big screen goes black). From the speakers: the pop of a run, a rising "new best" chime, a friend's "your move" (the app's synthesized cues).
- 0:08. The mirrored phone lights up: a Whim mid-run, the score counting up.
- 0:12. "That sound used to be what Facebook felt like on a Friday night: your friends, playing something together. It doesn't anymore."

**What it needs.** Venue audio through the phone or laptop, and the app's own sounds (sound is on by default; the silent-switch fix still has to be confirmed by ear on a phone). Lighting control helps but isn't required.

**Rubric.** Execution and Demo (25%): polish and craft.

**Risk and fallback.** Venue audio fails, or the room is noisy. Fallback: go straight to the lit phone. The FarmVille-era nostalgia line may not land with younger judges; cut it if so.

**Hand-off.** "It doesn't anymore" is the hook.

## 10. The rewind: "Six weeks ago, these two hadn't met"

**Logline.** Start at the end: two friends at a rematch. Then rewind.

**Script (25 s).**
- 0:00. Mirrored phone: a head-to-head result, "You vs Maya: 3-2 this week" on Maya's profile (the Challenge rivalry view, live, synthetic).
- 0:06. "Alex and Maya play every night. Six weeks ago, they hadn't met."
- 0:10. Rewind effect on the slide: the score count runs backwards, the board empties, a blank Group page.
- 0:16. "Six weeks ago, Alex had just moved and Facebook gave them nothing to do. Let's go back."

**What it needs.** The live app (the rivalry view is in the app) and a short rewind animation (ours).

**Rubric.** Cohesion (20%) and Product (25%).

**Risk and fallback.** "Six weeks" is a story, not data; the rivalry history is synthetic. Fallback: tell it over a still screenshot.

**Hand-off.** "Let's go back" lands on the hook.

## 11. A show of hands

**Logline.** Ask the room, and let the answer be the hook.

**Script (15 s).**
- 0:00. "Hands up if you opened Instagram today." (Most hands.) "Keep them up if you opened Facebook." (Fewer.) "Keep them up if you opened Facebook to do something *with* a friend." (Almost none.)
- 0:10. "That last group is who we built this for."

**What it needs.** Nothing but a cooperative room.

**Rubric.** Product (25%).

**Risk and fallback.** A room of Meta judges may keep their hands up out of loyalty, which flips the joke. Fallback line: "...and the people *our age* in your life?" Keep it light.

**Hand-off.** "Who we built this for" into step 2, the personal "why".

## 12. Three friends, one game (collaborative)

**Logline.** A group chat makes a game together in 25 seconds, and the hook is who's in the credits.

**Script (25 s).**
- 0:00. The mirrored phone shows the "New in SF crew" chat. The presenter: "Every group chat says 'we should do something'. Watch this one do it."
- 0:04. They start **Make it together** in the chat: "Our game: you're a cable car." Contributions arrive from the chat, each with an avatar: Maya adds "dodge the fog banks", Diego "sourdough is a power-up", Priya "night shift mode after 30 s".
- 0:14. Muse stitches them. The card reads "Made by Maya, Diego, Priya and you". Everyone in the chat plays it on the same seed; "2 of 4 played".
- 0:20. "Four people made that together in under half a minute, inside Facebook. Funny thing: none of us our age would have opened Facebook to do it. Here's why."

**What it needs.** The live app on one device: Make it together and the chat are in the app. **The friends' contributions are canned lines from demo people** (`TogetherCopy.cannedContributions`) arriving in the chat, not real people on other phones, and the stitched build takes as long as a Muse build does, so pre-make the stitched game, show the contributions arriving live, and cut to the finished card. Say "demo friends" if asked.

**Rubric.** Originality and Cohesion (20%) and Product (25%): collaboration is the product, shown first. It also previews the AI (Muse stitching four people's ideas).

**Risk and fallback.** Contributions arrive with short delays; a stitched build can take a minute or more, so don't wait for it live. A judge may ask whether the friends are real: they are demo people, and cross-phone play is not built yet. Fallback: a screenshot sequence of the chat and the credits card.

**Hand-off.** "None of us would have opened Facebook to do it. Here's why" is spine step 1. It also sets up beat 4 of the script (the Make it together game in the feed).

---

## Comparison

| # | Opening | Time | Needs | Main criterion | Risk | Anything staged? |
|---|---|---|---|---|---|---|
| 1 | Fantastical: a sentence becomes a world | 25 s | Video, laptop, lights | Originality | Reads as a trailer | Video |
| 2 | Notification buzz | 20 s | Live app, second phone or timer | Product | Push question | The buzz; the banner is the in-app tab |
| 3 | A judge names a game | 25 s | Live app, network | AI, Execution | Gate blocks the idea; uses up the beat-6 moment | No |
| 4 | Two feeds | 20 s | Two screens, our own mock chat | Product | Brand imitation; "Facebook is dead" tone | The right-hand chat |
| 5 | What game would MrBeast make? | 25 s | Slide, animatic | Originality | Leads with a planned feature; likeness questions | Fully (planned) |
| 6 | 44% | 15 s | One slide | Product | 2018 figure | No |
| 7 | Group-chat screenshot | 25 s | Live app | Product | Bot reply | The old chat message |
| 8 | Two strangers at a picnic | 25 s | One illustration | Product, Cohesion | Fiction | It is a story |
| 9 | Sound first, in the dark | 20 s | Venue audio | Execution | Audio fails | No |
| 10 | The rewind | 25 s | Live app, animation | Cohesion | Synthetic history | Animation |
| 11 | Show of hands | 15 s | A willing room | Product | Loyal judges | No |
| 12 | Three friends, one game | 25 s | Live app; a pre-made stitched game | Cohesion, Product (collaboration) | Build time; canned friends | Friends' contributions are canned demo lines; the stitched game is pre-made |

## Recommendation

**Pick: 12, three friends, one game, with the notification buzz from 2 as an optional 3-second pre-roll** (Maya's message is what pulls the presenter into the chat). Karthik's note says the collaborative side is what we most need to market, and 12 shows it in the first seconds: four people making one game together inside Facebook, with every name in the credits. It runs on the real app, leads straight into the hook ("none of us would have opened Facebook to do it"), and previews the AI without spending the judge moment in beat 6. Be honest that the friends are demo people.

**Runner-up: 2, the notification opening, told with Alex and Maya from 8.** Lower risk (no build at all), and still about a friend: it shows the product pulling someone back to Facebook in five seconds. Use it if the Make it together flow isn't solid on the phone build.

**Also worth rehearsing:** 3 (a judge names a game) if the venue network is proven on the day, then cut beat 6's hand-off; 9 (sound first) as a 5-second pre-roll; 6 (44%) as the one-line fallback if anything breaks at the start.
