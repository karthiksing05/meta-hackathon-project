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

/// One full-screen page of the games tab: the game's cover or poster frame, the live runtime
/// when this page is the settled one, and a calm overlay: one meta line, creator, title and rule,
/// one social line, and the action rail. Tapping the game plays it; a quiet "Tap to play" hint
/// shows for the first few games.
struct BubbleFeedPage: View {
    let item: BubbleFeedItem
    let bubble: Bubble
    let model: BubbleFeedModel
    let actions: BubbleFeedPageActions

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showsTapHint = false
    @State private var showsSaveTip = false

    private var isLive: Bool { model.isLive(item) }
    private var isTakenOver: Bool { isLive && model.isTakenOver }
    private var run: BubbleScore? { model.run(for: item, in: bubble) }
    private var failure: EngineFailure? { model.failedItemID == item.id ? model.failure : nil }
    /// This page is settled, its game has drawn, and nobody is playing yet.
    private var isSettled: Bool { isLive && model.isLiveRevealed && !model.isTakenOver && failure == nil }

    var body: some View {
        ZStack {
            backdrop
            if isLive, let host = model.host {
                BubbleRuntimeHostView(host: host, isRevealed: model.isLiveRevealed, isInteractive: isTakenOver)
                    .accessibilityHidden(true)
                // The poster stays over the live game until its session has drawn, then fades, so
                // the page never pops from the poster to the game (or shows a failed runtime page).
                PosterReveal(poster: model.poster(for: bubble), isLive: model.isLiveRevealed, showsLoader: false) {
                    BubbleCoverView(bubble: bubble)
                }
                .accessibilityHidden(true)
                EngineLoadingView(
                    isLoading: !model.isLiveRevealed && failure == nil,
                    label: EngineLoadingView.label(for: bubble.manifest),
                    style: .pill
                )
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, model.insetTop + 12)
            }
            if !isTakenOver {
                // Sponsored pages carry their "Ad" tag in the creator row, not over the game.
                chrome
                    .transition(.opacity)
            }
            if let failure {
                EngineErrorCard(failure: failure, onRetry: model.retry)
                    .transition(.opacity)
            }
        }
        .animation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion), value: failure)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Play", play)
        .task(id: isSettled) { await runHints() }
    }

    /// The library sound behind this game, when the server gave it one.
    private var sound: RemoteGameSound? { bubbleStore.librarySound(for: bubble) }

    private func openSound() {
        guard let sound else { return }
        router.push(.sound(sound.id))
    }

    /// Starts the game in place, and counts it toward retiring the "Tap to play" hint.
    private func play() {
        showsTapHint = false
        if item.sponsor != nil {
            FeedEventReporter.shared.sponsorTap(gameID: bubble.id)
        }
        FeedHints.notePlayed()
        actions.takeOver()
    }

    /// One hint at a time, each shown once and gone on its own: "Tap to play" ~1 s after the page
    /// settles (first few games only), then the save tip once ever, never on the first page.
    private func runHints() async {
        guard isSettled else {
            showsTapHint = false
            showsSaveTip = false
            return
        }
        let animation = GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion)
        let fade = GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion)
        let isFirstPage = FeedHints.noteSettled()
        if FeedHints.wantsTapHint {
            guard await FeedHints.wait(1.0) else { return }
            withAnimation(animation) { showsTapHint = true }
            guard await FeedHints.wait(3.5) else { return }
            withAnimation(fade) { showsTapHint = false }
        }
        guard !isFirstPage, SavesHintCenter.shared.isVisible else { return }
        guard await FeedHints.wait(1.2), SavesHintCenter.shared.isVisible else { return }
        // Counts as seen the moment it shows, so it never comes back.
        SavesHintCenter.shared.dismiss()
        withAnimation(animation) { showsSaveTip = true }
        guard await FeedHints.wait(4) else { return }
        withAnimation(fade) { showsSaveTip = false }
    }

    // MARK: Layers

    /// The game itself, in its own look: the poster frame (an exact still of its first frame)
    /// once the runtime has drawn one, otherwise the Muse cover or `BubbleCoverView`.
    /// The cover is always underneath; when the poster arrives it crossfades in over it instead of
    /// replacing it in one frame.
    private var backdrop: some View {
        let poster = model.poster(for: bubble)
        return ZStack {
            BubbleCoverView(bubble: bubble)
            if let poster {
                ZStack {
                    bubble.palette.gradient
                    Image(uiImage: poster)
                        .resizable()
                        .scaledToFill()
                }
                .transition(.opacity)
            }
        }
        .animation(GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion), value: poster != nil)
        .accessibilityHidden(true)
    }

    private var chrome: some View {
        ZStack(alignment: .bottom) {
            // Taps anywhere on the game play it; buttons above it keep their own taps.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(perform: play)
                .accessibilityHidden(true)
            bottomScrim
            if showsTapHint && item.sponsor == nil {
                FeedTapToPlayHint()
                    .frame(maxHeight: .infinity)
                    .offset(y: 120)
                    .transition(.opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.92)))
            }
            HStack(alignment: .bottom, spacing: 12) {
                BubbleFeedCaption(item: item, bubble: bubble, run: run, sound: sound, onOpenBoard: { actions.openBoard(bubble) },
                                  onOpenProfile: actions.openProfile, onOpenSound: openSound)
                    .padding(.bottom, 4)
                BubbleFeedRail(bubble: bubble, actions: actions, showsSaveTip: showsSaveTip, sound: sound,
                               isSoundPlaying: isLive && LibrarySoundPlayer.shared.isPlaying, onOpenSound: openSound) {
                    withAnimation(GameMotion.resolved(GameMotion.reveal, reduceMotion: reduceMotion)) { showsSaveTip = false }
                }
                // The rail keeps its full width so its labels ("Board", "Remix") never clip;
                // the caption wraps or truncates instead.
                .fixedSize()
                .layoutPriority(1)
            }
            .padding(.leading, FBMetrics.screenPadding)
            .padding(.trailing, 8)
            .padding(.bottom, 16)
        }
    }

    /// A soft fade to dark behind the caption, so white text reads on any game without pills.
    private var bottomScrim: some View {
        LinearGradient(
            stops: [
                .init(color: Color.black.opacity(0), location: 0),
                .init(color: Color.black.opacity(0.25), location: 0.3),
                .init(color: Color.black.opacity(0.55), location: 0.6),
                .init(color: Color.black.opacity(0.78), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 380)
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
    }
}

/// When the feed's first-run hints show. "Tap to play" retires after a few games (persisted);
/// the save tip uses `SavesHintCenter`'s own once-ever flag.
@MainActor
enum FeedHints {
    private static let playsKey = "feed.tapToPlay.plays"
    private static let retireAfter = 3
    private static var settledPages = 0

    static var wantsTapHint: Bool {
        UserDefaults.standard.integer(forKey: playsKey) < retireAfter
    }

    static func notePlayed() {
        let plays = UserDefaults.standard.integer(forKey: playsKey)
        if plays < retireAfter { UserDefaults.standard.set(plays + 1, forKey: playsKey) }
    }

    /// Counts a settled page this launch; true for the first one.
    static func noteSettled() -> Bool {
        settledPages += 1
        return settledPages == 1
    }

    /// Sleeps; false when the page moved on (the task was cancelled).
    static func wait(_ seconds: Double) async -> Bool {
        (try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))) != nil
    }
}

