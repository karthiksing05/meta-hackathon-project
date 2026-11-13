import SwiftUI

/// After a run: the outcome moment in Glow (score, personal best, a "new best" celebration),
/// your rank among friends or the Group with a three-row board, and what's next: play again,
/// float the result, share it to your story, or the next level of a chain.
///
/// It floats as a card over the game rather than a full sheet, so the final frame stays in view
/// (dimmed) above and around it. In the player it is an overlay inside the player (`onClose` set):
/// a partial-height sheet over a full-screen cover lets UIKit drop the cover's view, which showed
/// the tabs instead of the game. From the feed it stays a sheet with a clear background that rests
/// below full height on a frosted background (pull it up for everything). Slots keep their own sheets, `exitPlayer` and the
/// `PresentationGate` sequencing as before.
struct BubbleResultSheet: View {
    let context: BubbleResultContext
    var onPlayAgain: () -> Void
    var onSeeBoard: (Bubble) -> Void
    var onNextLevel: (Bubble) -> Void
    /// The player's request (seed, length, challenge or session context). Nil from the feed.
    var request: BubblePlayRequest? = nil
    /// Closes the player, then runs the action. Nil outside the player.
    var exitPlayer: ((@escaping () -> Void) -> Void)? = nil
    /// Set when shown inline over the game (the player): closes the card. Nil when it's a sheet.
    var onClose: (() -> Void)? = nil

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var shownScore = 0
    @State private var isCelebrating = false
    @State private var didFloat = false
    @State private var didShare = false

    private var score: Int { context.result.score }

    var body: some View {
        Group {
            if let bubble = bubbleStore.bubble(id: context.bubbleID) {
                content(bubble)
            } else {
                EngineErrorCard(detail: EngineErrorCard.goneDetail)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .presentationDetents([ResultCardStyle.restingDetent, .large])
        .presentationDragIndicator(.hidden)
        .presentationBackground {
            // As a sheet (the feed), the sheet itself is the card: frosted, so the page shows through.
            ZStack {
                Rectangle().fill(.regularMaterial)
                FBColor.surface.opacity(0.6)
            }
        }
        .overlay(alignment: .bottom) {
            // Inline, the player's own toast host shows them.
            if onClose == nil {
                ToastHost()
                    .padding(.bottom, 16)
            }
        }
    }

    private func content(_ bubble: Bubble) -> some View {
        let board = BubbleResultBoardModel(context: context, bubble: bubble, store: bubbleStore)
        return ScrollView {
            VStack(spacing: 14) {
                grabber
                BubbleResultHero(
                    bubble: bubble,
                    shownScore: shownScore,
                    outcome: context.result.outcome,
                    previousBest: context.previousBest,
                    isNewBest: isNewBest,
                    isCelebrating: isCelebrating,
                    streak: bubble.isDaily ? bubbleStore.dailyStreak : 0
                )
                BubbleResultInfoSlots(slot: slot(for: bubble))
                BubbleResultBoard(board: board) {
                    onSeeBoard(bubble)
                }
                actions(bubble)
            }
            .padding(.horizontal, FBSpacing.m)
            .padding(.top, 18)
            .padding(.bottom, 20)
        }
        .scrollBounceBehavior(.basedOnSize)
        .resultCard(isInline: onClose != nil)
        .onAppear(perform: playOutcomeMoment)
    }

    /// The card's handle. Inline, dragging it down (or tapping it) closes the card.
    @ViewBuilder
    private var grabber: some View {
        let handle = Capsule()
            .fill(FBColor.tertiaryText.opacity(0.5))
            .frame(width: 36, height: 5)
            .frame(maxWidth: .infinity, minHeight: 20)
            .contentShape(Rectangle())
            .padding(.top, -12)
        if let onClose {
            handle
                .gesture(DragGesture(minimumDistance: 8).onEnded { value in
                    if value.translation.height > 40 { onClose() }
                })
                .onTapGesture(perform: onClose)
                .accessibilityElement()
                .accessibilityLabel("Close results")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onClose() }
        } else {
            handle.accessibilityHidden(true)
        }
    }

    // MARK: Outcome

    private var isNewBest: Bool {
        guard score > 0 else { return false }
        return context.previousBest.map { score > $0 } ?? true
    }

    /// Counts the score up, then celebrates a new best.
    private func playOutcomeMoment() {
        guard shownScore == 0 else { return }
        if reduceMotion || score <= 0 {
            shownScore = score
            if isNewBest { GameSound.play(.newBest, haptic: true) }
            return
        }
        Task { @MainActor in
            let steps = 18
            for step in 1...steps {
                try? await Task.sleep(nanoseconds: 26_000_000)
                let progress = Double(step) / Double(steps)
                let eased = 1 - pow(1 - progress, 3)
                shownScore = Int((Double(score) * eased).rounded())
            }
            shownScore = score
            if isNewBest {
                GameSound.play(.newBest, haptic: true)
                withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) {
                    isCelebrating = true
                }
            } else {
                Haptics.light()
            }
        }
    }

