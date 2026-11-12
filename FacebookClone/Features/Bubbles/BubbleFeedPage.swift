import SwiftUI

/// What a feed page asks the tab to do.
struct BubbleFeedPageActions {
    var takeOver: () -> Void
    var like: (Bubble) -> Void
    var openBoard: (Bubble) -> Void
    var remix: (Bubble) -> Void
    var float: (Bubble) -> Void
    var save: (Bubble) -> Void
    var openProfile: (User) -> Void
}

/// One full-screen page of the Bubbles tab: the Bubble's cover or poster frame, the live
/// runtime when this page is the settled one, and the overlay (creator, title, rule, tags,
/// "Maya's best", Pop in) with the action rail.
struct BubbleFeedPage: View {
    let item: BubbleFeedItem
    let bubble: Bubble
    let model: BubbleFeedModel
    let actions: BubbleFeedPageActions

    @Environment(BubbleStore.self) private var bubbleStore

    private var isLive: Bool { model.isLive(item) }
    private var isTakenOver: Bool { isLive && model.isTakenOver }
    private var run: BubbleScore? { model.run(for: item, in: bubble) }

    var body: some View {
        ZStack {
            backdrop
            if isLive, let host = model.host {
                BubbleRuntimeHostView(host: host, isRevealed: model.isLiveRevealed, isInteractive: isTakenOver)
                    .accessibilityHidden(true)
            }
            if !isTakenOver {
                chrome
                    .transition(.opacity)
            }
        }
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Pop in", actions.takeOver)
    }

    // MARK: Layers

    /// The game itself, in its own look: the poster frame (an exact still of its first frame)
    /// once the runtime has drawn one, otherwise the Muse cover or `BubbleCoverView`.
    @ViewBuilder
    private var backdrop: some View {
        if let poster = model.poster(for: bubble) {
            ZStack {
                bubble.palette.gradient
                Image(uiImage: poster)
                    .resizable()
                    .scaledToFill()
            }
            .accessibilityHidden(true)
        } else {
            BubbleCoverView(bubble: bubble)
        }
    }

    private var chrome: some View {
        ZStack(alignment: .bottom) {
            // Taps anywhere on the game take over; buttons above it keep their own taps.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(perform: actions.takeOver)
                .accessibilityHidden(true)
            bottomScrim
            HStack(alignment: .bottom, spacing: 12) {
                BubbleFeedCaption(item: item, bubble: bubble, run: run, onPopIn: actions.takeOver, onOpenProfile: actions.openProfile)
                BubbleFeedRail(bubble: bubble, actions: actions)
            }
            .padding(.leading, FBMetrics.screenPadding)
            .padding(.trailing, 8)
            .padding(.bottom, 14)
        }
    }

