# Why Facebook is needed

*Why only Facebook has what Whims needs, and how it compares with the alternatives. Part of the pitch docs; start at [README.md](README.md).*

## 3. The short answer: why Facebook

### 3.1 Why Facebook: only Facebook has these objects

1. **The content only exists on Facebook.** A Group's posts and an Event's RSVP list are Facebook objects.
   - Muse used 7 of 7 attendees' opted-in posts to make a picnic icebreaker, and 5 of 5 opted-in Group posts to make a Group's Daily (D8).
   - The Daily's answers were each tied to a member's intro, for example "BERLIN: Lena arrived from here just last week" and "AUSTIN: Maya moved from here three weeks ago for a lab job" (D8).
   - No rival with a standing community also has everyday names, Events with guest lists and feed distribution (section 7).
2. **Groups and Events are the moat for a newcomer.** Someone new in a city has few or no local friends, so friend-graph features (the Friends board, mutual friends) do little for her at first. Mutual-friend counts in our demo are synthetic placeholders; for a real newcomer we expect them to be near zero (estimate). That is why the Group board and the Event icebreaker come first: they give her a shared, chosen context with people she doesn't know yet.
   - Almost 1.8 billion people use Facebook Groups every month, across 25 million monthly active public groups (2024) [14].
   - Meta's own 2024 guide for people in their 20s points movers to "thousands of Facebook Groups that can help you meet new people in your city" [15].
   - Meta tested a Local tab pulling together Marketplace, Groups and Events in 10 US cities, including San Francisco (2024) [14].
   - Older figures show the scale but are likely stale: more than 70 million people helped run Groups (2020, latest public figure) [16], and more than 700 million people used Events monthly (2017, latest public figure) [17].
3. **The strongest identity baseline among major social networks.** Facebook asks people to use "the name that your friends call you in everyday life" [30], and opt-in Facebook Verified badges launched on Profiles and Groups in July 2026 [21]. That is a norm, not a guarantee: Meta estimated that in Q4 2024 "less than 3% of our worldwide DAP consisted solely of violating accounts" (bots and spam among them; family-wide, not Facebook alone) [12]. Bubbles adds its own layers: board rows only appear for people in a Group or Event you both joined, and contact goes through Facebook's normal friend-request flow (VP-07).
4. **The friend graph is the moat for the second persona.** The mover's hometown and college friends are already on Facebook. Keeping in touch with a community you used to live in is a known benefit of Facebook ("maintained social capital") [71], and same-seed challenges give those friends a reason to reach out (VP-14).
5. **Young adults are already there, and newcomers' life moments live here.**
   - 69% of US adults aged 18 to 29 use Facebook (Pew, 2026) [52], and 49% of all 18-to-29-year-olds use it daily (Pew, Feb to Mar 2025) [53].
   - Meta reported more than 40 million young-adult daily users in the US and Canada in 2024 [13].
   - Meta says young adults arrive at life moments, "moving, going to college, getting their first job or apartment" [13]. One in three young adults on Facebook in the US uses Marketplace daily (2026) [22].
6. **Distribution in one app.** Bubbles runs on 6 distribution surfaces (feed, Stories, Reels and Video, Groups, Events, profiles) plus 3 entry points (the Bubbles tab, Notifications and the Library in the Menu) (D19). A Wordle grid had to leave the game for Twitter; a Burst lands where friends can tap and play.

### 3.2 Why Meta can build it: strategy and models

These reasons apply to any Meta app, not only Facebook. They explain why Meta would fund this, not why Facebook is the home.

- **First-party models.** Muse is Meta's model family, and a Group's game is made without its data leaving Meta, which matches Meta's own "Zero Permissions" standard for games [32].
- **It is Meta's stated strategy.** On the Q4 2025 call, Zuckerberg described this loop: create a game "easily through a prompt" and "share that with people who they care about and you see it in your feed and you can jump right into it" [1]. Meta says Muse Spark makes "mini-games straight from a prompt" you can "share ... with friends", and that Muse is coming to "places like search bars, group chats, posts, and more" [2].
- **Meta has the pieces but not the social layer.** Per Business Insider (as reported by Digital Trends), Pocket has no direct messages and Meta has no plans to integrate it with its other apps [44] (secondary source). Horizon Create puts creator games in feeds [42]. None of them puts a game inside a Group, an Event or a chat (VP-28).
- **A lesson from Facebook's games history, not an advantage.** FarmVille reached 32 million daily players through the graph [38], then lost players when Facebook limited spammy notifications [39]. Instant Games reached 20 billion sessions [34] but needed studios. Bubbles keeps the graph and drops the spam and the studio bottleneck (VP-29).