    // MARK: Actions

    private func actions(_ bubble: Bubble) -> some View {
        let group = bubble.group
        return VStack(spacing: 8) {
            BubbleResultActionSlots(slot: slot(for: bubble))
            Button {
                Haptics.light()
                onPlayAgain()
            } label: {
                Label("Play again", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(.fb(.secondary, height: 44))

            Button {
                float(bubble, to: group)
            } label: {
                Label(
                    didFloat ? "Shared" : "Share to \(group?.name ?? "your feed")",
                    systemImage: didFloat ? "checkmark" : "arrowshape.turn.up.right.fill"
                )
            }
            .buttonStyle(.fb(.secondary, height: 44))
            .disabled(didFloat)

            Button {
                shareToStory(bubble)
            } label: {
                Label(didShare ? "Added to your story" : "Share to story", systemImage: didShare ? "checkmark" : "plus.circle.fill")
            }
            .buttonStyle(.fb(.secondary, height: 44))
            .disabled(didShare)

            if let next = bubbleStore.nextLevel(after: bubble) {
                Button {
                    Haptics.light()
                    onNextLevel(next)
                } label: {
                    Label("Next level: \(next.title)", systemImage: "arrow.right.circle.fill")
                }
                .buttonStyle(.fb(.tinted, height: 44))
            }
        }
    }

    /// What the collaboration slots get (docs/BUBBLES.md 7.1).
    private func slot(for bubble: Bubble) -> BubbleResultSlotContext {
        BubbleResultSlotContext(
            result: context,
            bubble: bubble,
            play: request?.bubbleID == bubble.id ? request?.context : nil,
            request: request?.bubbleID == bubble.id ? request : nil,
            playAgain: onPlayAgain,
            exitPlayer: exitPlayer
        )
    }

    private func float(_ bubble: Bubble, to group: FBGroup?) {
        let message = "I got \(score.withCommas) in \(bubble.title). Beat it? ✨"
        let post = BubbleSurfaceHooks.float(bubble, result: context.result, to: group, message: message, appStore: appStore, bubbleStore: bubbleStore)
        if post != nil {
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.2)) {
                didFloat = true
            }
            // BubbleSurfaceHooks.float already shows "Shared to <Group>"; a second toast restarted it.
        } else {
            appStore.showToast("Couldn't share this right now", symbol: "exclamationmark.circle")
        }
    }

    private func shareToStory(_ bubble: Bubble) {
        if BubbleSurfaceHooks.shareToStory(bubble, result: context.result, appStore: appStore, bubbleStore: bubbleStore) {
            Haptics.success()
            withAnimation(.easeInOut(duration: 0.2)) {
                didShare = true
            }
            appStore.showToast("Added to your story", symbol: "plus.circle.fill")
        } else {
            appStore.showToast("Couldn't add this to your story right now", symbol: "exclamationmark.circle")
        }
    }
}

// MARK: - Hero

/// The outcome moment: the Bubble's palette, a soft burst of bubbles, the score.
private struct BubbleResultHero: View {
    let bubble: Bubble
    let shownScore: Int
    let outcome: BubbleOutcome
    let previousBest: Int?
    let isNewBest: Bool
    let isCelebrating: Bool
    let streak: Int

    /// The Bubble's own colors, custom ones included (LOOKS.md); the layout never changes.
    private var palette: BubblePalette { bubble.palette }
    /// Behind small labels: light on light palettes, dark on dark ones, so ink stays legible.
    private var labelFill: Color { palette.isDark ? Color.black.opacity(0.28) : Color.white.opacity(0.5) }

    var body: some View {
        ZStack {
            palette.gradient
            ambientOrbs
            celebration
            VStack(spacing: 6) {
                badge
                Text("\(bubble.emoji) \(bubble.title)")
                    .font(.fbName)
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                Text(shownScore.withCommas)
                    .font(.system(size: 54, weight: .bold, design: .rounded)) // Display text: the run's score
                    .monospacedDigit()
                    .foregroundStyle(palette.ink)
                    .bubbleGlow(palette.glow, radius: 10, opacity: 0.7)
                    .contentTransition(.numericText(value: Double(shownScore)))
                    .accessibilityLabel("Score \(shownScore)")
                Text(bestLine)
                    .font(.fbMetaEmphasized)
                    .foregroundStyle(palette.ink.opacity(0.8))
                if streak > 1 {
                    Label("\(streak)-day streak", systemImage: "flame.fill")
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(palette.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(labelFill, in: Capsule())
                        .padding(.top, 4)
                }
            }
            .padding(.vertical, 16)
            .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 168)
        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                .strokeBorder(Color.white.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var badge: some View {
        if isNewBest {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                    .font(.system(size: FBIconSize.xs, weight: .bold))
                Text(previousBest == nil ? "First score!" : "New best!")
                    .font(.fbCaptionEmphasized)
            }
            .foregroundStyle(BubbleGlow.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.8), lineWidth: 1))
            .scaleEffect(isCelebrating ? 1 : 0.85)
            .bubbleGlow(.white, radius: 8, opacity: isCelebrating ? 0.8 : 0.3)
        } else {
            Text(outcome == .success ? "You made it" : "Nice run")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(palette.ink.opacity(0.85))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(labelFill, in: Capsule())
        }
    }