    private var bottomScrim: some View {
        LinearGradient(
            colors: [Color.black.opacity(0), Color.black.opacity(0.62)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 360)
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
    }
}

// MARK: - Caption

/// Bottom-left: tags, creator, title and rule, whose run you're watching, and Pop in.
private struct BubbleFeedCaption: View {
    let item: BubbleFeedItem
    let bubble: Bubble
    let run: BubbleScore?
    let onPopIn: () -> Void
    let onOpenProfile: (User) -> Void

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !tags.isEmpty {
                BubbleFeedTags(tags: tags)
            }
            BubbleFeedCaptionSlots(bubble: bubble)
            creatorRow
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(bubble.title)
                        .font(.fbHeadline)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    if bubble.isMadeWithMuse {
                        MuseBadge(compact: true)
                    }
                }
                Text(bubble.rule)
                    .font(.fbBody)
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            bestLine
            popInButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadow(color: Color.black.opacity(0.35), radius: 3, y: 1)
    }

    private var creatorRow: some View {
        Button {
            onOpenProfile(bubble.creator)
        } label: {
            HStack(spacing: 8) {
                AvatarView(user: bubble.creator, size: FBAvatarSize.comment)
                    .overlay(Circle().stroke(Color.white.opacity(0.85), lineWidth: 1.5))
                Text(bubble.creator.isMe ? "You" : bubble.creator.name)
                    .font(.fbName)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Text("· \(bubble.createdAt.fbShort)")
                    .font(.fbMeta)
                    .foregroundStyle(Color.white.opacity(0.8))
                    .lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(bubble.creator.isMe ? "You" : bubble.creator.name), view profile")
    }

    @ViewBuilder
    private var bestLine: some View {
        HStack(spacing: 6) {
            Image(systemName: "trophy.fill")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(BubbleGlow.peach)
            Text(bestText)
                .font(.fbMetaEmphasized)
                .foregroundStyle(Color.white)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private var bestText: String {
        guard let run else { return "Be the first on the Bubble Board" }
        let name = run.user.isMe ? "Your" : "\(run.user.firstName)'s"
        let mine = bubbleStore.bestScore(of: bubbleStore.appStore.me, in: bubble)?.score
        if let mine, mine > run.score, !run.user.isMe {
            return "You beat \(run.user.firstName)'s \(run.score.withCommas)"
        }
        return "\(name) best: \(run.score.withCommas) · beat it"
    }

    private var popInButton: some View {
        Button(action: onPopIn) {
            HStack(spacing: 6) {
                Image(systemName: "hand.tap.fill")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                Text("Pop in")
                    .font(.fbButton)
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, 16)
            .frame(height: 36)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            .bubbleGlow(BubbleGlow.pink, radius: 8, opacity: 0.45)
            .contentShape(Capsule())
        }
        .buttonStyle(.pressable)
        .padding(.top, 4)
        .accessibilityLabel("Pop in to \(bubble.title)")
    }

    private var tags: [BubbleFeedTag] {
        var tags: [BubbleFeedTag] = []
        if bubble.isDaily {
            let group = bubble.group?.name
            tags.append(BubbleFeedTag(symbol: "sun.max.fill", text: group.map { "Daily Bubble · \($0)" } ?? "Daily Bubble"))
        }
        if bubble.isIcebreaker {
            let event = bubble.event.map(Self.shortEventTitle) ?? "your event"
            tags.append(BubbleFeedTag(symbol: "party.popper.fill", text: "Icebreaker for \(event)"))
        }
        if let level = bubble.levelIndex, bubble.chainID != nil {
            tags.append(BubbleFeedTag(symbol: "link", text: "Level \(level)"))
        }
        switch item.reason {
        case .nearby:
            if let place = bubbleStore.neighborhood(of: bubble.creator) {
                tags.append(BubbleFeedTag(symbol: "location.fill", text: "New near you · \(place)"))
            } else {
                tags.append(BubbleFeedTag(symbol: "location.fill", text: "New near you"))
            }
        case .groupBurst:
            if !bubble.isDaily, let group = bubble.group ?? bubbleStore.boardGroups(for: bubble).first {
                tags.append(BubbleFeedTag(symbol: "person.3.fill", text: group.name))
            }
        case .yours where tags.isEmpty:
            tags.append(BubbleFeedTag(symbol: "person.crop.circle", text: "Your Bubble"))
        default:
            break
        }
        return tags
    }

    /// "Newcomers' picnic in Dolores Park" → "Newcomers' picnic".
    private static func shortEventTitle(_ event: FBEvent) -> String {
        if let range = event.title.range(of: " in ") {
            return String(event.title[..<range.lowerBound])
        }
        return event.title
    }
}

private struct BubbleFeedTag: Hashable {
    let symbol: String
    let text: String
}

private struct BubbleFeedTags: View {
    let tags: [BubbleFeedTag]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(tags, id: \.self) { tag in
                HStack(spacing: 4) {
                    Image(systemName: tag.symbol)
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                    Text(tag.text)
                        .font(.fbCaptionEmphasized)
                        .lineLimit(1)
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.black.opacity(0.32), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 0.5))
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Action rail

/// Right side: save (saves are the likes), Bubble Board, Remix and float.
private struct BubbleFeedRail: View {
    let bubble: Bubble
    let actions: BubbleFeedPageActions

    @State private var saveBounce = 0

    var body: some View {
        VStack(spacing: 14) {
            BubbleFeedRailButton(
                symbol: bubble.isSaved ? "bookmark.fill" : "bookmark",
                label: bubble.saveCount.fbCompact,
                tint: bubble.isSaved ? Color(hex: 0x6EA8FF) : Color.white,
                bounce: saveBounce,
                accessibility: bubble.isSaved ? "Unsave" : "Save",
                value: "\(bubble.saveCount) saves"
            ) {
                saveBounce += 1
                actions.save(bubble)
            }
            BubbleFeedRailButton(symbol: "trophy.fill", label: "Board", accessibility: "Bubble Board") {
                actions.openBoard(bubble)
            }
            BubbleFeedRailButton(symbol: "wand.and.stars", label: "Remix", accessibility: "Remix with Muse") {
                actions.remix(bubble)
            }
            BubbleFeedRailButton(symbol: "arrowshape.turn.up.right.fill", label: "Float", accessibility: "Float this Bubble") {
                actions.float(bubble)
            }
        }
        .padding(.bottom, 4)
    }
}

private struct BubbleFeedRailButton: View {
    let symbol: String
    let label: String
    var tint: Color = Color.white
    var bounce = 0
    let accessibility: String
    var value: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.xxl, weight: .semibold))
                    .foregroundStyle(tint)
                    .symbolEffect(.bounce, value: bounce)
                    .frame(width: 44, height: 38)
                Text(label)
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(minWidth: 52)
            .shadow(color: Color.black.opacity(0.4), radius: 3, y: 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility)
        .accessibilityValue(value ?? "")
    }
}
