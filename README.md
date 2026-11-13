# Facebook Clone for iOS (SwiftUI)

A front-end recreation of the Facebook iPhone app, written in Swift and SwiftUI for the Meta hackathon.
Everything runs on the device with preloaded mock data. There is no backend, no login and no network
API: the "server" (replies, reactions, friend accepts, new notifications) is simulated with timers so the
app feels alive.

This is a hackathon project. It is not affiliated with or endorsed by Meta.

## Muse Curios

> When the world is your muse, how will you create the content of tomorrow?

Muse Curios is the feature we built on top: anyone can describe a tiny game in a sentence, Meta's Muse
models make it, and the Curio plays inside Facebook, in the Curios tab, in Groups, Events, Stories and
Reels. The design and contracts are in [docs/BUBBLES.md](docs/BUBBLES.md) (the code still says
"Bubble"), and the backend in [backend/README.md](backend/README.md).

## Run it

1. Install **Xcode 16 or later**. The project uses Xcode 16's folder-synced project format, so every
   `.swift` file you add under `FacebookClone/` is picked up automatically.
2. Open `FacebookClone.xcodeproj`.
3. Pick an iPhone simulator running iOS 17 or later and press Run (⌘R).
4. To run on your own phone, select your team under *Signing & Capabilities*.

If the project file doesn't open in your Xcode version, regenerate it from `project.yml`:

```sh
brew install xcodegen
xcodegen generate
```

Photos come from picsum.photos, profile pictures from randomuser.me, and videos from public sample
streams, so the simulator needs internet. Offline, the app still runs and shows gray placeholders and
initials instead.

> **Heads-up:** this code was written in an environment without Xcode, so it has never been compiled.
> Expect a handful of compile errors on the first build. Paste them back and they're quick to fix.

## Features

**Home feed**
- "facebook" header with create (+), search and Messenger (with unread badge)
- "What's on your mind?" composer and a stories tray (create story, your story, friends' stories with seen/unseen rings)
- Posts of every kind: text, colored-background text, single and multi-photo grids (+N overlay), autoplaying muted video, link previews, shared posts, group posts, polls you can vote in, life events, profile-picture updates, sponsored posts with a call to action
- Reels tray, People You May Know carousel and Suggested Groups carousel mixed into the feed
- Loading skeletons, pull to refresh (adds fresh posts), infinite scroll from a preloaded buffer with image prefetching, tap the Home tab to scroll to top

**Posts**
- Like, or long-press for the 7-reaction picker (drag to choose, haptics)
- Reaction summary ("You and 1.2K others"), list of who reacted by reaction type
- Threaded comments with replies, comment reactions, edit/delete your own, reply banner
- Share sheet: share now, send in Messenger, share to story, share to a group, copy link, system share
- "..." menu: save, notifications, favorites, hide (with Undo), snooze, unfollow, report, edit/delete your own posts, change audience
- Full-screen photo viewer with paging, pinch and double-tap zoom, swipe down to dismiss
- New posts upload with a progress bar, then friends react and comment over the next few seconds

**Create**
- Post composer: audience picker, colored backgrounds, multi-photo picker, feeling/activity, tag friends, check-in, polls, posting to groups or a friend's profile, sharing a post with a comment, editing, "save as draft" or discard
- Story creator: text stories on gradient backgrounds, or photo stories with captions, text and emoji stickers
- Story viewer: progress bars, tap to skip, hold to pause, swipe between people with a cube transition, swipe down to close, swipe up to reply, quick reactions (sent to Messenger), viewer counts on your own story
- "+" menu: post, story, reel, live, note, event, sell something

**Video and Reels**
- Video tab with chips (For you, Live, Reels, Following, Saved), one autoplaying video at a time (the one nearest the middle of the screen), LIVE badges, mute toggle, progress bar
- Full-screen player with play/pause, ±10 s skip, scrubbing and auto-hiding controls
- Reels: vertical paging, tap to pause, hold to pause, double-tap to like with a heart burst, comments, share, follow, expandable caption, scrolling audio title, progress line

**Messenger**
- Chats list with search, active-now row, notes, filters (All, Unread, Groups, Archived), pin/mute/archive/delete/mark unread
- Chat screen with grouped bubbles, timestamps, photos, big emoji, reply quotes, swipe to reply, reactions, unsend, typing indicator, sent/delivered/seen receipts, in-chat search, 10 themes and quick-emoji settings
- Simulated replies, new group chats, mock audio and video calls

**Friends, Profile, Notifications**
- Friend requests (confirm/delete), People You May Know (add/remove/cancel), your friends with search and sort
- Profiles for you, friends, strangers and Pages: cover and profile photos (changeable), story ring, bio, details, friends grid, posts, photos, reels and About tabs, friendship and follow actions, edit profile
- Notifications with New/Earlier sections, unread state, inline friend-request actions, per-row menu, swipe to delete, deep links to the post, profile, group, event or listing

**Marketplace**
- Today's picks grid, categories, search, location radius on a map, filters and sorting
- Listing detail with photo pager, message the seller (quick replies), save, share, map, seller info, similar items
- Sell flow with photos, price, category and condition; manage your listings and saved items

**Menu and more**
- Menu with shortcuts grid, collapsible Help and Settings sections, dark-mode picker, log out
- Groups, Events (Going/Interested), Saved items, Memories, Birthdays, Feeds (Favorites/Friends/Groups/Pages filters), Pages
- Settings: dark mode, autoplay, data saver, haptics, sounds, hide reaction counts, active status, notification types, favorites/snoozed/unfollowed management, "Your time on Facebook" chart, clear search history

**Everywhere**
- Light and dark mode, Dynamic Type for body text, haptics, toasts, context menus, swipe actions, empty states
- Simulated live activity: friends come online, notifications arrive, new stories appear

## How it's built

| Part | Where | What it does |
|---|---|---|
| App shell | `FacebookClone/App` | App entry, splash, logged-out screen, custom tab bar, router, settings keys |
| State | `FacebookClone/Data/AppStore.swift` | One `@Observable` store with every action and the simulated activity |
| Mock data | `FacebookClone/Data/MockData.swift`, `MockContent.swift` | Seeded generator for people, posts, chats, listings and more, plus a preload buffer for the infinite feed |
| Models | `FacebookClone/Models` | `User`, `Post`, `Comment`, `Story`, `Conversation`, `Listing`, `FBGroup`, `FBEvent`, `AppNotification` |
| Design system | `FacebookClone/DesignSystem` | Colors (light/dark), fonts, avatars, buttons, chips, cached remote images, skeletons, video player |
| Features | `FacebookClone/Features/*` | One folder per area: Home, Post, Video, Messenger, Profile, Friends, Notifications, Menu, Search, Marketplace, Groups, Events, More |

- Navigation: each tab has its own `NavigationStack`, and every screen is reachable through the `Route`
  enum in `Router.swift`. Messenger, the composer, the story creator and Reels open full screen.
- Requirements: iOS 17+, Swift 5 language mode, no third-party dependencies.
- Persistence: only settings and recent searches are saved. Everything else resets on relaunch.
