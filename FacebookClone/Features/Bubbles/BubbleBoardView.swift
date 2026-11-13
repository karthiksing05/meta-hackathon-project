import SwiftUI

/// A Bubble's leaderboard: scope picker, podium, ranked list and your row pinned at the bottom.
struct BubbleBoardView: View {
    let bubbleID: String

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router

    @State private var scope: BubbleBoardScope?
    @State private var myRowVisible = false
    @State private var isLoadingGame = false
    @State private var loadAttempt = 0

    var body: some View {
        Group {
            if let bubble = bubbleStore.bubble(id: bubbleID) {
                content(bubble)
            } else if isLoadingGame {
                LiveDataStateView(kind: .loading)
            } else {
                BubbleMissingState(retry: { loadAttempt += 1 })
            }
        }
        .task(id: "\(bubbleID)/\(loadAttempt)") {
            guard bubbleStore.bubble(id: bubbleID) == nil else { return }
            isLoadingGame = true
            _ = await bubbleStore.loadGame(id: bubbleID)
            isLoadingGame = false
        }
        .background(FBColor.surface)
        .navigationTitle("Board")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func activeScope(_ bubble: Bubble) -> BubbleBoardScope {
        let scopes = bubbleStore.boardScopes(for: bubble)
        if let scope, scopes.contains(scope) { return scope }
        return .everyone
    }

    private func content(_ bubble: Bubble) -> some View {
        let current = activeScope(bubble)
        let rows = bubbleStore.board(for: bubble, scope: current)
        let myIndex = rows.firstIndex { $0.user.id == appStore.me.id }
        return ScrollView {
            VStack(spacing: 16) {
                header(bubble)
                Picker("Scope", selection: Binding(get: { current }, set: { scope = $0 })) {
                    ForEach(bubbleStore.boardScopes(for: bubble)) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, FBMetrics.screenPadding)

                if rows.isEmpty {
                    empty(bubble, scope: current)
                } else {
                    BubblePodium(entries: Array(rows.prefix(3)), bubble: bubble)
                    if rows.count > 3 {
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()).dropFirst(3), id: \.element.id) { index, entry in
                                BubbleBoardRow(rank: index + 1, entry: entry, bubble: bubble)
                                    .padding(.horizontal, FBMetrics.screenPadding)
                                    .onAppear { if entry.user.id == appStore.me.id { myRowVisible = true } }
                                    .onDisappear { if entry.user.id == appStore.me.id { myRowVisible = false } }
                                HairlineDivider(leadingInset: 76)
                            }
                        }
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .safeAreaInset(edge: .bottom) {
            if let myIndex, myIndex >= 3, !myRowVisible {
                VStack(spacing: 0) {
                    HairlineDivider()
                    BubbleBoardRow(rank: myIndex + 1, entry: rows[myIndex], bubble: bubble)
                        .padding(.horizontal, FBMetrics.screenPadding)
                        .background(FBColor.tintedBlueBackground)
                }
                .background(FBColor.surface)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: myRowVisible)
        .onAppear {
            bubbleStore.loadScores(for: bubble, scope: current)
        }
        .onChange(of: current) { _, scope in
            bubbleStore.loadScores(for: bubble, scope: scope)
        }
    }

    private func header(_ bubble: Bubble) -> some View {
        HStack(spacing: 12) {
            BubbleCoverView(bubble: bubble, showsEmoji: false)
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(bubble.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                if bubble.isDaily {
                    Text("Today")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                } else {
                    Text(bubble.formula.title)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
            }
            Spacer(minLength: 0)
            Button("Play") { router.play(bubble.id) }
                .buttonStyle(.fb(.tinted, expand: false, height: 34))
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.top, 8)
    }

    @ViewBuilder
    private func empty(_ bubble: Bubble, scope: BubbleBoardScope) -> some View {
        let key = scope == .everyone ? bubble.id : BubbleStore.boardKey(bubble.id, scope, groupID: scope == .group ? bubble.group?.id : nil)
        let state = bubbleStore.boardStates[key] ?? .idle
        if state.isLoading {
            LiveDataStateView(kind: .loading, title: "Loading the board…")
        } else if let failure = state.failure {
            LiveDataStateView(kind: .failed(failure), title: "Couldn't load the board") {
                bubbleStore.loadScores(for: bubble, scope: scope)
            }
        } else {
            emptyBoard(bubble, scope: scope)
        }
    }

    private func emptyBoard(_ bubble: Bubble, scope: BubbleBoardScope) -> some View {
        VStack(spacing: 12) {
            BubbleOrb(size: 64)
            Text(scope == .friends ? "None of your friends have played yet" : scope == .group ? "Nobody in the Group has played yet" : "Nobody's on the board yet")
                .font(.fbHeadline)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            Text(bubble.isDaily ? "Play now and set today's score." : "Play and set the first score.")
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
            Button("Play") { router.play(bubble.id) }
                .buttonStyle(.fb(.primary, expand: false, height: 40))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

// MARK: - Podium

struct BubblePodium: View {
    let entries: [BubbleScore]
    let bubble: Bubble

    @Environment(Router.self) private var router
    @Environment(AppStore.self) private var appStore

    var body: some View {
        let palette = BubbleGlow.palette(bubble.paletteID)
        HStack(alignment: .bottom, spacing: 10) {
            ForEach(order, id: \.rank) { slot in
                column(slot.entry, rank: slot.rank, palette: palette)
            }
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.top, 12)
    }

    /// 2nd, 1st, 3rd.
    private var order: [(rank: Int, entry: BubbleScore)] {
        var slots: [(Int, BubbleScore)] = []
        if entries.count > 1 { slots.append((2, entries[1])) }
        if let first = entries.first { slots.append((1, first)) }
        if entries.count > 2 { slots.append((3, entries[2])) }
        return slots.map { (rank: $0.0, entry: $0.1) }
    }

    private func column(_ entry: BubbleScore, rank: Int, palette: BubblePalette) -> some View {
        let avatar: CGFloat = rank == 1 ? 76 : 60
        let height: CGFloat = rank == 1 ? 96 : (rank == 2 ? 74 : 60)
        return VStack(spacing: 6) {
            if rank == 1 {
                Image(systemName: "crown.fill")
                    .font(.system(size: FBIconSize.large))
                    .foregroundStyle(FBColor.feelingYellow)
            }
            Button {
                router.push(.profile(entry.user))
            } label: {
                AvatarView(user: entry.user, size: avatar)
                    .padding(3)
                    .overlay(Circle().strokeBorder(BubbleGlow.iridescent, lineWidth: 3))
                    .bubbleGlow(palette.top, radius: 8, opacity: 0.7)
            }
            .buttonStyle(.plain)
            Text(entry.user.id == appStore.me.id ? "You" : entry.user.firstName)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
                .lineLimit(1)
            BoardWatchReplayButton(entry: entry, bubble: bubble, short: true)
            VStack(spacing: 2) {
                Text("\(rank)")
                    .font(.system(size: 22, weight: .bold, design: .rounded)) // Display text: podium rank
                Text(entry.score.withCommas)
                    .font(.fbMetaEmphasized)
            }
            .foregroundStyle(palette.isDark ? Color.white : palette.ink)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(palette.gradient, in: UnevenRoundedRectangle(topLeadingRadius: FBMetrics.radiusLarge, topTrailingRadius: FBMetrics.radiusLarge, style: .continuous))
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rank). \(entry.user.name), \(entry.score) points")
    }
}

// MARK: - Row

/// One ranked row: rank, avatar, name, score, "Watch Burst" and "Add friend".
struct BubbleBoardRow: View {
    let rank: Int
    let entry: BubbleScore
    let bubble: Bubble
    var compact = false

    @Environment(Router.self) private var router
    @Environment(AppStore.self) private var appStore

    private var isMe: Bool { entry.user.id == appStore.me.id }

    var body: some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.fbHeadline)
                .foregroundStyle(rank <= 3 ? FBColor.accent : FBColor.secondaryText)
                .frame(width: 24)
            Button {
                router.push(.profile(entry.user))
            } label: {
                AvatarView(user: entry.user, size: FBAvatarSize.post)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(entry.user.name), open profile")
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(isMe ? "You" : entry.user.name)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    if entry.isVerifiedRun {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: FBIconSize.small))
                            .foregroundStyle(FBColor.brandBlue)
                            .accessibilityLabel("Verified run")
                    }
                }
                HStack(spacing: 6) {
                    Text(entry.score.withCommas + " pts")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    BoardWatchReplayButton(entry: entry, bubble: bubble)
                }
            }
            Spacer(minLength: 0)
            if !compact, !isMe, !entry.user.isFriend {
                friendButton
            }
        }
        .frame(minHeight: 56)
    }

    @ViewBuilder
    private var friendButton: some View {
        switch entry.user.friendship {
        case .requestSent:
            Text("Requested")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(FBColor.buttonGray, in: Capsule())
        case .requestReceived:
            Button("Confirm") {
                appStore.sendRequest(to: entry.user)
                FeedEventReporter.shared.note(.addedFriend, gameID: bubble.id)
            }
                .buttonStyle(.fb(.primary, expand: false, height: 32))
        default:
            Button("Add friend") {
                Haptics.light()
                withAnimation { appStore.sendRequest(to: entry.user) }
                BracketHooks.met(entry.user, on: bubble.group.map { .group($0.id) } ?? .newFriend)
                FeedEventReporter.shared.note(.addedFriend, gameID: bubble.id)
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 32))
            .accessibilityLabel("Add \(entry.user.name) as a friend")
        }
    }
}

