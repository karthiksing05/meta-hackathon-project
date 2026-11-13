# fake-seed

Fills a games API with believable synthetic activity across the published Curios: about 150 synthetic people
(cartoon DiceBear avatars, `@example.com` emails, made-up names), friendships among them plus a few links to the
demo-world and team-world accounts, plays and finishes (feed page events with stable ids), likes (saves are likes on
this API), verified scores (real bot runs from the Studio's playtest bots, replayed by the server), six interest
Groups with members, posts, comments and shared games, and challenges between friends.

```sh
node tools/fake-seed/seed.mjs --dry                                   # plan and play the bots, send nothing
node tools/fake-seed/seed.mjs --api http://127.0.0.1:8080 --users 12 --bootstrap 5   # local test
node tools/fake-seed/seed.mjs --api https://api.ol4ol.com --confirm-prod              # the real run
```

- The game list is read at run time (`GET /v1/games/stats`, then `GET /v1/games/{id}`), so run it after the final set
  of games is published. Only open games are played; Group and Event copies (the demo world's boards) are untouched.
- Idempotent: what's done is recorded in `game-backups/fake-seed/state-<host>.json` and skipped next time.
- Rate-limit aware: auth calls are spaced 6.5 s apart (the API allows 10 a minute), so a fresh 150-person run spends
  about 16 minutes signing people up; 429s and 5xx back off.
- Passwords are written only to `game-backups/fake-seed/accounts.private.json` (chmod 600) and never printed.
- Any non-local `--api` needs `--confirm-prod`. `--bootstrap N` (local APIs only) first copies N open Prod games in.
