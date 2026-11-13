import SwiftUI

// Pre-wired slots (docs/BUBBLES.md 7.1). Shared screens call one composite view per spot; each
// composite stacks the features' slot views in a fixed order. Every slot view lives in its
// feature's own `<Feature>Slots.swift` and starts as EmptyView, so implementers fill in only their
// own files and never edit the shared screens or this file.
//
// Spot                          Where it's called                         Order
// BubbleResultInfoSlots         BubbleResultSheet, under the hero         length, challenge, story, learn, nextline
// BubbleResultActionSlots       BubbleResultSheet, above Play again       challenge, saves, remix
// BubbleFeedCaptionSlots        (unused: the feed caption merges these into one meta line and one social line)
// BubbleDetailSlots             BubbleDetailView, under the actions       length, saves, challenge, together, remix, story, learn, nextline
// BubblePlayerTopBarSlots       BubblePlayerView top bar, before mute     saves
// BubblePlayerBannerSlots       BubblePlayerView, under the top bar       challenge, nextline
// BubbleGroupFeaturedSlots      BubbleGroupSection (Featured tab)         groups-search, nextline
// BubbleGroupGamesTab           GroupDetailView "Games" tab               groups-search hub, nextline, learn, together, groups-search list
// BubbleProfileHeaderSlots      ProfileView header, under the actions     bracket, challenge
// BubbleProfileSectionSlots     BubbleProfileSection (Bubbles tab), top   together, learn
// BubbleFriendRowSlots          AllFriendsView rows, before the menu      challenge
// BubbleLibraryHeaderSlots      BubbleLibraryView, above the sections     saves, learn
// StudioAskSlots                StudioAskStep, under the examples        together, story, learn
// StudioTrySlots                StudioTryStep, under the details card    length
// BubbleChatCardView            MessengerBubble and PostCard              by card kind (see below)

/// Everything a result-sheet slot needs.
struct BubbleResultSlotContext {
    let result: BubbleResultContext
    let bubble: Bubble
    /// How the play started (challenge, session, game night…); nil for a plain play.
    let play: BubblePlayContext?
    /// The player's request (seed, length, context); nil when the sheet shows from the feed.
    let request: BubblePlayRequest?
    let playAgain: () -> Void
    /// Closes the player, then runs the action (open Studio, a chat, a page). Nil outside the
    /// player: run the action directly.
    let exitPlayer: ((@escaping () -> Void) -> Void)?

    /// Runs `action` after leaving the player when there is one.
    func leavingPlayer(_ action: @escaping () -> Void) {
        if let exitPlayer {
            exitPlayer(action)
        } else {
            action()
        }
    }
}

// MARK: - Result sheet

struct BubbleResultInfoSlots: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        LengthResultLabel(slot: slot)
        ChallengeResultHeadToHead(slot: slot)
        StoryResultEndings(slot: slot)
        LearnResultRecap(slot: slot)
        NextlineResultSummary(slot: slot)
    }
}

struct BubbleResultActionSlots: View {
    let slot: BubbleResultSlotContext

    var body: some View {
        // Challenge Me first: it's the card's primary action.
        ChallengeResultAction(slot: slot)
        SavesResultAction(slot: slot)
        RemixResultAction(slot: slot)
    }
}

// MARK: - Feed, detail, player

struct BubbleFeedCaptionSlots: View {
    let bubble: Bubble

    var body: some View {
        BubbleCategoryChip(category: bubble.category, onDark: true)
        LengthCaptionLabel(bubble: bubble)
        RemixCaptionCredit(bubble: bubble)
        SavesCaptionProof(bubble: bubble)
    }
}

struct BubbleDetailSlots: View {
    let bubble: Bubble

    var body: some View {
        LengthDetailRow(bubble: bubble)
        SavesDetailStats(bubble: bubble)
        ChallengeDetailRow(bubble: bubble)
        TogetherDetailCredits(bubble: bubble)
        RemixDetailTree(bubble: bubble)
        StoryDetailEndings(bubble: bubble)
        LearnDetailMastery(bubble: bubble)
        NextlineDetailRow(bubble: bubble)
    }
}

struct BubblePlayerTopBarSlots: View {
    let bubble: Bubble
    let request: BubblePlayRequest

    var body: some View {
        SavesPlayerButton(bubble: bubble, request: request)
    }
}

/// True once your run has started (the intro card is gone), so banners can start their clocks.
private struct BubblePlayerStartedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Set by `BubblePlayerView` on the banner slots: whether your run has started.
    var bubblePlayerStarted: Bool {
        get { self[BubblePlayerStartedKey.self] }
        set { self[BubblePlayerStartedKey.self] = newValue }
    }
}

struct BubblePlayerBannerSlots: View {
    let bubble: Bubble
    let request: BubblePlayRequest
    /// Your live score.
    let score: Int

    var body: some View {
        ChallengePlayerBanner(bubble: bubble, request: request, score: score)
        NextlinePlayerBanner(bubble: bubble, request: request, score: score)
    }
}

