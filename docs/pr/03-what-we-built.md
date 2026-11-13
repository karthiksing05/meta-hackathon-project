# What we built

*What a person does with Whims, step by step, and the terms a judge may not know. Part of the pitch docs; start at [README.md](README.md).*

### Our solution

What a person does, step by step:

1. **Make.** Type one sentence in Muse Studio, for example "a chill game for my new running club about SF hills". Or do nothing: a Group gets a Daily Bubble and an Event gets an icebreaker.
2. **Check the brief.** Muse reads the sentence back as a short brief ("chill and social, for your new running club in San Francisco"). Edit it if it's wrong.
3. **Wait about half a minute.** Muse builds the game, tests it with bots and paints its cover, in a median of 28 seconds in our benchmark (D2).
4. **Play together.** Everyone in the Group, the Event or the chat gets the same game on the same seed, so scores are fair and can be checked.
5. **Meet.** Your score lands on the Bubble Board next to the names of people you don't know yet. Watch the replay of the person above you, then tap Add friend.
6. **Share and come back.** Float "I got 42. Beat it?" to the Group, the feed or your Story. Tomorrow there is a new Daily.

What Muse does that could not be done without it:

- **It makes a game about these people, not a template.** Muse turned 7 of 7 picnic guests' opted-in intros into an icebreaker that pairs each name with facts from that person's intro, and 5 of 5 opted-in Group posts into a Daily (D8). Our keyword template, given the same 10 prompts, made only 2 on-topic games; Muse made 10 of 10 on-topic (D7).
- **It does the whole build.** Ember writes the brief, Wonder composes the game from 55 tested building blocks with tool calls and writes its content, Wonder repairs drafts that fail bot testing, and Muse Image paints the cover (D1, D5).
- **It makes making cheap enough for everyone.** A game a day for every Group, or one for each Event, is only possible when nobody has to write it by hand.

### Terms a judge may not know

| Term | Meaning |
|---|---|
| Bubble | One tiny game, described by a small JSON file (a manifest). |
| Formula | A game type the runtime knows how to run. Six ship today: dodge, timing, merge, guess, sort and answer. A seventh, "make" (create something, then friends judge it), is designed but not in the runtime. |
| Concept and kit | Concepts are the 55 tested building blocks a game is assembled from (for example a daily gate, a seeded deck, a scoring rule). A kit is the code that runs one formula's concepts. Muse composes games from these blocks rather than writing free-form code, which is why its games validate. |
| Look | One of 8 visual styles (glow, paper, pixel, neon, ink, clay, riso, chalk) that Muse picks per game. |
| Seed plus input log | Every run starts from a random seed and records the player's inputs with timestamps. Replaying the same inputs on the same seed reproduces the exact score. That makes scores checkable and lets two people play the identical game. |
| Burst | A short replay of a real run, rendered from its input log (not a video). Tap it to "take over" and play the same game yourself. |
| Daily Bubble | One game per Group per day, the same for every member, with one scored run each. |
| Bubble Board | A leaderboard with Group, Friends and Everyone scopes. Rows for people you are not friends with have an Add friend button. |
| Float | Sharing your result (with its Burst) to your feed or a Group: "I got 42. Beat it?" |
| Muse Studio | The maker tool: one sentence in, a validated, bot-tested game with a cover out. |
