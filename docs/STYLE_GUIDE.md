# Style Guide

How this app looks, moves and reads, and the code rules that keep it that way. The goal is that any
screen, written by anyone, is indistinguishable from the Facebook iOS app and from every other screen
here.

Tokens live in `FacebookClone/DesignSystem/`. If something you need isn't a token yet, add it there
first, document it here, then use it. Feature code should never invent its own colors, sizes or radii.

**Contents:** [Principles](#1-principles) · [Color](#2-color) · [Typography](#3-typography) ·
[Iconography](#4-iconography) · [Spacing and layout](#5-spacing-and-layout) · [Shape](#6-shape) ·
[Avatars](#7-avatars) · [Components](#8-components) · [Screen anatomy](#9-screen-anatomy) ·
[Interaction patterns](#10-interaction-patterns) · [Motion and haptics](#11-motion-and-haptics) ·
[Content and copy](#12-content-and-copy) · [Accessibility](#13-accessibility) ·
[Code conventions](#14-code-conventions) · [Design QA checklist](#15-design-qa-checklist)

---

## 1. Principles

1. **Content first.** Photos, names and text carry the screen. Chrome is white, flat and quiet.
2. **White cards on gray.** Feeds are full-width white posts split by 6 pt gray bars. Grouped screens
   (Menu, Settings) are white rounded cards on `#F0F2F5`.
3. **Blue means action.** `#0866FF` is reserved for primary buttons, links, selected tabs and selected
   chips. Never use it for decoration.
4. **One way to do each thing.** One button style per role, one avatar size per context, one icon per
   concept. Reuse the components in section 8 before building new ones.
5. **Alive, not loud.** Counts tick up, friends reply, skeletons shimmer, likes pop. Motion is short and
   springy; nothing bounces for longer than 0.4 s.
6. **Both modes, always.** Every color is a dynamic token, so dark mode is correct by construction.

---

## 2. Color

Use `FBColor` tokens only. They adapt to dark mode automatically.

### Neutrals and surfaces

| Token | Light | Dark | Use for |
|---|---|---|---|
| `surface` | `#FFFFFF` | `#242526` | Posts, cards, headers, tab bar, sheets |
| `background` | `#F0F2F5` | `#18191A` | Grouped screens behind cards (Menu, Settings, Saved) |
| `feedSeparator` | `#CED0D4` | `#0F0F10` | The 6 pt bar between feed posts and feed modules |
| `elevated` | `#FFFFFF` | `#3A3B3C` | Floating elements over surfaces (reaction picker) |
| `primaryText` | `#050505` | `#E4E6EB` | Names, body text, icons in headers |
| `secondaryText` | `#65676B` | `#B0B3B8` | Timestamps, counts, subtitles, inactive tab icons |
| `tertiaryText` | `#8A8D91` | `#8A8D91` | Placeholders, disclaimers, disabled labels |
| `divider` | `#DADDE1` | `#3E4042` | Hairlines between rows, input borders |
| `buttonGray` | `#E4E6EB` | `#3A3B3C` | Secondary buttons, circle header buttons, unselected chips |
| `inputBackground` | `#F0F2F5` | `#3A3B3C` | Search fields, comment bubbles, composer fields |
| `skeleton` | `#E4E6EB` | `#3A3B3C` | Loading placeholders, image placeholders |

### Brand and states

| Token | Value | Use for |
|---|---|---|
| `brandBlue` | `#0866FF` | Primary buttons, selected tab, logo, story rings, links on media |
| `accent` | `#0866FF` / `#4599FF` dark | Blue text: links, "See all", hashtags, unread timestamps, selected chip text |
| `wordmark` | `#0866FF` / `#E4E6EB` dark | The "facebook" wordmark only |
| `tintedBlueBackground` | `#EBF5FF` / `#263951` | Selected chips, tinted ("Add friend") buttons |
| `unreadBackground` | `#E7F3FF` / `#1F2E43` | Unread notification rows |
| `notificationRed` | `#E41E3F` | Count badges, destructive buttons |
| `online` | `#31A24C` | Active-now dot |
| `liveRed` | `#F02849` | LIVE pills |
| `toastBackground` | `#303031` | Toast snackbars |
| `darkCanvas` | `#18191A` | Always-dark screens (story creator, calls) |

### Feature accents

Used for icon circles and tiles that identify a product area (composer tools, menu shortcuts,
notification badges). Never for text or large areas.

| Token | Value | Area |
|---|---|---|
| `photoGreen` | `#45BD62` | Photo/video tool, comment badges |
| `feelingYellow` | `#F7B928` | Feeling/activity, highlights |
| `tagBlue` | `#1877F2` | Tag people |
| `checkInRed` | `#F5533D` | Check in |
| `reelsPink` | `#E42D6F` | Reels |
| `groupsBlue` | `#1B74E4` | Groups |
| `eventRed` | `#F3425F` | Events, event dates |
| `marketplaceTeal` | `#00A3A3` | Marketplace |
| `memoriesBlue` | `#2ABBA7` | Memories |
| `savedPurple` | `#8C4FFF` | Saved |
| `pollOrange` | `#F5A623` | Polls |

### Reactions and Messenger

| Token | Value | Use for |
|---|---|---|
| `ReactionType.like.color` | `#0866FF` | "Like" label when liked |
| `ReactionType.love.color` | `#F33E58` | "Love" label |
| `care / haha / wow / sad` | `#F7B125` | Their labels |
| `ReactionType.angry.color` | `#E9710F` | "Angry" label |
| `messengerBlue` | `#0A7CFF` | Default outgoing bubble (per-chat theme via `conversation.themeColor`) |
| `incomingBubble` | `#F0F0F0` / `#303030` | Incoming bubbles |

### Color rules

- **Never** use SwiftUI's hierarchical styles (`.primary`, `.secondary`, `.tertiary`) or system colors
  (`.blue`, `.gray`, `Color(.systemBackground)`) for UI. They don't match Facebook's grays and blues.
  Use `FBColor.primaryText`, `FBColor.secondaryText`, `FBColor.brandBlue`, and so on.
- **Over media** (photos, video, Reels, stories) use `.white` and `.black` with opacity. Add a gradient
  scrim (`.black.opacity(0.0 → 0.6)`) behind any text on images.
- **Hex literals** belong in `DesignSystem/Theme.swift`. The one exception is a decorative palette
  (gradients for story-creator tiles, call backgrounds), declared once next to the view that uses it
  (a `static let` or a computed property on that feature type), never inline in a `body`.
- Color ternaries must compare `Color` with `Color`: `isOn ? FBColor.accent : FBColor.secondaryText`.

---

## 3. Typography

System font (SF Pro), which is what Facebook's iOS app uses for UI. Tokens map to Dynamic Type text
styles where Facebook's size matches one, so text scales with the user's setting.

| Token | Size / weight | Text style | Use for |
|---|---|---|---|
| `.fbLargeTitle` | 28 bold | fixed | Messenger "Chats" title |
| `.fbTabTitle` | 26 bold | fixed | Tab titles ("Friends"), profile name |
| `.fbTitle` | 20 bold | `.title3` | Section titles ("Friend requests", "Today's picks"), sheet titles |
| `.fbHeadline` | 17 semibold | `.headline` | Card titles, emphasized rows, toolbar titles |
| `.fbBodyLarge` | 17 regular | `.body` | Text fields, larger body copy, settings rows |
| `.fbName` | 15 semibold | `.subheadline` | Names in post headers, rows and comments |
| `.fbBody` | 15 regular | `.subheadline` | Post text, comments, most body copy |
| `.fbButton` | 15 semibold | `.subheadline` | Button labels, chip labels, action bar labels |
| `.fbMetaEmphasized` | 13 semibold | `.footnote` | Emphasized meta ("Like · Reply" row, counts) |
| `.fbMeta` | 13 regular | `.footnote` | Timestamps, counts, subtitles |
| `.fbCaptionEmphasized` | 12 semibold | `.caption` | Pill text, emphasized small labels |
| `.fbCaption` | 12 regular | `.caption` | Labels under tiles and thumbnails |
| `.fbMicroEmphasized` | 11 semibold | `.caption2` | Badges, LIVE pills, overlay counters |
| `.fbMicro` | 11 regular | `.caption2` | Durations, tiny counters |

Rules:

- Text uses tokens. `.font(.system(size:))` on text is allowed only for **display text** that is meant
  to be big and fixed: colored-background posts, story text, big-emoji messages, the call screen name,
  the tab bar's 10 pt labels. Comment it when you do it.
- Weights: regular for reading, semibold for names and actions, bold for titles. Never `.black` or
  `.heavy` except the logo.
- Body text never goes below 13 pt. Long post text truncates with an inline "... See more".
- Numbers: `Int.fbCompact` for counts ("1.2K"), `Int.withCommas` for prices and exact totals.

---

## 4. Iconography

SF Symbols, outline by default, **filled when selected or active** (selected tab, liked, saved,
following). Icons take their color from the text they sit with (`primaryText` in headers,
`secondaryText` in action bars and meta rows).

### Sizes (`FBIconSize`)

| Token | pt | Use for |
|---|---|---|
| `xs` | 11 | Inline glyphs in 11–12 pt text (audience globe in post headers) |
| `small` | 13 | Inline glyphs in 13–15 pt text |
| `medium` | 15 | Icons inside chips and buttons |
| `regular` | 17 | Header circle buttons, action bars, list row icons (default) |
| `large` | 20 | Prominent row icons, composer tools |
| `xl` | 22 | Tab bar, Reels action column |
| `xxl` | 28 | Hero icons: empty states, call controls |

Write icons as `.font(.system(size: FBIconSize.regular, weight: .semibold))`. Weight is `.semibold`
in headers and buttons, `.regular` in action bars and tab bar (unselected).

### One icon per concept

| Concept | Symbol |
|---|---|
| Home / Video / Friends / Marketplace / Notifications | `house` · `play.tv` · `person.2` · `storefront` · `bell` (`.fill` when selected) |
| Menu tab | Your avatar with a small `line.3.horizontal` badge |
| Create / Search / Messenger | `plus` · `magnifyingglass` · `MessengerGlyph` |
| Like / liked | `hand.thumbsup` / `hand.thumbsup.fill` (or the chosen reaction) |
| Comment | `bubble.right` (`.fill` on dark media) |
| Share | `arrowshape.turn.up.right` (`.fill` on dark media) |
| Send | `paperplane.fill` |
| Save / saved / unsave | `bookmark` / `bookmark.fill` / `bookmark.slash` |
| More options | `ellipsis` |
| Close / dismiss / hide post | `xmark` |
| Audience: Public / Friends / Friends except / Only me | `globe.americas.fill` / `person.2.fill` / `person.fill.badge.minus` / `lock.fill` |
| Photo / tag / feeling / check-in | `photo.on.rectangle.angled` / `person.crop.circle.badge.plus` / `face.smiling` / `mappin.and.ellipse` |
| Verified | `checkmark.seal.fill` in `brandBlue` |
| Notifications off / on | `bell.slash` / `bell` |
| Settings | `gearshape` |
| Report | `flag` |
| Snooze | `clock` |
| Unfollow / unfriend | `person.fill.xmark` |

Brand marks are drawn, not symbols: `FacebookWordmark`, `FacebookLogo`, `MessengerGlyph`. Reactions use
`ReactionBadge` (blue thumbs-up circle, red heart circle, emoji faces).

---

## 5. Spacing and layout

### Scale (`FBSpacing`)

`xxs 2 · xs 4 · s 8 · m 12 · l 16 · xl 24 · xxl 32`. Facebook also uses 6 and 10 inside tight rows
(between an avatar and its text, between stacked meta lines); those are fine.

### Gutters

| Context | Horizontal padding |
|---|---|
| Inside posts, comments, feed modules (stories tray, carousels) | `FBMetrics.gutter` = 12 |
| Screen edges: tab headers, lists, settings, profile sections | `FBMetrics.screenPadding` = 16 |
| Grouped cards (Menu, Settings) | 16 outside, 12–16 inside |

### Rhythm

- Feed: `LazyVStack(spacing: 0)`; every post and module is full width on `surface`, followed by
  `FeedSeparator()` (6 pt).
- Post anatomy, top to bottom: header (12 pt top, 8 pt bottom) → text (12 pt sides) → media (full
  bleed, 2 pt gaps in grids) → counts row (10 pt vertical) → hairline → action bar (44 pt tall).
- Lists: rows 8–12 pt vertical padding; hairline dividers inset to the text start when rows have
  avatars.
- Minimum tap target: 44 × 44 pt, even when the glyph is smaller (use `.contentShape`).
- The custom tab bar sits in a bottom safe-area inset. Composers that pin to the bottom use
  `.safeAreaInset(edge: .bottom)` too; the tab bar hides while the keyboard is up.

---

## 6. Shape

| Token | pt | Use for |
|---|---|---|
| `FBMetrics.radiusXS` | 4 | Progress bars, reply-quote bars, tiny tags |
| `FBMetrics.radiusSmall` | 6 | Badges that aren't capsules, inline media inside rows |
| `FBMetrics.radiusMedium` (= `cornerRadius`) | 8 | Buttons, inputs, thumbnails, listing photos, link cards |
| `FBMetrics.radiusLarge` | 12 | Cards, tiles, story cards, grouped sections, toasts |
| `FBMetrics.radiusXL` | 18 | Comment bubbles, chat bubbles, large pills |
| `Capsule()` | — | Chips, search fields, the composer pill, count badges |
| `Circle()` | — | Avatars, circle header buttons, reaction badges, symbol badges |

Always pass `style: .continuous` to `RoundedRectangle`. Chat bubbles flatten the joined corner to
`radiusXS` when consecutive messages stack.

---

## 7. Avatars

Always `AvatarView`; it handles the photo, initials fallback, story ring and online dot.

| Token | pt | Context |
|---|---|---|
| `FBAvatarSize.micro` | 16 | Read receipts |
| `.tiny` | 20 | `AvatarStack` (mutual friends, group members, reactors) |
| `.reply` | 28 | Comment replies, avatar beside chat bubbles |
| `.comment` | 32 | Top-level comments, chat header |
| `.story` | 36 | Stories tray, compact headers |
| `.post` | 40 | Post headers, composer bar, search results, menu profile row |
| `.compact` | 48 | Seller rows, two-line search results |
| `.row` | 60 | People lists, Messenger chats list, notifications, reactions list, logged-out account card |
| `.request` | 80 | Friend requests, People You May Know rows |
| `.hero` | 120 | Call screen, chat info |
| `.profile` | 168 | Profile page (with a 4 pt `surface` border) |

- Story ring: `ring: .story(seen:)` when `store.story(for:)` exists. Blue unseen, gray seen.
- Online dot: `showsOnline: true` in Messenger and people lists only.
- Pages use the same circle avatars.

---

## 8. Components

Reuse these. All live in `DesignSystem/` unless noted.

| Component | Use it for | Notes |
|---|---|---|
| `FBButtonStyle` | Every rectangular button | `.fbPrimary` (blue, one per area), `.fbSecondary` (gray), `.fbTinted` (light blue), `.fb(.outline)`, `.fb(.destructive)`. Heights: 36 default, 32 in compact rows, 40–44 for sheet-level primary actions. `expand: false` for inline buttons. |
| `CircleButton` | Header icon buttons | 36 pt gray circle; `badge:` for counts. Always pass `accessibilityLabel`. |
| `ChipView` | Filter chips | Gray when off, tinted blue when selected. Horizontal `ScrollView` row with 8 pt spacing and 16 pt edges. |
| `TabHeader` | Top of every tab root except Home | Title in `.fbTabTitle`, trailing `CircleButton`s. Home uses `FacebookWordmark` instead. |
| `SectionHeader` | Titles inside screens | Optional subtitle and "See all" action in `accent`. |
| `SearchField` | Every search input | Capsule, `inputBackground`, clear button. |
| `ComposerBar` | "What's on your mind?" | Home, own profile, friend's profile (`timelineOwner:`), groups (`group:`). |
| `PostCard` | Any post in any list | `Features/Post`. Put `FeedSeparator()` between cards. |
| `ReactionBadge`, `ReactionBadgeStack` | Reaction icons | Stack shows up to 3, most popular in front. |
| `BadgeCount` | Red counts on buttons and tabs | Caps at "99+". |
| `SymbolBadge` | White glyph on a colored circle | Notification badges, composer tool icons, menu tiles. |
| `VerifiedBadge`, `NameWithBadge` | Verified accounts | Never draw the seal by hand. |
| `FeedSeparator`, `HairlineDivider` | Separators | Use `HairlineDivider` instead of SwiftUI's `Divider()` everywhere except inside `Menu`/`contextMenu`. |
| `RemoteImage` | Every remote or picked image | Fills exactly its frame; size it from outside. |
| `PostSkeletonView`, `SkeletonBlock`, `.shimmering()` | Loading states | Never use a bare `ProgressView` for content that has a shape. |
| `ToastHost` | Toasts | Present by calling `store.showToast`. Add a host inside full-screen covers. |
| `LoopingVideoPlayer` | Feed video, Reels | Always with a poster `RemoteImage` underneath. |
| `ContentUnavailableView` | Empty states | Symbol + title + one-sentence description; add an action when there's an obvious next step. |
| `FlowLayout` | Wrapping chips and tags | |

---

## 9. Screen anatomy

| Kind | Navigation bar | Background | Examples |
|---|---|---|---|
| **Tab root** | Hidden (`.toolbar(.hidden, for: .navigationBar)`); `TabHeader` or the wordmark scrolls with content | `surface` for feeds, `background` for grouped | Home, Video, Friends, Marketplace, Notifications, Menu |
| **Pushed screen** | System bar, `.navigationBarTitleDisplayMode(.inline)`, title in sentence case | Matches content | Profile, Groups, Settings, listing detail |
| **Sheet** | Title row or inline nav bar | `surface` | Comments, share, options, filters |
| **Full-screen cover** | Custom top bar | Often `darkCanvas` or black | Messenger, composer, story creator and viewer, Reels, photo viewer, calls |

- Every tab root scrolls to top when its tab is tapped again (`router.scrollToTopSignal(for:)`).
- Feeds support pull to refresh. Infinite lists show a skeleton at the bottom while loading.
- Media pauses whenever its screen isn't visible (other tab selected, cover or sheet on top).
- **System bars across iOS versions.** `FBSystemBars.configure()` runs once at launch (from
  `RootView`). On iOS 17 and 18 it gives every navigation bar Facebook's opaque `surface`
  background, with a hairline only while content scrolls under it. Without it those versions
  show a grey band under the clock on grouped screens. iOS 26 keeps its own bars. A screen that
  sets `.toolbarBackground(...)` itself (Messenger chats) keeps its look. A tab root that hides
  its bar and needs a solid status-bar area uses `.fbStatusBarBackdrop()`. Use
  `UIColor.dynamic(light:dark:)` and `FBUIColor` for UIKit colors so they follow dark mode.
  `FB_LEGACY_BARS=1` (DEBUG) shows the iOS 17/18 bars on iOS 26.
- **Never move a feed the reader didn't move.** Content that arrives while someone is scrolled
  down waits behind the "New posts" pill and never inserts above them. Code scrolls a feed only
  when the reader re-taps its tab, taps the pill, or starts uploading their own post. To track
  down a jump, run with `FB_HOME_AUTOSCROLL_LOG=1` (DEBUG; `FBScrollLog`, `FBScrollProbe`): it
  logs every offset change no finger caused, with its call stack, to the console (`[HomeScroll]`)
  and to `tmp/home-autoscroll.log` in the app container. Release builds compile it out.

---

## 10. Interaction patterns

### Navigation

- Pushing a screen: `NavigationLink(value: Route...)` or `router.push(...)`. Never build ad hoc
  `NavigationStack`s inside pushed screens.
- Sheets that navigate get their own `NavigationStack` with `.appDestinations()` at the root.
- Chats always open in the Messenger cover: `router.openChat(store.conversation(with:))`.
- Close a sheet before presenting a cover; run the second action after ~0.35 s.

### Sheets

- `.presentationDetents([.medium, .large])` for menus and lists, `.large` for comments and
  composers, `.height(...)` only for short fixed menus.
- Always `.presentationDragIndicator(.visible)` on bottom sheets.
- Option sheets list rows as icon + title + optional subtitle, like Facebook's "..." sheet.

### Confirmations and feedback

- Destructive actions that lose content or relationships (delete post, unfriend, leave group, log out,
  discard a draft) use `confirmationDialog` with a destructive button. Low-stakes removals (a
  notification, a saved item) happen immediately, as in Facebook.
- Confirm completed actions with a toast when Facebook does: saved, shared, sent, copied, reported,
  snoozed, unfollowed, joined, deleted. Copy: sentence case, past tense or present state, no period,
  e.g. "Saved to your items", "Link copied".
- Reversible hides show an inline "Undo" instead of a toast.

### Lists

- Context menus mirror the "..." menu. Swipe actions: trailing = destructive or archive, leading =
  pin or mark read.
- Empty states use `ContentUnavailableView`. Loading uses skeletons for at least ~0.6 s so it doesn't
  flicker.

---

## 11. Motion and haptics

### Motion

| Situation | Animation |
|---|---|
| Buttons pressed | Scale 0.97, opacity 0.7–0.85, `.easeOut(0.12–0.15)` (built into the button styles) |
| Like, reaction chosen, follow | `.spring(response: 0.3, dampingFraction: 0.6)` pop on the icon |
| Reaction picker | Staggered springs in, hovered reaction scales up ~1.4× |
| Content appearing (toasts, rows, badges) | `.spring(response: 0.35, dampingFraction: 0.85)` with `.move` + `.opacity` |
| Images loading | `.easeOut(0.2)` fade |
| Selection changes (tabs, chips) | `.symbolEffect(.bounce)` on tab icons; `.easeInOut(0.2)` otherwise |

No animation longer than 0.5 s except looping indicators (skeleton shimmer, typing dots, audio disc).

### Haptics (`Haptics`, respects the Settings switch)

| Haptic | When |
|---|---|
| `.selection()` | Changing tabs, chips, segmented choices, hovering reactions |
| `.light()` | Like, follow, add friend, save, send, toggle |
| `.medium()` | Long-press menus opening, reaction picker opening |
| `.success()` | Posting, sharing, publishing a listing, confirming a request |
| `.warning()` | Destructive confirmations |

---

## 12. Content and copy

- Sentence case everywhere: "Add friend", "See all", "Today's picks". Never Title Case or ALL CAPS
  (except event date lines like "SAT, NOV 15", which Facebook capitalizes).
- Use Facebook's own phrasing: "What's on your mind?", "Write a comment...", "See more",
  "Create story", "People you may know", "Confirm"/"Delete", "Add to story", "Edit profile",
  "Send seller a message", "Hi, is this available?".
- Times: `fbShort` in feeds and rows ("5m", "2h", "Mar 3"), `fbLong` in detail screens and chat
  separators ("Yesterday at 4:12 PM"), `messengerShort` in the chats list.
- People: `actorsText` for groups of names ("Maria Lopez, Sam Lee and 3 others"). Use "their" in
  activity text ("updated their profile picture.").
- Mock content is fictional. Don't use real people, brands or trademarks in demo data.

---

## 13. Accessibility

- Every icon-only button has `.accessibilityLabel`. `CircleButton` requires one.
- Combine composite rows (`.accessibilityElement(children: .combine)`) so VoiceOver reads
  "Maria Lopez, 2 hours ago, Public" once.
- Selected chips and tabs add `.isSelected`; headers add `.isHeader`.
- Body text uses Dynamic Type tokens (section 3). Avoid fixed heights on text containers.
- Never rely on color alone: liked state changes the icon fill and the label color.
- Respect Reduce Motion (`@Environment(\.accessibilityReduceMotion)`) for large transforms such as
  3D rotation, parallax and zooms. The story viewer slides flat instead of turning a cube.
- Keep 44 pt tap targets.

---

## 14. Code conventions

- **State:** read and mutate through `AppStore` (`@Environment(AppStore.self)`); navigation through
  `Router`. Views hold only local UI state.
- **Naming:** feature types start with their module (`MarketplaceGridCell`, `PostHeaderView`). Only
  the entry points listed in `Router.swift` are unprefixed.
- **Files:** one screen per file, helpers `private` at the bottom, `#Preview` with
  `.previewEnvironment()`.
- **APIs:** iOS 17 SDK, Swift 5 mode. Keep `body` small and split views when an expression gets long;
  the compiler times out on big inline expressions.
- **No magic numbers** for color, font, radius or avatar size. Use the tokens in sections 2–7.

---

## 15. Design QA checklist

Run through this before merging a screen.

- [ ] Colors are `FBColor` tokens (or white/black over media); no `.secondary`, `.blue`, or hex in the feature
- [ ] Text uses `Font.fb*` tokens; any raw `.system(size:)` is display text with a comment
- [ ] Icons use `FBIconSize` and the symbol from the concept table
- [ ] Radii use `FBMetrics.radius*`, `Capsule` or `Circle`, with `.continuous`
- [ ] Avatars use `AvatarView` with an `FBAvatarSize`
- [ ] Gutters: 12 inside posts and modules, 16 at screen edges
- [ ] Buttons use `FBButtonStyle`; at most one blue primary button per area
- [ ] Tab roots: hidden nav bar, `TabHeader`, scroll to top, pull to refresh where it makes sense
- [ ] Pushed screens: inline title in sentence case
- [ ] Sheets: detents set and drag indicator visible
- [ ] Destructive actions confirm; completed actions toast or show Undo
- [ ] Haptics on meaningful taps (section 11)
- [ ] Empty, loading and error states exist
- [ ] Media pauses off screen
- [ ] Icon-only buttons have accessibility labels
- [ ] Checked in light and dark mode, at default and large Dynamic Type