### 3.3 Why Facebook, not Instagram

This is the first question a Meta director will ask. Instagram is Meta's too, reaches more US 18-to-29-year-olds (79% against 69% [52]), and has DMs, Stories, Reels and Meta's in-chat games work [116].

**What Instagram lacks are the objects a newcomer needs.**

- Groups with membership and posts are what the Daily is made from and what the board is scoped to.
- Events with RSVP lists are what the icebreaker is made from.
- Marketplace and the local layer are on Facebook: one in three US young adults on Facebook uses Marketplace daily [22], and Meta tested the Local tab on Facebook [14].
- Meta's stated plans for young adults and "OG Facebook" are about Facebook [7][12][13].

A game about "who's coming Saturday" needs an Event, and a Daily about "our Group" needs a Group. Instagram has neither.

**Instagram is a channel, not a rival.** We propose that Bursts can be shared to Instagram Stories and challenges sent into WhatsApp chats (proposal, not built). The family of apps then becomes the distribution channel, and Facebook is the home because the community lives there.

**Does this pull usage from Instagram?** We expect it to be complementary, not a substitute. The sessions Bubbles adds start from a Group or an Event, which Instagram doesn't host. This is a hypothesis: a pilot would track Instagram time for Bubbles players against matched non-players.

**What breaks without Facebook.** Each feature depends on a Facebook primitive.

| Remove this | And you lose |
|---|---|
| Groups (membership and posts) | The Daily Bubble, the Group board scope, games made from members' intros, weekly boards and game night |
| Events (RSVP list) | The icebreaker, "who's coming", and Add friend between attendees |
| The everyday-name friend graph | The Friends board, friends' Bursts first in the feed, rivalries, Games about me, hometown challenges |
| Feed, Stories, Reels | Floats, story shares, and Bursts as playable clips |
| Messenger | Challenge Me and group-chat play (not built) |
| Notifications and profiles | "Someone beat your score", "remixed your Bubble", and a maker's body of work |
| Search | Finding games and "Make it with Muse" (not built) |

**Where Facebook is not the strongest, stated plainly.**

- Facebook is the third most used app among US 18-to-29-year-olds, behind YouTube (95%) and Instagram (79%) [52], and its daily use peaks among people aged 30 to 64 [53].
- YouTube [101] and Roblox [96] have stronger AI game-creation tools.
- Reddit already runs games inside community posts [109].
- Discord comes closest on community play (section 7).

Our claim is the combination, not any single feature.

## 7. Facebook against the alternatives

Could another platform run Bubbles as well? The test is the combination Bubbles needs:

- everyday identity;
- standing communities;
- Events with guest lists;
- chat;
- feed distribution;
- a local layer;
- a first-party model.

Percentages are the share of US adults aged 18 to 29 who use each platform (Pew, 2026) [52], where Pew tracks it.

