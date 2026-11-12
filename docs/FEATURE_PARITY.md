# Facebook Feature Parity

How this clone maps to the Facebook iOS app, area by area. Use it to see what's covered, what's
simplified, and what's left.

**Status:** **Done** = works like the real app (with mock data) · **Partial** = present but simplified ·
**Not in demo** = missing, or shows a "not available in this demo" toast / Coming Soon page.

Front-end only by design: there's no server, so "network" behavior (replies, reactions, friend
accepts, new notifications, uploads) is simulated in `AppStore`.

## Summary

| Area | Done | Partial | Not in demo |
|---|---|---|---|
| Navigation and shell | 7 | 0 | 2 |
| News Feed | 15 | 1 | 0 |
| Posts and engagement | 22 | 1 | 2 |
| Creating posts | 11 | 1 | 1 |
| Stories | 9 | 1 | 2 |
| Video and Reels | 9 | 0 | 2 |
| Messenger | 16 | 1 | 4 |
| Friends and profiles | 15 | 2 | 4 |
| Notifications | 9 | 0 | 1 |
| Groups, Events, Pages | 13 | 2 | 4 |
| Marketplace | 12 | 1 | 2 |
| Menu, Settings, more | 14 | 2 | 6 |
| Platform standards | 9 | 4 | 5 |

## Navigation and shell

| Facebook | Status | Where |
|---|---|---|
| Bottom tab bar: Home, Video, Friends, Marketplace, Notifications, Menu (avatar) | Done | `App/MainTabView.swift` |
| Red count badges on tabs | Done | Notifications and Friends tabs |
| Tap the current tab to scroll to top / pop to root | Done | `Router.select(_:)` |
| Header: "facebook" wordmark, +, search, Messenger with unread badge | Done | `Features/Home/HomeView.swift` |
| Each tab keeps its own navigation stack and scroll position | Done | `MainTabView` keeps every tab alive |
| Splash screen ("from Meta") | Done | `App/RootView.swift` |
| Logged-out saved-account screen | Done | Tap your profile to log back in |
| Login with password, sign-up | Not in demo | Deliberately omitted: no credential fields |
| Account switching | Not in demo | |

## News Feed

| Facebook | Status | Where |
|---|---|---|
| "What's on your mind?" composer row | Done | `ComposerBar` |
| Stories tray (create story, your story, friends, seen state) | Done | `Home/HomeStoriesTray.swift` |
| Mixed post types in one feed | Done | See "Posts" below |
| Reels tray in the feed | Done | `Home/HomeFeedModules.swift` |
| People You May Know carousel | Done | `Home/HomeFeedModules.swift` |
| Suggested groups carousel | Done | `Home/HomeFeedModules.swift` |
| Birthday card | Done | `Home/HomeFeedModules.swift` |
| Sponsored posts with CTA | Done | `PostSponsoredStrip` |
| Loading skeletons | Done | `PostSkeletonView` |
| Pull to refresh with fresh posts | Done | `AppStore.refreshFeed()` |
| Infinite scroll from a preload buffer, with image prefetch | Done | `AppStore.loadMoreFeedIfNeeded` |
| "New posts" pill | Done | `HomeView` |
| Hide post with Undo, snooze 30 days, unfollow | Done | `PostHiddenView`, options sheet |
| Feeds tab: All, Favorites, Friends, Groups, Pages | Done | `More/FeedsView.swift` |
| Ranked feed | Partial | Mock feed is time-ordered with variety; no ranking model |
| "Why am I seeing this post?" / "...this ad?" | Done | Options sheet; the reason names the group, Favorite, Page or friend |

## Posts and engagement

