import SwiftUI

/// The Bubbles block at the top of a Group: Daily Bubble card, "Blow a bubble" entry and the
/// Group's Bubbles.
struct BubbleGroupSection: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore

    var body: some View {
        let daily = bubbleStore.worldDailyBubble(for: group)
        let others = bubbleStore.worldBubbles(in: group).filter { $0.id != daily?.id }
        VStack(spacing: 0) {
            if let daily {
                BubbleGroupDailyCard(group: group, bubble: daily)
                    .padding(12)
                    .background(FBColor.surface)
            }
            BubbleGroupFeaturedSlots(group: group)
            if group.isMember {
                BubbleGroupBlowRow(group: group)
            }
            if !others.isEmpty {
                BubbleGroupBubblesRow(bubbles: others)
            }
        }
    }
}

// MARK: - Daily Bubble card

/// A Glow card: cover, title and rule, "Pop in", today's top three, your standing and streak.
struct BubbleGroupDailyCard: View {
    let group: FBGroup
    let bubble: Bubble

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                BubbleOrb(size: 18, tint: palette.glow)
                Text("Daily \(ProductName.singular)")
                    .font(.fbCaptionEmphasized)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.ink.opacity(0.75))
                Spacer(minLength: 0)
                if bubble.isMadeWithMuse { MuseBadge(compact: true) }
            }
            HStack(spacing: 12) {
                BubbleCoverView(bubble: bubble)
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
                VStack(alignment: .leading, spacing: 4) {
                    Text(bubble.title)
                        .font(.fbHeadline)
                        .foregroundStyle(palette.ink)
                        .lineLimit(2)
                    Text(bubble.rule)
                        .font(.fbBody)
                        .foregroundStyle(palette.ink.opacity(0.8))
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
            }
            Button {
                Haptics.light()
                router.play(bubble.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "play.fill")
                    Text(played ? "Play again" : "Play")
                }
                .font(.fbButton)
                .foregroundStyle(palette.isDark ? BubbleGlow.ink : Color.white)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(palette.isDark ? AnyShapeStyle(Color.white.opacity(0.92)) : AnyShapeStyle(palette.ink), in: Capsule())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("Play \(bubble.title)")

            leaderboard(palette)

            Button {
                Haptics.light()
                router.push(.bubbleBoard(bubble.id))
            } label: {
                HStack(spacing: 4) {
                    Text("See board")
                    Image(systemName: "chevron.right")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                }
                .font(.fbMetaEmphasized)
                .foregroundStyle(palette.ink)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(palette.gradient, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.55), lineWidth: 1))
        .bubbleGlow(palette.top, radius: 10, opacity: 0.35)
        .accessibilityElement(children: .contain)
    }

    private var standing: (score: Int, rank: Int, of: Int)? { bubbleStore.worldMyStanding(in: bubble) }
    private var played: Bool { standing != nil }

    private func leaderboard(_ palette: BubblePalette) -> some View {
        let top = bubbleStore.worldTopToday(in: bubble)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Today's top 3")
                .font(.fbMetaEmphasized)
                .foregroundStyle(palette.ink.opacity(0.75))
            if top.isEmpty {
                Text("Nobody has played yet today. Be the first on the board.")
                    .font(.fbBody)
                    .foregroundStyle(palette.ink.opacity(0.85))
            } else {
                ForEach(Array(top.enumerated()), id: \.element.id) { index, entry in
                    HStack(spacing: 8) {
                        Text("\(index + 1)")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(palette.ink)
                            .frame(width: 18)
                        AvatarView(user: entry.user, size: FBAvatarSize.reply)
                        Text(entry.user.isMe ? "You" : entry.user.name)
                            .font(.fbName)
                            .foregroundStyle(palette.ink)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(entry.score.withCommas)
                            .font(.fbName)
                            .monospacedDigit()
                            .foregroundStyle(palette.ink)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Number \(index + 1), \(entry.user.isMe ? "you" : entry.user.name), \(entry.score) points")
                }
            }
            statusLine(palette)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(palette.isDark ? 0.1 : 0.45), in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
    }

    private func statusLine(_ palette: BubblePalette) -> some View {
        let streak = bubbleStore.worldStreak(in: group)
        return HStack(spacing: 6) {
            if let standing {
                Text("You: \(standing.score.withCommas) · #\(standing.rank) of \(standing.of)")
            } else {
                Text("You haven't played today")
            }
            if streak > 0 {
                Text("· 🔥 \(streak)-day streak")
            }
        }
        .font(.fbMetaEmphasized)
        .foregroundStyle(palette.ink)
        .padding(.top, 2)
    }
}

// MARK: - Entry rows

/// "Blow a bubble for this group".
struct BubbleGroupBlowRow: View {
    let group: FBGroup

    @Environment(Router.self) private var router

    var body: some View {
        Button {
            Haptics.light()
            router.openStudio(StudioLaunch(mode: .create, groupID: group.id))
        } label: {
            HStack(spacing: 12) {
                BubbleOrb(size: 34)
                    .padding(6)
                    .background(BubbleGlow.brandGradient.opacity(0.55), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make \(ProductName.withArticle) for this group")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Describe a game and Muse builds it")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(FBColor.surface)
            .overlay(alignment: .top) { HairlineDivider() }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Make \(ProductName.withArticle) for this group")
    }
}

/// A "Bubbles" row of compact cards.
struct BubbleGroupBubblesRow: View {
    let bubbles: [Bubble]
    var title = ProductName.display

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title)
                .padding(.horizontal, 16)
                .padding(.top, 12)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(bubbles) { bubble in
                        NavigationLink(value: Route.bubble(bubble.id)) {
                            BubbleCard(bubble: bubble, style: .compact)
                                .frame(width: 112)
                        }
                        .buttonStyle(.pressable)
                        .accessibilityLabel(bubble.title)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .overlay(alignment: .top) { HairlineDivider() }
    }
}

// MARK: - Groups tab strip

/// "Daily Bubbles": one pill per group of yours that has a Daily Bubble.
struct BubbleGroupDailyStrip: View {
    @Environment(AppStore.self) private var store
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    var body: some View {
        let items: [(FBGroup, Bubble)] = store.myGroups.compactMap { group in
            bubbleStore.worldDailyBubble(for: group).map { (group, $0) }
        }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Daily \(ProductName.plural)", subtitle: "A new game in each of your groups every day")
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(items, id: \.1.id) { group, bubble in
                            tile(group: group, bubble: bubble)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface)
        }
    }

    private func tile(group: FBGroup, bubble: Bubble) -> some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        let played = bubbleStore.worldMyStanding(in: bubble) != nil
        return Button {
            Haptics.light()
            router.play(bubble.id)
        } label: {
            HStack(spacing: 10) {
                BubbleCoverView(bubble: bubble, showsEmoji: true)
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(group.name)
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(palette.ink.opacity(0.75))
                        .lineLimit(1)
                    Text(bubble.title)
                        .font(.fbName)
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Text(played ? "Played today" : "Play")
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(palette.ink.opacity(0.85))
                }
            }
            .padding(10)
            .frame(width: 248, alignment: .leading)
            .background(palette.gradient, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous).strokeBorder(Color.white.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("\(group.name) Daily \(ProductName.singular), \(bubble.title). \(played ? "Played today" : "Play")")
    }
}
