import SwiftUI

/// A Bubble's page: cover, rule, creator, Burst, Bubble Board preview, chain, actions.
///
/// DEBUG launch: `FB_SAMPLE_SCORES=0` turns off the sample scores added when a board is empty.
struct BubbleDetailView: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var showFloat = false

    var body: some View {
        Group {
            if let bubble = bubbleStore.bubble(id: bubbleID) {
                content(bubble)
            } else {
                ContentUnavailableView("Bubble not found", systemImage: "bubbles.and.sparkles", description: Text("It may have been removed."))
            }
        }
        .background(FBColor.surface)
        .navigationTitle("Bubble")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ bubble: Bubble) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero(bubble)
                titleBlock(bubble)
                creatorRow(bubble)
                tags(bubble)
                museRow(bubble)
                popInButton(bubble)
                stats(bubble)
                actions(bubble)
                BubbleDetailSlots(bubble: bubble)
                burstPreview(bubble)
                boardPreview(bubble)
                chainRow(bubble)
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .onAppear {
            #if DEBUG
            bubbleStore.seedSampleScoresIfNeeded(bubble)
            #endif
        }
        .sheet(isPresented: $showFloat) {
            BubbleFloatSheet(bubble: bubble) { showFloat = false }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: Pieces

    private func hero(_ bubble: Bubble) -> some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        return BubbleCoverView(bubble: bubble)
            .aspectRatio(1.7, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.6), lineWidth: 1.5)
            )
            .shadow(color: palette.top.opacity(0.7), radius: 18, y: 6)
            .padding(.top, 4)
            .accessibilityHidden(true)
    }

    private func titleBlock(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(bubble.title)
                .font(.fbTabTitle)
                .foregroundStyle(FBColor.primaryText)
                .accessibilityAddTraits(.isHeader)
            Text(bubble.rule)
                .font(.fbBodyLarge)
                .foregroundStyle(FBColor.secondaryText)
        }
    }

    private func creatorRow(_ bubble: Bubble) -> some View {
        Button {
            router.push(.profile(bubble.creator))
        } label: {
            HStack(spacing: 10) {
                AvatarView(user: bubble.creator, size: FBAvatarSize.post)
                VStack(alignment: .leading, spacing: 1) {
                    Text(bubble.creator.id == appStore.me.id ? "You" : bubble.creator.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Blown \(bubble.createdAt.formatted(.relative(presentation: .named)))")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.tertiaryText)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Made by \(bubble.creator.name). Open profile")
    }

    private func tags(_ bubble: Bubble) -> some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            BubbleTagPill(symbol: bubble.formula.symbol, text: bubble.formula.title)
            if bubble.category != .play {
                BubbleTagPill(symbol: bubble.category.symbol, text: bubble.category.title, highlighted: true)
            }
            if bubble.isDaily {
                BubbleTagPill(symbol: "sun.max.fill", text: bubble.group.map { "Daily Bubble · \($0.name)" } ?? "Daily Bubble", highlighted: true)
            }
            if bubble.isIcebreaker {
                BubbleTagPill(symbol: "hands.sparkles.fill", text: "Icebreaker for \(bubble.event?.title ?? "the Event")", highlighted: true)
            }
            if let chainID = bubble.chainID, let level = bubble.levelIndex {
                BubbleTagPill(symbol: "link", text: "Level \(level) of \(bubbleStore.chainName(chainID))", highlighted: true)
            }
        }
    }

    @ViewBuilder
    private func museRow(_ bubble: Bubble) -> some View {
        if bubble.isMadeWithMuse {
            HStack(spacing: 8) {
                MuseBadge()
                if let stamp = bubbleStore.studioStampText(for: bubble) {
                    Text(stamp)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func popInButton(_ bubble: Bubble) -> some View {
        Button {
            Haptics.light()
            router.play(bubble.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "play.fill")
                    .font(.system(size: FBIconSize.large, weight: .bold))
                Text("Pop in")
                    .font(.fbTitle)
            }
            .foregroundStyle(BubbleGlow.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(BubbleGlow.brandGradient, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            .bubbleGlow(BubbleGlow.pink, radius: 10, opacity: 0.35)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Pop in to \(bubble.title)")
    }

    private func stats(_ bubble: Bubble) -> some View {
        HStack(spacing: 16) {
            Label("\(bubble.playCount.fbCompact) plays", systemImage: "play.circle")
            Label(SavesCopy.savesCount(bubble.saveCount), systemImage: bubble.isSaved ? "bookmark.fill" : "bookmark")
                .foregroundStyle(bubble.isSaved ? FBColor.accent : FBColor.secondaryText)
            Spacer(minLength: 0)
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
        .labelStyle(.titleAndIcon)
        .padding(.top, -10)
    }

    private func actions(_ bubble: Bubble) -> some View {
        let mine = bubble.creator.id == appStore.me.id
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                actionButton("Remix", symbol: "wand.and.sparkles") {
                    router.openStudio(StudioLaunch(mode: .remix, baseBubbleID: bubble.id))
                }
                actionButton(bubble.isSaved ? "Saved" : "Save", symbol: bubble.isSaved ? "bookmark.fill" : "bookmark") {
                    bubbleStore.toggleSave(bubble, source: .detail)
                    appStore.showToast(bubble.isSaved ? "Saved to your Library" : "Removed from saved", symbol: bubble.isSaved ? "bookmark.fill" : "bookmark.slash")
                }
                actionButton("Float", symbol: "arrowshape.turn.up.right") { showFloat = true }
            }
            if mine {
                HStack(spacing: 8) {
                    actionButton("Edit", symbol: "pencil") {
                        router.openStudio(StudioLaunch(mode: .edit, baseBubbleID: bubble.id))
                    }
                    actionButton("Make the next level", symbol: "plus.circle") {
                        router.openStudio(StudioLaunch(mode: .nextLevel, baseBubbleID: lastLevelID(of: bubble)))
                    }
                }
            }
        }
    }

    private func lastLevelID(of bubble: Bubble) -> String {
        bubble.chainID.flatMap { bubbleStore.chain($0).last?.id } ?? bubble.id
    }

    private func actionButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                Text(title)
            }
        }
        .buttonStyle(.fb(.secondary, expand: true, height: 40))
    }

    @ViewBuilder
    private func burstPreview(_ bubble: Bubble) -> some View {
        if let run = bubble.featuredRun {
            VStack(alignment: .leading, spacing: 8) {
                Text("Burst")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                Button {
                    router.play(bubble.id, replay: run.replay)
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            BubbleCoverView(bubble: bubble, showsEmoji: false)
                            Circle().fill(.black.opacity(0.35)).frame(width: 36, height: 36)
                            Image(systemName: "play.fill")
                                .font(.system(size: FBIconSize.regular, weight: .bold))
                                .foregroundStyle(.white)
                        }
                        .frame(width: 96, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Best run: \(run.score.withCommas)")
                                .font(.fbName)
                                .foregroundStyle(FBColor.primaryText)
                            Text("\(run.user.id == appStore.me.id ? "You" : run.user.name) · Watch the replay")
                                .font(.fbMeta)
                                .foregroundStyle(FBColor.secondaryText)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: FBIconSize.regular, weight: .semibold))
                            .foregroundStyle(FBColor.accent)
                    }
                    .padding(10)
                    .background(FBColor.background, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Watch the best run, \(run.score) points by \(run.user.name)")
            }
        }
    }

    private func boardPreview(_ bubble: Bubble) -> some View {
        let scope: BubbleBoardScope = bubble.group == nil ? .everyone : .group
        let rows = bubbleStore.board(for: bubble, scope: scope)
        let top = Array(rows.prefix(3))
        let mine = rows.firstIndex { $0.user.id == appStore.me.id }
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Bubble Board")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                if bubble.isDaily {
                    Text("Today")
                        .font(.fbCaptionEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(FBColor.tintedBlueBackground, in: Capsule())
                }
                Spacer()
            }
            if rows.isEmpty {
                Text("No scores yet. Pop in and be first on the board.")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.vertical, 12)
            } else {
                ForEach(Array(top.enumerated()), id: \.element.id) { index, entry in
                    BubbleBoardRow(rank: index + 1, entry: entry, bubble: bubble, compact: true)
                }
                if let mine, mine >= 3 {
                    HairlineDivider()
                    BubbleBoardRow(rank: mine + 1, entry: rows[mine], bubble: bubble, compact: true)
                }
            }
            Button {
                router.push(.bubbleBoard(bubble.id))
            } label: {
                Text("See Bubble Board")
            }
            .buttonStyle(.fb(.secondary, expand: true, height: 40))
            .padding(.top, 6)
        }
    }

    @ViewBuilder
    private func chainRow(_ bubble: Bubble) -> some View {
        if let chainID = bubble.chainID {
            let levels = bubbleStore.chain(chainID)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Bubble Chain")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button("See all") { router.push(.bubbleChain(chainID)) }
                        .font(.fbButton)
                        .foregroundStyle(FBColor.accent)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(levels) { level in
                            Button {
                                if level.id != bubble.id { router.push(.bubble(level.id)) }
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    BubbleCard(bubble: level, style: .compact)
                                        .frame(width: 112)
                                        .overlay {
                                            if level.id == bubble.id {
                                                RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                                                    .strokeBorder(FBColor.brandBlue, lineWidth: 2)
                                            }
                                        }
                                    Text("Level \(level.levelIndex ?? 1)")
                                        .font(.fbCaptionEmphasized)
                                        .foregroundStyle(level.id == bubble.id ? FBColor.accent : FBColor.secondaryText)
                                }
                            }
                            .buttonStyle(.pressable)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Shared pieces

/// A small rounded tag under the title.
struct BubbleTagPill: View {
    let symbol: String
    let text: String
    var highlighted = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.small, weight: .semibold))
            Text(text)
                .font(.fbCaptionEmphasized)
                .lineLimit(1)
        }
        .foregroundStyle(highlighted ? FBColor.accent : FBColor.secondaryText)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(highlighted ? FBColor.tintedBlueBackground : FBColor.buttonGray, in: Capsule())
    }
}

