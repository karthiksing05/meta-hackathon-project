# iOS notification delivery

The client is implemented on `codex/notifications`. Max owns all backend work; the request and
API shapes are in [CONTRACT.md](CONTRACT.md) and the Slack handoff:
https://karthiks-agents.slack.com/archives/C0CH1G45BJQ/p1794556621874659

Facebook **Groups only**, not Messenger group chats (Kevin's clarification).

## App behavior

- The existing Notifications tab has a live Games section with unread filtering, paging, retry,
  mark read/unread, and server-backed mark-all. The tab badge includes the server unread total.
- Existing local game notification samples are filtered from that tab and badge. Only server
  game activity is shown; unrelated Facebook clone notifications keep their existing behavior.
- The inbox reloads every 30 seconds while signed in and active, on return to the app, on push,
  and on pull-to-refresh. Polling is foreground-only; it is not lock-screen delivery.
- Enable in Notifications explicitly requests Apple alert/sound/badge authorization. Already
  authorized installs re-register on launch and foreground. The app never schedules local
  notifications as a substitute for APNs.
- The APNs device token is sent through the authenticated client. The installation UUID is
  stable across launches; token changes and account changes trigger re-registration. Tokens
  are never logged. Before logout the app attempts server unregister and stops OS delivery.
  Failed unregister requests retain cleanup intent for the next sign-in to that account.
- Cold-start taps wait for sign-in. A push's ID is resolved through the current account's
  authenticated inbox before routing; payload destinations alone aren't trusted. A missing
  or very old item leaves the user in Notifications. Challenges open Challenges, lost first
  place opens the game board, Group shares open the shared game (or the Group's games if no game is attached), and viral games open the
  game page. Unknown kinds degrade to the game page or inbox.
- Group shares call the server with the new post's stable ID as `eventId`. Errors are reported
  instead of claiming that other members received alerts. No eligibility runs on the phone.

## Apple provisioning (deferred by Kevin; required for actual remote push)

No signing team, Xcode project, or shared provisioning settings were changed by this work.
Someone with access to the team's Apple Developer account must:

1. Enable Push Notifications for this app's explicit App ID, using a team that supports it.
2. Add Push Notifications in Signing & Capabilities and regenerate the provisioning profile.
3. Ensure the built app is signed with `aps-environment=development` for development devices,
   or `production` for TestFlight/App Store. Set the app's `APNSEnvironment` Info.plist value to
   `sandbox` or `production` to match. Without an override, Debug uses sandbox and Release
   uses production; explicitly override for ad hoc distribution that uses a production profile.
4. Give Max the APNs key ID, team ID, bundle ID/topic and `.p8` key through the team's secure
   secret channel. Never put the private key in this repository, Slack messages, or app bundle.
   An opt-in signing configuration is provided, without altering the shared project:

   ```
   xcodebuild -project FacebookClone.xcodeproj -scheme FacebookClone \
     -xcconfig docs/notifications/PushNotifications.xcconfig \
     -destination 'generic/platform=iOS' \
     -derivedDataPath /private/tmp/notifications-device-build \
     -allowProvisioningUpdates build
   ```

   For production profiles append `APS_ENVIRONMENT=production APNS_ENVIRONMENT=production`.
   Pass `DEVELOPMENT_TEAM=<team ID>` if using another team.

5. Have Max configure the sender on the server. Backend inbox endpoints should work even when
   its APNs sender is disabled. Logout should revoke the installation server-side as well, to
   cover a phone going offline during unregister; this is a backend responsibility.

Apple references:
https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

## Checks

`tools/notifications-tests/run.sh` compiles the production inbox/model code and checks pagination,
server unread totals, duplicate pages, write failures, account-switch isolation, stale GETs after
writes, unknown kinds and authenticated push-ID resolution. The live API client and UI compile
in the full simulator app build.

Build with a dedicated DerivedData path:

```
xcodebuild -project FacebookClone.xcodeproj -scheme FacebookClone \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/notifications-derived-data CODE_SIGNING_ALLOWED=NO build
```

Once Max's endpoints and Apple signing are configured, use two real accounts/devices:

- Share a game to a Group: every other member gets one alert, sender gets none; retry the same
  event ID and confirm no duplicate. A nonmember cannot send a Group notification.
- Challenge a friend, including best-of-five: recipient gets one alert; tap opens Challenges.
- Displace the first-place holder on higher- and lower-is-better games, including ties and
  simultaneous submissions; only the former #1 receives an alert. Second-place changes do not.
- Qualifying viral games reach only close taste matches after the distinct-player threshold;
  no second viral push that day. Use server test controls, never fake client eligibility.
- Background/terminate the app, trigger a real event on another device, and verify lock-screen
  delivery and tap navigation. A `simctl push` fixture tests presentation only, not APNs.
- Deny permission, enable it in Settings, turn the app push setting off, rotate the token,
  sign out, and switch accounts. Old account items and taps must not appear in the new inbox.

Until those checks run against Max's backend and APNs, report the client as built and locally
verified, not as end-to-end remote push delivery.