| Facebook | Status | Where |
|---|---|---|
| Header: avatar with story ring, name, verified, time, audience icon | Done | `PostHeaderView` |
| Context lines: group, feeling, check-in, tagged friends, timeline, activity | Done | `PostHeaderView` |
| Text with inline "See more", hashtags and mentions | Done | `PostTextView` |
| Colored-background text posts | Done | `PostBackgroundText` |
| Photo grids (1–5+, "+N") | Done | `PostMediaGrid` |
| Autoplaying muted video with mute toggle and time left | Done | `PostVideoView` |
| Link previews | Done | `PostLinkPreviewCard` |
| Shared posts | Done | `PostSharedPostView` |
| Polls with live results | Done | `PostPollView` |
| Life events, profile/cover photo updates | Done | `PostLifeEventView`, activity text |
| Upload progress for new posts | Done | `PostUploadBar` |
| Like with tap; 7 reactions with long-press and drag | Done | `PostActionBar`, `PostReactionPicker` |
| Reaction summary ("You and 1.2K others") and who reacted | Done | `PostCountsRow`, `ReactionsListView` |
| Comment and share counts | Done | `PostCountsRow` |
| Threaded comments, replies, comment reactions | Done | `CommentsView`, `PostCommentRow` |
| Edit and delete your comments | Done | Comment context menu |
| Comment sorting (Most relevant, Newest, All) | Done | `PostCommentsHeader` |
| Share now, send in Messenger, share to story or group, copy link | Done | `ShareSheetView` |
| Save post, post notifications, add to Favorites | Done | `PostOptionsSheet` |
| Edit post, change audience, delete post | Done | `PostOptionsSheet` |
| Report post | Done | Confirmation, then hidden with a toast |
| Hide reaction counts (setting) | Done | `SettingsKey.showReactionCounts` |
| Full-screen photo viewer with zoom and swipe-to-dismiss | Done | `PhotoViewer` |
| Post detail screen | Done | `PostDetailView` |
| GIF and sticker comments | Partial | Buttons show a "not in this demo" toast |
| Translations ("See translation") | Not in demo | Mock content is English only |
| Live video posts | Not in demo | |

## Creating posts

| Facebook | Status | Where |
|---|---|---|
| Composer with audience picker | Done | `Home/CreatePostView.swift` |
| Colored backgrounds for short text | Done | `HomeBackgroundSwatchRow` |
| Multiple photos from the library | Done | `PhotosPicker` |
| Feeling / activity | Done | `HomeFeelingPicker` |
| Tag friends | Done | `HomeTagPeopleSheet` |
| Check in | Done | `HomeCheckInSheet` |
| Polls | Done | `HomePollEditor` |
| Post in a group, write on a friend's profile | Done | `CreatePostRequest` |
| Share with a comment ("Write post") | Done | `CreatePostRequest.sharedPost` |
| Edit an existing post | Done | `CreatePostRequest.editingPost` |
| Save draft / discard | Done | Discard dialog |
| "+" create menu | Partial | Post, Story and Event work; Reel, Live and Note show toasts |
| GIFs, events, Marketplace items as attachments | Not in demo | |

## Stories

| Facebook | Status | Where |
|---|---|---|
| Text stories on gradient backgrounds | Done | `HomeTextStoryEditor` |
| Photo stories with caption, text and stickers | Done | `HomePhotoStoryEditor` |
| Viewer with progress bars, tap to skip, hold to pause | Done | `StoryViewer` |
| Swipe between people (cube transition), swipe down to close | Done | `StoryViewer` |
| Reply and quick reactions (go to Messenger) | Done | `AppStore.replyToStory` |
| Seen/unseen rings | Done | `AvatarView(ring:)` |
| Your viewer count, delete a story item | Done | `StoryViewer` |
| New friend stories appear while the app is open | Done | Ambient activity |
| Mute a person's stories | Done | Toast |
| Music, Boomerang, Selfie, AI images | Partial | Tiles show toasts |
| Story privacy settings, highlights / archive | Not in demo | |
| Camera capture | Not in demo | Library photos only |

## Video and Reels

| Facebook | Status | Where |
|---|---|---|
| Video tab with chips (For you, Live, Reels, Following, Saved) | Done | `Video/VideoTabView.swift` |
| One autoplaying video at a time, mute toggle, progress | Done | `VideoPlaybackTracker` |
| LIVE badges with viewer counts | Done | Mock live videos |
| Full-screen player with scrubbing and ±10 s | Done | `VideoFullScreenPlayer` |
| Reels vertical paging | Done | `ReelsView` |
| Tap/hold to pause, double-tap to like | Done | `ReelsPage` |
| Like, comment, share, follow, audio title, caption | Done | `ReelsPage` |
| Save, not interested, report | Done | `ReelsOptionsSheet` |
| Pause when off screen or another tab is selected | Done | Playback rules |
| Create or remix a reel | Not in demo | Toast |
| Real vertical video content | Not in demo | Sample clips are horizontal, cropped to fill |

## Messenger