// MARK: - Groups, profiles, friends, Library

struct BubbleGroupFeaturedSlots: View {
    let group: FBGroup

    var body: some View {
        GroupsSearchFeaturedTeaser(group: group)
        NextlineFeaturedBanner(group: group)
    }
}

/// The Group page's "Games" tab.
struct BubbleGroupGamesTab: View {
    let group: FBGroup

    var body: some View {
        VStack(spacing: 0) {
            GroupsSearchGamesHub(group: group)
            NextlineGroupGameNight(group: group)
            LearnGroupMastery(group: group)
            TogetherGroupMakeRow(group: group)
            GroupsSearchGamesList(group: group)
        }
    }
}

struct BubbleProfileHeaderSlots: View {
    let user: User

    var body: some View {
        // Someone you just met: the get-to-know bracket comes first.
        BracketProfileCard(user: user)
        PairBlendProfileButton(user: user)
        ChallengeProfileRivalry(user: user)
    }
}

struct BubbleProfileSectionSlots: View {
    let user: User

    var body: some View {
        TogetherProfileAboutMe(user: user)
        LearnProfileStreak(user: user)
    }
}

struct BubbleFriendRowSlots: View {
    let user: User

    var body: some View {
        ChallengeFriendButton(user: user)
    }
}

struct BubbleLibraryHeaderSlots: View {
    var body: some View {
        SavesLibraryStats()
        LearnLibraryStreaks()
    }
}

// MARK: - Studio

struct StudioAskSlots: View {
    let model: StudioModel

    var body: some View {
        TogetherStudioEntry(model: model)
        StoryStudioEntry(model: model)
        LearnStudioEntry(model: model)
    }
}

struct StudioTrySlots: View {
    let model: StudioModel

    var body: some View {
        LengthCustomizePanel(model: model)
    }
}

// MARK: - Playable cards

/// Where a playable card is shown.
enum BubbleChatCardPlacement {
    /// A Messenger message.
    case chat(messageID: String, isFromMe: Bool)
    /// A Group or feed post.
    case post(Post)

    var isFromMe: Bool {
        if case .chat(_, let fromMe) = self { return fromMe }
        return false
    }
}

/// A playable card in a chat or a post. Each kind is drawn by the feature that owns it; kinds
/// whose feature hasn't landed yet fall back to `BubbleChatCardFallback`.
struct BubbleChatCardView: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    var body: some View {
        switch card.kind {
        case .challenge, .session, .share: ChallengeCardBody(card: card, placement: placement)
        case .remix: RemixCardBody(card: card, placement: placement)
        case .contribution: TogetherCardBody(card: card, placement: placement)
        case .gameNight: NextlineCardBody(card: card, placement: placement)
        case .storyPath: StoryCardBody(card: card, placement: placement)
        case .lesson: LearnCardBody(card: card, placement: placement)
        }
    }
}

/// The plain playable card: cover, headline, and Play (the card's seed and length).
struct BubbleChatCardFallback: View {
    let card: BubbleChatCard
    let placement: BubbleChatCardPlacement

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let bubble = bubbleStore.bubble(id: card.bubbleID)
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if let bubble {
                    BubbleCoverView(bubble: bubble, showsEmoji: true)
                } else {
                    BubbleGlow.lilacHaze.gradient
                }
            }
            .frame(height: 120)
            .frame(maxWidth: .infinity)
            .clipped()
            VStack(alignment: .leading, spacing: 8) {
                Text(card.headline)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Haptics.light()
                    BubbleSocialHub.play(card, router: router)
                } label: {
                    Label("Play", systemImage: "play.fill")
                }
                .buttonStyle(.fb(.primary, height: 36))
                .disabled(bubble == nil)
            }
            .padding(12)
        }
        .frame(width: placement.isPost ? nil : 260)
        .background(FBColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 1)
        )
        .padding(placement.isPost ? EdgeInsets(top: 0, leading: FBMetrics.gutter, bottom: 8, trailing: FBMetrics.gutter) : EdgeInsets())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.headline)
    }
}

private extension BubbleChatCardPlacement {
    var isPost: Bool {
        if case .post = self { return true }
        return false
    }
}

// MARK: - Category chip

/// "Adventure", "Quiz night" or "Learn" next to the formula. Draws nothing for `.play`.
struct BubbleCategoryChip: View {
    let category: BubbleCategory
    /// White on a dark scrim (feed pages) instead of the light pill.
    var onDark = false

    var body: some View {
        if category != .play {
            HStack(spacing: 4) {
                Image(systemName: category.symbol)
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(category.title)
                    .font(.fbCaptionEmphasized)
                    .lineLimit(1)
            }
            .foregroundStyle(onDark ? Color.white : FBColor.primaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(onDark ? Color.black.opacity(0.32) : FBColor.tintedBlueBackground, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Category: \(category.title)")
        }
    }
}
