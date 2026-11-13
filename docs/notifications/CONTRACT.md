# Game notifications

Work branch: `codex/notifications`, based on `main` `6a619c5`.

The server chooses recipients, stores read state, and queues push delivery. The phone displays
server notifications and routes taps. It never manufactures notifications from local scores or
feed ranks. Existing non-game Facebook notifications are unaffected.

## Triggers

- `group_game`: an authenticated member shares a published game to a Group. Notify current
  members except the sender. A client event ID makes retries idempotent. Creating a private
  Studio draft does not send anything.
- `friend_challenge`: after an accepted challenge, notify its distinct recipients, never the
  sender. Existing friendship checks remain authoritative. Best-of-five series use the same
  kind with `seriesId` rather than a single game target.
- `leaderboard_lost`: after a counted score changes the global board's first-place holder,
  notify only the former leader. No alert for an empty board, a second-place change, an
  unranked game, or improving one's own first-place score. Follow the game's score direction
  and tie-break rules. Serialize the board transition, including legacy score submissions.
- `viral_match`: a recently created public game has at least 20 distinct signed-in players in
  the last 24 hours, and cosine similarity to the person's learned taste is at least 0.85.
  Require at least 5 observed pages and a nonzero taste vector. Use the exact existing
  `GameRecs.describe(...).x` vector, not a second feature encoder. Exclude drafts, private
  Group/Event games, the creator, and games the recipient already played. One notification
  per person/game and at most one viral recommendation per UTC day. Thresholds are configurable.

Social alerts are separate from the daily recommendation cap. Notification creation is
idempotent on recipient + source event. Inbox records survive server restart; push retries
reuse the notification ID. APNs is at-least-once delivery, so clients deduplicate by that ID.

## API shape

All routes require the existing bearer authentication; the server derives the account ID.

- `GET /v1/me/notifications?limit=50&cursor=...`: `{items: [...], nextCursor?, unreadCount}`.
  Items: `{id, kind, title, body, gameId?, groupId?, challengeId?, seriesId?, createdAt, readAt?}`.
- `PUT /v1/me/notifications/{id}/read`: `{read: true}` (or false); only the recipient may edit.
- `PUT /v1/me/notifications/read`: mark all read, including those outside the current page.
- `PUT /v1/me/push-devices/{installationId}`: `{token, environment: "sandbox"|"production"}`.
  Re-register after APNs token rotation and account changes; never log tokens.
- `DELETE /v1/me/push-devices/{installationId}`: unregister before sign-out or opt-out.
- `POST /v1/groups/{id}/game-shares`: `{gameId, eventId}`; membership checked on the server;
  `{accepted: true}` on first write and retry.

APNs payload: `{aps: {alert: {title, body}, sound: "default", "thread-id": kind},
notificationId, kind, gameId?, groupId?, challengeId?, seriesId?}`. Payloads contain no
embeddings, auth tokens, or private profile information.

## Delivery and validation

Use a persistent outbox and bounded retries with backoff. APNs 410 and invalid device tokens
remove the registration; transient errors retry. Inbox works without APNs configuration.
APNs key material belongs only on the server. Remote push also needs an Apple Developer App
ID/provisioning profile with the Push Notifications capability; do not silently alter shared
signing settings or claim that a local notification proves background push.

Apple references:
- https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns

Tests should cover recipient exclusion and deduplication, score directions and ties, concurrent
leader changes, auth isolation, cursor boundaries, restart/retry behavior, stale tokens,
zero/mismatched/nonfinite vectors, viral audience thresholds, and the recommendation daily cap.