| Facebook | Status | Where |
|---|---|---|
| Chats list with search | Done | `ChatsListView` |
| Active-now row and notes | Done | `ChatsListView` |
| Filters: All, Unread, Groups, Archived | Done | `MessengerInboxFilter` |
| Pin, mute, archive, delete, mark unread | Done | Swipe actions and context menu |
| New message and group chats | Done | `MessengerNewMessageSheet` |
| Grouped bubbles and timestamp separators | Done | `MessengerBubble` |
| Photos, big emoji, quick emoji | Done | Composer |
| Reply quotes and swipe to reply | Done | `MessengerReplyQuote` |
| Message reactions and reaction details | Done | `MessengerMessageMenu` |
| Unsend, copy, forward | Done | Forward shows a toast |
| Typing indicator | Done | Simulated |
| Sending, sent, delivered, seen receipts | Done | Simulated |
| Themes (10) and quick-emoji choice | Done | `MessengerChatInfoSheet` |
| Search in conversation | Done | `ChatView` |
| Audio and video calls | Done | Mock call screen |
| Simulated replies, context-aware for Marketplace | Done | `MockDataFactory.replyText` |
| Notes persist | Partial | Kept only while Messenger is open |
| Voice messages, stickers and GIFs | Not in demo | |
| Vanish mode, polls in chat | Not in demo | |
| Message requests folder | Not in demo | |
| End-to-end encryption UI | Not in demo | |

## Friends and profiles

| Facebook | Status | Where |
|---|---|---|
| Friend requests: confirm, delete | Done | `FriendsView`, `FriendRequestsView` |
| People You May Know: add, remove, cancel | Done | `FriendSuggestionsView` |
| Sent requests | Done | `FriendRequestsView` |
| Your friends: search, sort, message, unfollow, unfriend | Done | `AllFriendsView` |
| Requests get accepted while you use the app | Done | Simulated |
| Profile: cover, picture, story ring, bio, friend count | Done | `ProfileView` |
| Change profile picture and cover photo | Done | `PhotosPicker` |
| Profile tabs: Posts, About, Photos, Reels (Videos for Pages) | Done | `ProfileView` |
| Details, Featured, Friends grid | Done | `ProfilePostsSection` |
| Friendship button states (Add, Cancel, Respond, Friends) | Done | `ProfileActionButtons` |
| Message from a profile | Done | Opens Messenger |
| Favorites, follow/unfollow | Done | Friends menu |
| Edit profile (bio limit, details, relationship) | Done | `EditProfileView` |
| Pages as profiles (follow, category, followers) | Done | `ProfileView` |
| Write on a friend's profile | Done | `ComposerBar(timelineOwner:)` |
| View as, block, report | Partial | Toasts |
| Activity log | Partial | Coming Soon page |
| Profile lock, professional mode | Not in demo | |
| Story highlights on profile | Not in demo | |
| Close Friends and custom friend lists | Not in demo | |
| Avatars | Not in demo | Coming Soon page |

## Notifications

| Facebook | Status | Where |
|---|---|---|
| New and Earlier sections | Done | `NotificationsView` |
| Unread highlight, blue dot, unread filter | Done | `NotificationsRow` |
| Kind badges on avatars (reactions, comments, groups, birthdays...) | Done | `NotificationsKindStyle` |
| Bold names with "and N others" | Done | `AppNotification.actorsText` |
| Confirm/Delete friend requests inline | Done | `NotificationsRow` |
| Per-row menu: mark read/unread, remove, turn off similar | Done | Dialog, swipe, context menu |
| Deep links to post, profile, group, event, listing, birthdays, memories | Done | `NotificationsView` |
| Mark all as read | Done | Header menu |
| Live notifications while you use the app | Done | Simulated |
| Push notifications | Not in demo | No backend |

## Groups, Events, Pages

| Facebook | Status | Where |
|---|---|---|
| Groups feed from your groups | Done | `GroupsView` |
| Discover and join/leave groups | Done | `GroupsView`, `GroupDetailView` |
| Group page: cover, privacy, members, About, Media | Done | `GroupDetailView` |
| Post in a group | Done | `ComposerBar(group:)` |
| Private groups lock their posts until you join | Done | `GroupDetailView` |
| Invite friends | Done | Friend picker, then a toast |
| Events list with chips | Done | `EventsView` |
| Going / Interested / Can't go | Done | `AppStore.respond` |
| Event details with map, hosts, friends going | Done | `EventDetailView` |
| Online events | Done | Mock data |
| Pages you follow and discover | Done | `PagesView` |
| Follow/unfollow Pages | Done | `AppStore.follow` |
| Message a Page | Done | Chats with simulated replies |
| Create a group, event or Page | Partial | Forms or toasts only |
| Add to calendar | Partial | Toast |
| Group admin tools, rules, chats | Not in demo | |
| Page reviews, shop, services | Not in demo | |
| Event tickets, cohosts | Not in demo | |
| Group events tab content | Not in demo | Empty state |