// MARK: - Watch replay

/// "Watch replay" on a board entry: plays its run as a Burst. Your own run is on the row already;
/// a friend's or Group-mate's comes from the server (`replayAvailable`) when tapped.
struct BoardWatchReplayButton: View {
    let entry: BubbleScore
    let bubble: Bubble
    /// The podium's narrow columns: "Watch".
    var short = false

    @Environment(Router.self) private var router
    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @State private var loading = false

    var body: some View {
        if entry.replay != nil || entry.hasServerReplay {
            Button(action: watch) {
                HStack(spacing: 4) {
                    if loading {
                        ProgressView().controlSize(.mini)
                    }
                    Label(short ? "Watch" : "Watch replay", systemImage: "play.circle.fill")
                        .labelStyle(.titleAndIcon)
                }
                .font(.fbMetaEmphasized)
                .foregroundStyle(FBColor.accent)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(loading)
            .accessibilityLabel("Watch replay, \(entry.user.name)")
        }
    }

    private func watch() {
        if let replay = entry.replay {
            router.play(bubble.id, replay: replay)
            return
        }
        loading = true
        Task { @MainActor in
            defer { loading = false }
            do {
                if let replay = try await bubbleStore.watchableReplay(for: entry, in: bubble) {
                    router.play(bubble.id, replay: replay)
                }
            } catch {
                appStore.showToast("Couldn't load \(entry.user.firstName)'s run: \(error.localizedDescription)", symbol: "exclamationmark.circle")
            }
        }
    }
}
