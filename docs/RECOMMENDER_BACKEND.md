# What the games recommender needs from the backend

Draft contract for Max's API (`backend-api`). Kevin's recommender (`game-recs.js`) runs on the phone
and works with no server. These endpoints add what one phone can't have on its own:
- learning across people;
- social moments that happen on other phones;
- a shared scoreboard for the interleaving test.

Paths follow the existing `/v1` API. Field names are brand-neutral (`gameID`, not bubble or whim).
The thread in #meta-closer-together-26 under Max's agent's 15:03 "backend is live" post has the
discussion. Change anything here that doesn't fit how the backend works; tell us and we'll match it.

Ground rules:
- The app keeps working when the server is down. The mock stays the default, and ranking falls back
  to on-device data.
- All demo data is synthetic.
- The Muse API key never leaves the server, if the re-rank proxy (7) is built.
- **IDs:** the recommender needs one `gameID` that's the same on every phone. If server IDs are the
  only IDs, that's fine; otherwise the optional unique slug Max offered works.

## Must have for the demo

### 1. Event log: extend `POST /v1/feed/events`

Batched (up to ~50 events). Idempotent by the client's `eventID`. Store unknown `kind`s instead of
rejecting the batch.

One event per feed page shown:

```json
{
  "eventID": "uuid", "userID": "u1", "sessionID": "s1", "day": 312, "ts": "2026-11-12T15:20:00-08:00",
  "feedItemID": "f9", "gameID": "g42", "position": 3, "reason": "friend_played",
  "team": "A", "score": 0.71, "propensity": 0.18,
  "dwellSec": 8.2, "tookOver": true, "runsFinished": 1, "replays": 0,
  "saved": false, "liked": true, "floated": false, "openedBoard": false,
  "addedFriend": false, "remixed": false, "quitMidRun": false, "endedSession": false,
  "social": ["challenge_sent"], "with": ["u7"]
}
```

- `team`: `"A"` (the formula), `"B"` (the control) or `null`. Set when the page came from an
  interleaved feed.
- `score`: the formula's score for this pick. Optional.
- `propensity`: the chance the formula would pick this game at this position, estimated on the
  phone. Optional. Storing it now means replay and doubly robust evaluation can run later
  (`tools/recs-sim/BENCHMARKING.md`, item 8).

A moment away from the feed (Messenger, a Group, a profile) uses the same endpoint with no page
fields:

```json
{ "eventID": "uuid", "userID": "u1", "kind": "challenge_accepted", "gameID": "g42", "with": ["u7"], "day": 312 }
```

`kind` values are the `BubbleSocialSignalKind` raw values in `docs/BUBBLES.md` 7.1, plus `saved`.

### 2. Game stats across people: `GET /v1/games/stats?since=…`

Per game, for cold-start priors, the cap on untested games, and the slop and bait guards. Daily or
on-launch freshness is enough. It can be a roll-up of the event log.

```json
{
  "gameID": "g42", "impressions": 1200, "takeovers": 540, "finishes": 300, "satisfied": 210,
  "replays": 90, "socialMoments": 44, "createdDay": 305, "creatorID": "u3", "groupID": null,
  "quality": { "botGatePassed": true, "fragments": 0, "reports": 0 }
}
```

`satisfied` counts pages whose satisfaction reached 0.5. The phone can send it as a boolean on each
event if that's easier than computing it on the server.

### 3. Social moments inbox: `GET /v1/me/moments?cursor=…`

When someone challenges me, remixes my game or plays with me in a group chat on their phone, my
phone needs to hear about it. Each moment becomes off-feed evidence (`app.signal`).

```json
{ "moments": [ { "momentID": "m1", "kind": "challenge_received", "gameID": "g42", "from": "u7", "day": 312 } ], "cursor": "…" }
```

This depends on the challenge and session objects being built.

### 4. Group Blend inputs: `GET /v1/groups/{id}/blend-inputs`

Each member's skill and a coarse taste summary, so a Blend doesn't need every member's phone.
Optional for the demo: the Blend runs on the phone with the synthetic cast today.

```json
{
  "group": { "id": "grp1", "name": "New in SF" },
  "members": [
    { "id": "u1", "name": "Maya", "isFriend": true,
      "skill": { "overall": 0.6, "byFormula": { "dodge": 0.7 } },
      "taste": [0.1, 0.0, "… 24 numbers in 0..1, the order of game-recs.js describe()"],
      "recentGames": ["g42", "g17"] }
  ]
}
```

`recentGames` feeds the Blend's fairness boost (who's been served least lately).

## Should have

### 5. Interleaving summary: `GET /v1/experiments/interleave`

The demo's headline number ("the formula won X% of N sessions"), built from events that carry `team`.

- A page earns its side a point when it was satisfying: a finish, a replay, a save or a social
  moment. A grab alone isn't a point.
- A session goes to the side with more points; equal points is a tie.
- The phone already computes the same tally for itself (`app.interleaveStats()`). This endpoint
  adds everyone's sessions together.

```json
{ "baseline": { "sessions": 140, "formulaWins": 61, "controlWins": 38, "ties": 41 } }
```

### 6. Event export: `GET /v1/events/export?since=…`

JSONL of the event log, for offline benchmarking: replay, property tests on real sessions, and
persona checks.

## Nice to have (the phone has fallbacks)

### 7. Muse re-rank proxy: `POST /v1/rerank`

```json
{ "userID": "u1", "history": ["finished a calm guessing game twice", "…"],
  "candidates": [ { "gameID": "g42", "summary": "…" } ], "k": 10 }
→ { "order": ["g42", "…"], "why": { "g42": "…" } }
```

- Keeps the key on the server.
- Caches per person for about 30 minutes.
- Times out at about 2 seconds.

Without it, the app calls Muse directly through its existing client.

### 8. State backup: `PUT` and `GET /v1/me/recs-state`

One JSON blob under 200 KB, so learning survives a reinstall and moves between the simulator and
the phone.

### 9. Generation queue: `POST /v1/generate`

A short brief, sent when the recommender sees a taste gap no game fills. Muse Studio work, probably
after the demo.