## Marketplace

| Facebook | Status | Where |
|---|---|---|
| Today's picks grid | Done | `MarketplaceView` |
| Categories | Done | `MarketplaceCategoriesSheet`, `MarketplaceCategoryView` |
| Search and filters (price, condition, sort) | Done | `MarketplaceFilterSheet` |
| Location radius on a map | Done | `MarketplaceLocationSheet` |
| Price drops, "Just listed", sold/pending badges | Done | `MarketplaceGridCell` |
| Listing detail with photo pager | Done | `ListingDetailView` |
| Message seller with quick replies | Done | Seller replies in Messenger |
| Save, share listings | Done | |
| Seller info and ratings | Done | Mock ratings |
| Similar items | Done | `ListingDetailView` |
| Sell an item (photos, price, category, condition) | Done | `MarketplaceSellView` |
| Your listings: mark sold, delete | Done | `MarketplaceYouView` |
| Recently viewed | Partial | Kept for the session |
| Shipping and checkout | Not in demo | |
| Vehicle and rental-specific forms | Not in demo | |

## Menu, Settings and more

| Facebook | Status | Where |
|---|---|---|
| Menu: profile card, shortcuts grid, See more | Done | `MenuView` |
| Help & support, Settings & privacy sections | Done | `MenuCollapsibleSection` |
| Dark mode: On, Off, System | Done | `MenuDarkModeSheet`, Settings |
| Log out | Done | Confirmation |
| Settings search | Done | `SettingsView` |
| Autoplay, data saver, haptics, sounds | Done | `SettingsKey` |
| Hide reaction counts, active status | Done | `SettingsKey` |
| Notification types | Done | `SettingsNotificationTypesView` |
| News Feed preferences: Favorites, Snoozed, Unfollowed | Done | `SettingsScreens.swift` |
| Your time on Facebook (chart, reminders, quiet mode) | Done | `SettingsTimeView` |
| Clear search history | Done | `AppStore.clearRecentSearches` |
| Saved items and collections | Done | `SavedView` |
| Memories ("On this day") | Done | `MemoriesView` |
| Birthdays (today, upcoming) | Done | `BirthdaysView` |
| Search: recent, people, posts, groups, pages, Marketplace, events | Done | `SearchView` |
| Accounts Center, privacy checkup, language | Partial | Coming Soon pages |
| Saved collections | Partial | Mock collections |
| Gaming, Dating, Fundraisers, Ads Manager | Not in demo | Coming Soon pages |
| Climate Science Center, Avatars | Not in demo | Coming Soon pages |
| Blocking list | Not in demo | |
| Two-factor, password, security | Not in demo | |
| Off-Facebook activity, ad preferences | Not in demo | |
| Professional dashboard | Not in demo | |

## Platform standards

| Standard | Status | Notes |
|---|---|---|
| Dark mode on every screen | Done | All colors are dynamic `FBColor` tokens |
| Design tokens for color, type, icons, spacing, radius, avatars | Done | See `docs/STYLE_GUIDE.md` |
| Haptic feedback | Done | `Haptics`, respects the Settings switch |
| Skeleton loading and image placeholders | Done | `PostSkeletonView`, `RemoteImage` |
| Image cache, request de-duplication, prefetching | Done | `ImageLoader` |
| Works offline with placeholders | Done | Initials and gray placeholders |
| Toast confirmations | Done | `ToastHost` |
| Empty states | Done | `ContentUnavailableView` |
| Media pauses off screen | Done | Tab-aware playback |
| Dynamic Type | Partial | Body text scales; titles and some labels are fixed sizes |
| VoiceOver labels | Partial | Icon buttons and rows are labeled; not audited end to end |
| Settings persistence | Partial | Settings and recent searches persist; content resets on launch |
| Reduce Motion | Partial | The story viewer drops its 3D cube; smaller springs still animate |
| Localization | Not in demo | English only |
| iPad and landscape | Not in demo | iPhone, portrait |
| Deep links / universal links | Not in demo | |
| Widgets, share extension | Not in demo | |
| Push notifications | Not in demo | |