/// Where to float a Bubble: your feed, or one of your Groups.
struct BubbleFloatSheet: View {
    let bubble: Bubble
    let onDone: () -> Void

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Float it to…")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, FBMetrics.screenPadding)
                .padding(.top, 20)
                .padding(.bottom, 8)
            ScrollView {
                VStack(spacing: 0) {
                    destination(title: "Your feed", subtitle: "Friends can pop in from Home", avatar: AnyView(AvatarView(user: appStore.me, size: FBAvatarSize.post))) {
                        send(to: nil, name: "your feed")
                    }
                    ForEach(appStore.myGroups) { group in
                        HairlineDivider(leadingInset: 68)
                        destination(
                            title: group.name,
                            subtitle: "Group",
                            avatar: AnyView(
                                RemoteImage(url: group.coverURL)
                                    .frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                            )
                        ) {
                            send(to: group, name: group.name)
                        }
                    }
                }
            }
        }
        .background(FBColor.surface)
    }

    private func destination(title: String, subtitle: String, avatar: AnyView, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                avatar
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.fbName).foregroundStyle(FBColor.primaryText)
                    Text(subtitle).font(.fbMeta).foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
                Image(systemName: "arrowshape.turn.up.right")
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Float to \(title)")
    }

    private func send(to group: FBGroup?, name: String) {
        BubbleSurfaceHooks.float(bubble, result: nil, to: group, message: "Pop in to \(bubble.title)", appStore: appStore, bubbleStore: bubbleStore)
        appStore.showToast("Floated to \(name)", symbol: "checkmark.circle.fill")
        onDone()
    }
}

#Preview {
    NavigationStack { BubbleDetailView(bubbleID: "hill-hopper") }.previewEnvironment()
}
