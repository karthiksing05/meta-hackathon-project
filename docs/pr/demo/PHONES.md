# Two phones on stage: runbook

*How to run the best of 5 on slide 11 live: Karthik's iPhone against Bayan's, on the same games and seeds, both shown on the presenting Mac. It also covers slide 10's single phone. Written 2026-11-13 by Claude (AI agent for Artem) for Karthik's 07:49 handoff. App behavior is read from `beta-version` at `3ed74be` and `backend/README.md` there; the mirroring steps were tested on Artem's Mac with Artem's iPhone (see [What was tested](#what-was-tested)).*

## The setup in one picture

```
Karthik's iPhone 14 Pro ──Lightning-to-USB-C data cable──┐
                                                          ├── presenting Mac ── Keynote: Live Video on slides 10 and 11
Bayan's iPhone 16 ───────USB-C-to-USB-C data cable───────┘                     (fallback: two QuickTime windows)

Both phones ── Wi-Fi or a hotspot ── Prod API (api.ol4ol.com): accounts, the match, the seeds and the replayed scores
```

The cables carry only the picture. The match itself goes through the server, so both phones also need internet.

## What you need

| Item | Why |
|---|---|
| A **Lightning-to-USB-C data cable** for Karthik's iPhone 14 Pro, and a **USB-C data cable** for Bayan's iPhone 16 | A charge-only cable charges the phone but never shows up as a screen. Test each cable on the presenting Mac the day before. |
| Two free USB-C ports on the Mac (or a **powered** hub) | Plug straight into the Mac where you can. Unpowered hubs are the most common reason a phone drops out. |
| Internet on both phones (venue Wi-Fi, or one phone's hotspot as backup) | The best of 5 is created, seeded and scored on Prod. |
| The current app build on **both** phones | Bayan's phone last got `ee12c04` (2026-11-12); best of 5 on the server landed after that. |
| Karthik's and Bayan's team accounts | Both are in Karthik's friend world on Prod, and they're already friends. |

## 1. Install the same build on both phones (on the presenting Mac)

Claim both phones on the Agent Logistics canvas first. Builds use Karthik's free developer account, which covers Karthik's, Artem's and Bayan's phones. **Its signing profile only includes the phones that are plugged in when you build**, so build once per phone with that phone plugged in:

```sh
xcrun devicectl list devices                     # note each phone's identifier
xcodebuild -project FacebookClone.xcodeproj -scheme FacebookClone -configuration Debug \
  -destination 'platform=iOS,id=<phone-udid>' -derivedDataPath <your-dir> \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <phone-udid> \
  <your-dir>/Build/Products/Debug-iphoneos/FacebookClone.app
```

- On Karthik's Mac, prefix these with `DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer` (CLAUDE.md).
- If an install fails with a profile error, **don't retry in a loop.** That leaves the app unopenable until the retries stop. Fix the profile and install once.
- The first time the app opens on a phone, trust the developer: Settings → General → VPN & Device Management.
- Installs from the free account expire on 2026-11-19.
- **Nothing to set for the server.** A build launched from the home screen uses the live API (`FacebookAPI.swift`: the default is `.live`; `FB_API` is a debug launch variable only).

## 2. Sign each phone in

- Karthik's phone: Karthik's account. Bayan's phone: Bayan's account.
- In the app: Menu → Log out → Log in, with the team email and the team password Karthik posted in the channel at 07:32 (not written here).
- Check on each phone that the Curios feed loads real Curios, not an empty or mock feed.

## 3. Start the match (the part that only works once)

**How it works.** A best of 5 is a server series (`POST /v1/series`). The server picks each round's seed, each phone uploads its run's input log, and the server replays the log to get the score, so neither phone is trusted. You can't see the other score for a round until you've played it. The five games are microgames from the starter's Curios feed, picked in a fixed order for each pair of people, so Karthik vs Bayan gets the same five every time.

**On stage:**
1. On Karthik's phone, open the Curios feed for a moment first. The five games come from the loaded feed; with fewer than 5 microgames loaded, it becomes "a best of 3" or similar.
2. Open Bayan's profile → **Play Bayan: best of 5**. A toast says "Best of 5 started with Bayan", and the button turns into the match card with its five rounds.
3. On Bayan's phone, open **Challenges** (the trophy). The match is at the top under "Your matches". If it isn't there after a few seconds, pull to refresh.
   - Don't rely on tapping the notification: the app has no tap routing for series notifications yet (`seriesID` isn't used outside the notification model on `3ed74be`).
4. Both tap **Round 1 → Play** and play at the same time, side by side. Each round's result shows once both have played.

### Two gaps to know before rehearsing

1. **One match per pair, ever (for now).** A friend's profile shows your *latest* match with them, even a finished one (`BracketProfileCard` → `bracket(with:)`), and the server has no way to delete a series. After Karthik and Bayan play one match, the profile shows that old match, and there's no button to start a new one. So:
   - **Rehearse with other accounts** (for example Artem vs Kevin, or two spare accounts), and keep Karthik vs Bayan fresh for the stage; **or**
   - ask Karthik's front-end agent for a small fix: show "Play again: best of 5" on the profile card when the latest match is finished. That's an app change, so it's their call.
2. **Add friend on a board doesn't start a match by itself.** `BracketHooks.met` only proposes a best of 5 when the two are already server friends, so with a pending friend request nothing happens until it's accepted. DEMO_PLAN's Demo 3 says "tap Add friend on someone you don't know → start a best of 5". With one phone, that person can't accept, so on stage start the best of 5 with Bayan from his profile instead (step 2 above). Add friend can still be shown first as its own beat.

## 4. Show both phones on the Mac

### Keynote Live Video (the plan)

1. Before opening Keynote: unlock both phones, plug both in, and tap **Trust** on each if asked (only the first time on a given Mac).
2. Give Keynote camera access if macOS asks (System Settings → Privacy & Security → Camera → Keynote). An iPhone screen counts as a camera.
3. Slide 10 has one Live Video box (Karthik's phone); slide 11 has two (Karthik's, then Bayan's). For each box: Format sidebar → Live Video → Source → pick the phone **by its name** ("Karthik-iPhone", Bayan's shows up as "iPhone"). Renaming Bayan's phone (Settings → General → About → Name) makes this harder to mix up.
4. A full Keynote rebuild (`../slides/keynote/build.sh`) drops the Live Video boxes. Insert them again, then run `osascript ../slides/keynote/snap-phones.applescript` to snap them into the phone frames.
5. Play the slideshow once with both phones on, and check that both boxes move live on slide 11.

### QuickTime (the fallback, tested)

If a Live Video box stays black on stage:
1. Leave the slideshow (Esc).
2. QuickTime Player → File → New Movie Recording → click the ⌄ next to the record button → pick the phone. Do it again for the second phone; each phone gets its own window.
3. Put the two windows side by side (View → Float on Top keeps them above Keynote), and play on.

## 5. Stage checklist for both phones

- [ ] Same build on both, opened from the home screen once today (and the developer trusted).
- [ ] Signed in: Karthik on his, Bayan on his. The Curios feed loads.
- [ ] No match between Karthik and Bayan yet (Bayan's profile on Karthik's phone shows **Play Bayan: best of 5**, not an old match).
- [ ] Do Not Disturb on both. Bayan's phone matters as much as Karthik's: personal messages would show on the big screen.
- [ ] Auto-Lock set to Never on both (Settings → Display & Brightness → Auto-Lock). Brightness up, Low Power Mode off.
- [ ] Internet works on both (open the Curios feed); a hotspot is ready as backup.
- [ ] Data cables plugged straight into the Mac, Trusted, and both boxes moving on slide 11.
- [ ] QuickTime is closed (it can hold a phone's screen), and open only if you fall back to it.

## What was tested

| Step | Result |
|---|---|
| iPhone over Wi-Fi (Xcode pairing) as a screen source | **Doesn't work.** Over Wi-Fi the phone isn't offered as a video source; it needs the cable. |
| iPhone 17 Pro (iOS 26) on a USB-C cable as a screen source | **Works.** macOS lists it as an external iOS Device video source, the same list Keynote's Live Video picks from. |
| QuickTime → New Movie Recording → the phone | **Works**: live mirroring, checked by Artem on his Mac. |
| Two phones at once on one Mac | **Not tested**: only one phone was here. QuickTime and Keynote treat each phone as its own source, so it should work, but rehearse it on the presenting Mac. |
| Keynote Live Video with an iPhone | **Not tested here** (no Keynote on this Mac). Slides 10 and 11 were built for it on Karthik's Mac. |
| Karthik vs Bayan best of 5 on Prod | **Not run**, on purpose: it would use up their one match (gap 1). The flow above is read from the code on `3ed74be`. |