/// A small, quiet "Tap to play" pill low over the game. The hand breathes on the clock
/// (`TimelineView`), and holds still under Reduce Motion. Taps pass through to the game.
private struct FeedTapToPlayHint: View {
    enum Style { case pill, inline }
    var style: Style = .pill

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 6) {
            TimelineView(.animation(paused: reduceMotion)) { context in
                let wave = reduceMotion ? 0 : GameMotion.loop(period: 1.4).wave(at: context.date)
                Image(systemName: "hand.tap.fill")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .scaleEffect(1 - 0.12 * wave)
            }
            Text("Tap to play")
                .font(.fbMetaEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(Color.white.opacity(style == .inline ? 0.85 : 1))
        .padding(.horizontal, style == .inline ? 10 : 12)
        .padding(.vertical, style == .inline ? 5 : 7)
        .background(Color.white.opacity(style == .inline ? 0.14 : 0), in: Capsule())
        .background(Color.black.opacity(style == .inline ? 0 : 0.38), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.5))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Caption

/// Bottom-left: one meta line, creator, title and rule, and one social line.
private struct BubbleFeedCaption: View {
    let item: BubbleFeedItem
    let bubble: Bubble
    let run: BubbleScore?
    let sound: RemoteGameSound?
    let onOpenBoard: () -> Void
    let onOpenProfile: (User) -> Void
    let onOpenSound: () -> Void

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            captionBody
            if let sponsor = item.sponsor {
                sponsorLine(sponsor)
            }
        }
    }

    /// Sponsored pages: a small "Tap to play" (the whole page plays it) and, when the brand has
    /// a page, a quiet "Learn more" link. No big CTA box over the game.
    private func sponsorLine(_ sponsor: RemoteSponsor) -> some View {
        HStack(spacing: 10) {
            FeedTapToPlayHint(style: .inline)
            if let url = sponsor.url {
                Button {
                    FeedEventReporter.shared.sponsorTap(gameID: bubble.id)
                    openURL(url)
                } label: {
                    Text("Learn more")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(Color.white.opacity(0.85))
                        .underline()
                        .frame(minHeight: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var captionBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let meta = metaText {
                Text(meta)
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(Color.white.opacity(0.8))
                    .lineLimit(1)
            }
            creatorRow
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(bubble.title)
                        .font(.fbHeadline)
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    if bubble.isMadeWithMuse {
                        Image(systemName: "sparkles")
                            .font(.system(size: FBIconSize.small, weight: .semibold))
                            .foregroundStyle(GameColor.gradient)
                            .accessibilityLabel("Made with Muse")
                    }
                }
                Text(bubble.rule)
                    .font(.fbBody)
                    .foregroundStyle(Color.white.opacity(0.9))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            socialLine
            if let sound {
                Button(action: onOpenSound) {
                    SoundTicker(sound: sound)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadow(color: Color.black.opacity(0.3), radius: 2, y: 1)
    }

    private var creatorRow: some View {
        Button {
            onOpenProfile(bubble.creator)
        } label: {
            HStack(spacing: 6) {
                AvatarView(user: bubble.creator, size: 24)
                    .overlay(Circle().stroke(Color.white.opacity(0.8), lineWidth: 1))
                Text(bubble.creator.isMe ? "You" : bubble.creator.name)
                    .font(.fbName)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Text("· \(bubble.createdAt.fbShort)")
                    .font(.fbMeta)
                    .foregroundStyle(Color.white.opacity(0.75))
                    .lineLimit(1)
                    .fixedSize()
                if item.sponsor != nil {
                    Text("·")
                        .font(.fbMeta)
                        .foregroundStyle(Color.white.opacity(0.75))
                    AdBadge()
                        .fixedSize()
                }
            }
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(bubble.creator.isMe ? "You" : bubble.creator.name)\(item.sponsor.map { ", ad by \($0.name)" } ?? ""), view profile")
    }

    // MARK: Social line

    /// One row that names a person: a friend's best to beat (opens the board) or, when no friend
    /// has a run here, who saved it (opens the savers list).
    @ViewBuilder
    private var socialLine: some View {
        if let run, !run.user.isMe {
            socialButton(symbol: "trophy.fill", tint: BubbleGlow.peach, text: bestText, hint: "Opens the board", action: onOpenBoard)
        } else if let proof = SavesSocialProof.text(for: bubble, in: bubbleStore) {
            socialButton(symbol: "bookmark.fill", tint: Color(hex: 0x6EA8FF), text: proof, hint: SavesCopy.seeAll) {
                router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", bubble.id)))
            }
        } else {
            socialButton(symbol: "trophy.fill", tint: BubbleGlow.peach, text: bestText, hint: "Opens the board", action: onOpenBoard)
        }
    }

    private func socialButton(symbol: String, tint: Color, text: String, hint: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                    .foregroundStyle(tint)
                Text(text)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
            }
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .accessibilityHint(hint)
        .accessibilityAddTraits(.isButton)
    }

    private var bestText: String {
        guard let run else { return "Be the first on the board" }
        let name = run.user.isMe ? "Your" : "\(run.user.firstName)'s"
        let mine = bubbleStore.bestScore(of: bubbleStore.appStore.me, in: bubble)?.score
        if let mine, mine > run.score, !run.user.isMe {
            return "You beat \(run.user.firstName)'s \(run.score.withCommas)"
        }
        return "\(name) best: \(run.score.withCommas) · beat it"
    }

    // MARK: Meta line

    /// "Level 1 · Endless · 2 remixes": context, category, length and remix credit in one quiet
    /// line, at most three parts.
    private var metaText: String? {
        var parts = contextParts
        if bubble.category != .play {
            parts.append(bubble.category.title)
        }
        if let length = BubbleLength.display(for: bubble) {
            parts.append(length.shortLabel)
        }
        if let remix = RemixCaptionCredit.text(for: bubble, in: bubbleStore) {
            parts.append(remix)
        }
        let shown = parts.prefix(3)
        return shown.isEmpty ? nil : shown.joined(separator: " · ")
    }

    private var contextParts: [String] {
        var parts: [String] = []
        if bubble.isDaily {
            let group = bubble.group?.name
            parts.append(group.map { "Daily \(ProductName.singular) · \($0)" } ?? "Daily \(ProductName.singular)")
        }
        if bubble.isIcebreaker {
            let event = bubble.event.map(Self.shortEventTitle) ?? "your event"
            parts.append("Icebreaker for \(event)")
        }
        if let level = bubble.levelIndex, bubble.chainID != nil {
            parts.append("Level \(level)")
        }
        switch item.reason {
        case .nearby:
            parts.append("New near you")
        case .groupBurst:
            if !bubble.isDaily, let group = bubble.group {
                parts.append(group.name)
            }
        case .yours where parts.isEmpty:
            parts.append("Your \(ProductName.singular)")
        default:
            break
        }
        // The recommender's own line about why this page is a debugging aid, not product copy:
        // shown only in DEBUG builds launched with `FB_FEED_WHY=1`.
        if Self.showsWhy, let why = item.why, parts.count < 3 {
            parts.append(why)
        }
        return parts
    }

    private static let showsWhy: Bool = {
        #if DEBUG
        return ProcessInfo.processInfo.environment["FB_FEED_WHY"] == "1"
        #else
        return false
        #endif
    }()

    /// "Newcomers' picnic in Dolores Park" → "Newcomers' picnic".
    private static func shortEventTitle(_ event: FBEvent) -> String {
        if let range = event.title.range(of: " in ") {
            return String(event.title[..<range.lowerBound])
        }
        return event.title
    }
}

// MARK: - Action rail

/// Right side: save (saves are the likes), board, remix and share. Long-press save to see who
/// saved it. The once-ever save tip points at the save button.
private struct BubbleFeedRail: View {
    let bubble: Bubble
    let actions: BubbleFeedPageActions
    let showsSaveTip: Bool
    let sound: RemoteGameSound?
    let isSoundPlaying: Bool
    let onOpenSound: () -> Void
    let onDismissSaveTip: () -> Void

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @State private var saveBounce = 0

    var body: some View {
        VStack(spacing: 10) {
            BubbleFeedRailButton(
                symbol: bubble.isSaved ? "bookmark.fill" : "bookmark",
                label: bubble.saveCount.fbCompact,
                tint: bubble.isSaved ? Color(hex: 0x6EA8FF) : Color.white,
                bounce: saveBounce,
                accessibility: bubble.isSaved ? "Unsave" : "Save",
                value: SavesSocialProof.text(for: bubble, in: bubbleStore) ?? SavesCopy.savesCount(bubble.saveCount)
            ) {
                saveBounce += 1
                onDismissSaveTip()
                actions.save(bubble)
            }
            .contextMenu {
                Button(SavesCopy.seeAll, systemImage: "person.2", action: openSavers)
            }
            .accessibilityAction(named: SavesCopy.seeAll, openSavers)
            .overlay(alignment: .trailing) {
                if showsSaveTip {
                    FeedSaveTip(onDismiss: onDismissSaveTip)
                        .offset(x: -56)
                        .transition(.opacity)
                }
            }
            BubbleFeedRailButton(symbol: "trophy.fill", label: "Board", accessibility: "Board") {
                actions.openBoard(bubble)
            }
            BubbleFeedRailButton(symbol: "wand.and.stars", label: "Remix", accessibility: "Remix with Muse") {
                actions.remix(bubble)
            }
            BubbleFeedRailButton(symbol: "arrowshape.turn.up.right.fill", label: "Share", accessibility: "Share this \(ProductName.singular)") {
                actions.float(bubble)
            }
            if let sound {
                Button(action: onOpenSound) {
                    SoundDisc(sound: sound, isSpinning: isSoundPlaying)
                        .frame(width: 48, height: 48)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .padding(.bottom, 2)
    }

    private func openSavers() {
        router.push(.bubbleFeature(BubbleFeatureRoute(.saves, "stats", bubble.id)))
    }
}

/// The once-ever save tip: one short line beside the save button. Tap to dismiss.
private struct FeedSaveTip: View {
    let onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            HStack(spacing: 6) {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x6EA8FF))
                Text(SavesCopy.hintTitle)
                    .font(.fbCaptionEmphasized)
                    .foregroundStyle(Color.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(width: 200, alignment: .leading)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SavesCopy.hintTitle)
        .accessibilityHint("Double tap to dismiss")
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
            VStack(spacing: 2) {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(tint)
                    .symbolEffect(.bounce, value: bounce)
                    .frame(width: 44, height: 34)
                Text(label)
                    .font(.fbMicroEmphasized)
                    .foregroundStyle(Color.white.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(minWidth: 48)
            .shadow(color: Color.black.opacity(0.35), radius: 2, y: 1)
            .contentShape(Rectangle())
        }
        .gamePress(scale: 0.9)
        .accessibilityLabel(accessibility)
        .accessibilityValue(value ?? "")
    }
}