    private var bestLine: String {
        guard let previousBest else { return "Your first run on this \(ProductName.singular)" }
        if isNewBest { return "Up from \(previousBest.withCommas)" }
        return "Your best: \(previousBest.withCommas)"
    }

    private var ambientOrbs: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            BubbleOrb(size: 64, tint: palette.glow)
                .position(x: w * 0.12, y: h * 0.22)
            BubbleOrb(size: 30, tint: palette.glow)
                .position(x: w * 0.88, y: h * 0.18)
            BubbleOrb(size: 44, tint: palette.glow)
                .position(x: w * 0.86, y: h * 0.8)
            BubbleOrb(size: 22, tint: palette.glow)
                .position(x: w * 0.18, y: h * 0.84)
        }
        .opacity(0.8)
        .accessibilityHidden(true)
    }

    /// Ten small bubbles that float out from behind the score on a new best.
    private var celebration: some View {
        ZStack {
            ForEach(0..<10, id: \.self) { index in
                let angle = Double(index) / 10 * 2 * .pi + 0.3
                let distance: CGFloat = index.isMultiple(of: 2) ? 120 : 84
                BubbleOrb(size: index.isMultiple(of: 3) ? 22 : 14, tint: palette.accents[index % palette.accents.count])
                    .offset(
                        x: isCelebrating ? cos(angle) * distance : 0,
                        y: isCelebrating ? sin(angle) * distance * 0.7 : 0
                    )
                    .opacity(isCelebrating ? 0.95 : 0)
                    .scaleEffect(isCelebrating ? 1 : 0.3)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Board snippet

/// Your rank and the three rows around you, from the board this run counts on: the Bubble's
/// Group, or your friends.
private struct BubbleResultBoardModel {
    struct Row: Identifiable {
        let id: String
        let rank: Int
        let user: User
        let score: Int
        let isMe: Bool
        let isVerified: Bool
    }

    let title: String
    let rows: [Row]

    init(context: BubbleResultContext, bubble: Bubble, store: BubbleStore) {
        let me = store.appStore.me
        let scope: BubbleBoardScope = bubble.group != nil ? .group : .friends
        var board = store.leaderboard(for: bubble, scope: scope)
        // Count this run even before (or without, for DEBUG fakes) it reaches the board.
        let recorded = board.first { $0.user.id == me.id }
        let myScore = max(context.result.score, context.previousBest ?? 0, recorded?.score ?? 0)
        board.removeAll { $0.user.id == me.id }
        let mine = BubbleScore(id: recorded?.id ?? "result-me", user: me, score: myScore, isVerified: recorded?.isVerified ?? false)
        let insertAt = board.firstIndex { $0.score < myScore } ?? board.count
        board.insert(mine, at: insertAt)

        let start = max(0, min(insertAt - 1, board.count - 3))
        let window = board[start..<min(board.count, start + 3)]
        rows = window.enumerated().map { offset, entry in
            Row(
                id: entry.id,
                rank: start + offset + 1,
                user: entry.user,
                score: entry.score,
                isMe: entry.user.id == me.id,
                isVerified: entry.isVerified
            )
        }
        let rank = insertAt + 1
        if scope == .group, let group = bubble.group {
            title = "#\(rank) in \(group.name)"
        } else {
            title = board.count > 1 ? "#\(rank) among friends" : "You're first among friends"
        }
    }
}

private struct BubbleResultBoard: View {
    let board: BubbleResultBoardModel
    let onSeeBoard: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(board.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button {
                    Haptics.light()
                    onSeeBoard()
                } label: {
                    Text("See board")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 4)
            ForEach(board.rows) { row in
                rowView(row)
            }
        }
        .padding(.bottom, 6)
        .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private func rowView(_ row: BubbleResultBoardModel.Row) -> some View {
        HStack(spacing: 10) {
            Text("\(row.rank)")
                .font(.fbName.monospacedDigit())
                .foregroundStyle(row.isMe ? FBColor.primaryText : FBColor.secondaryText)
                .frame(minWidth: 22, alignment: .leading)
            AvatarView(user: row.user, size: FBAvatarSize.comment)
            Text(row.isMe ? "You" : row.user.name)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            if row.isVerified {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: FBIconSize.xs, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
                    .accessibilityLabel("Verified run")
            }
            Spacer(minLength: 8)
            Text(row.score.withCommas)
                .font(.fbName.monospacedDigit())
                .foregroundStyle(FBColor.primaryText)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background {
            if row.isMe {
                RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                    .fill(BubbleGlow.lilac.opacity(0.22))
                    .padding(.horizontal, 6)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