| Platform | Graph and identity | Communities / Events | Games and AI creation | Where it is stronger than Facebook | What it lacks for Bubbles |
|---|---|---|---|---|---|
| **Facebook** (69%) | Everyday-name friend graph [30], opt-in Verified badges [21] | Groups (almost 1.8B monthly, 2024 [14]); Events (700M monthly in 2017, latest public figure, likely stale [17]); Messenger | Instant Games history [34]; Muse models [2] | (reference) | Not the youngest or most used daily app among 18-29s [52][53] |
| Discord (not tracked by Pew) | Pseudonymous servers | Interest servers with scheduled events, in voice channels or at outside locations [123] | Activities in voice channels; an AI party game reached nearly 7M players [98] | Live group play, gaming culture, community plus events plus chat | Everyday identity (age checks added in 2026 [99]), a local layer, feed distribution, a first-party model |
| Instagram (79%, Meta) | Followers and close friends | No Groups or Events found | 3 billion monthly users [115]; Meta is prototyping games in Threads chats [116] | Younger reach, sharing in DMs | Groups, Events, Marketplace and the local layer (section 3.3); a natural sharing channel for Bursts |
| WhatsApp (37%, Meta) | Phone contacts | Communities link multiple groups; each group holds up to 1,024 people [111]. Events in Communities reported (not verified here) | No native games found | Global group reach | Feed, discovery, games; a natural second surface for challenges, not the home |
| iMessage and Apple Invites (Apple) | Phone contacts | Group chats; Apple Invites (2025) lets iCloud+ subscribers create invitations and "anyone can RSVP" [121] | Games app challenges with friends and contacts; invite links shareable through any messaging app [110] | Where many friend plans happen; polished event invites | No standing Groups, feed or discovery; App Store games, not member-made |
| Partiful | Phone numbers and invite links | Event pages with RSVPs, guests who can see who's coming, comments, photos and text blasts; event listings by city [122] | None found | Popular, fast event invites | No standing community between events, no friend graph or feed distribution, no first-party model |
| TikTok (65%) | Interest graph, handles | No Groups; group chats up to 32 people, ages 16+ [103]; US Local Feed shows nearby content but no RSVPs [104] | Developer-made Mini Games in videos, search and DMs [105] | Daily attention (about half of 18-29s daily [53]), virality, local discovery | Communities, Events with guest lists, everyday names |
| Snapchat (56%) | Close-friend chat graph | Group chats | Stopped investing in Games and Minis in 2022 [106]; about 30M monthly Snap Games players in 2021 [117] | Close-friend messaging among young people | North America daily users down 6% to 92M [107]; no Groups or Events |
| Reddit (40%) | Pseudonymous | Subreddits | Developer-made games inside community posts [109] | Per-community games already shipping | Everyday names, friend graph, Events; games need developers; US daily users down 2% [108] |
| YouTube (95%) | Subscriptions | No Groups or Events | Playables (75+ games [102]); Playables Builder makes games from prompts with Gemini 3, in beta for selected creators [101] | Reach, AI game tooling | Friend graph, communities; games flow from creator to audience |
| LinkedIn (41%) | Everyday-name professional graph | Professional | Daily games; "86% of players returning the next day" (company-reported) [79] | A proven daily habit loop | Personal friends, local Groups, Events; games are editorial, not member-made |
| X (31%) | Public graph | Communities retired 2026-05-30 over spam [100] | No games product found | In-house frontier model (Grok), public virality | Communities, safety record for meeting strangers |
| Telegram (not tracked) | Usernames | Groups up to 200,000 people [112] | Game platform since 2016 [112]; over 1B monthly users (CEO claim) [118] | Spreading games through chats at scale | Everyday identity, Events, local layer; tap-to-earn churn [113] |
| WeChat (China) | Contacts | Super-app | Mini-games passed 500M monthly users in 2025 [91]; Jump Jump got 40% of traffic from friend recommendations, per Tencent [90] | Proof that social mini-games work at this scale | Not in our market; Facebook is the closest Western equivalent |
| Roblox | Avatar "Connections" | Experiences | AI tools; two mostly AI-made games in its top 20 (press) [95]; text-prompt 4D generation [96] | User-made games, AI creation, economy | Adults are 29% of age-checked daily users globally [95]; unfiltered teen-adult chat needs a verified real-world connection [97]; 138M daily users, down 9% [95] |
| NYT Games | Accounts, friends leaderboards | None | 11.2B plays in 2025 [82]; friends tab [84]; first 2-player game [82] | Editorial quality, daily habit | No social graph to speak of, no communities; one global puzzle per game |

**What this shows.**

- **Discord comes closest.** It has communities, scheduled events, chat and live games. It lacks everyday identity, a local layer, feed distribution and a first-party model.
- **One-off event apps cover only the meetup.** Partiful and Apple Invites cover the Event, but not the standing Group around it.
- **WhatsApp and Instagram are Meta's own** and natural second surfaces for sharing and challenges.
- **Where others are clearly stronger,** we treat them as validation of the format, not as reasons Facebook wins on that axis: YouTube and Roblox on AI game tools, TikTok on young adults' daily attention, LinkedIn and the NYT on proven daily habit.

We concede the close calls and win on the full set of pieces: no rival has all of them, and Facebook does.
