import SwiftUI

/// The Games tab: composer, challenge strip and the Scroll Games feed.
struct ScrollGamesHomeView: View {
    @Environment(Router.self) private var router
    @State private var sg = SGStore()
    @State private var isCreating = false
    @State private var isShowingServer = false
    @State private var playRequest: SGPlayRequest?
    @State private var profileUser: SGUser?

    private let topAnchor = "sg.top"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    Color.clear.frame(height: 0).id(topAnchor)
                    TabHeader("Scroll Games") {
                        CircleButton(accessibilityLabel: "Server settings", action: { isShowingServer = true }) {
                            Image(systemName: "gearshape")
                                .font(.system(size: FBIconSize.regular, weight: .semibold))
                                .foregroundStyle(FBColor.primaryText)
                        }
                        CircleButton(accessibilityLabel: "Make a game", action: { isCreating = true }) {
                            Image(systemName: "plus")
                                .font(.system(size: FBIconSize.regular, weight: .semibold))
                                .foregroundStyle(FBColor.primaryText)
                        }
                    }
                    if sg.isOffline {
                        offlineBanner
                    }
                    composerRow
                    FeedSeparator()
                    challengesStrip
                    feedContent
                }
            }
            .refreshable { await sg.refresh() }
            .onChange(of: router.scrollToTopSignal(for: .games)) {
                withAnimation { proxy.scrollTo(topAnchor, anchor: .top) }
            }
        }
        .background(FBColor.surface)
        .safeAreaInset(edge: .top, spacing: 0) {
            SGStatusBarBackdrop()
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await sg.refresh() }
        .onAppear { warmUpIfSelected() }
        .onChange(of: router.selectedTab) { warmUpIfSelected() }
        .fullScreenCover(isPresented: $isCreating) {
            SGCreateFlowView { game, item in
                sg.insertPublished(game: game, feedItem: item)
                Task {
                    try? await Task.sleep(for: .seconds(1))
                    await sg.refresh()
                }
            }
            .environment(sg)
        }
        .fullScreenCover(item: $playRequest) { request in
            SGPlayFlowView(request: request)
                .onDisappear { Task { await sg.refresh() } }
        }
        .sheet(item: $profileUser) { user in
            SGCreatorProfileView(user: user) { game in
                profileUser = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    playRequest = SGPlayRequest(game: game)
                }
            }
            .environment(sg)
        }
        .sheet(isPresented: $isShowingServer) {
            SGServerSettingsView {
                Task { await sg.refresh() }
            }
        }
        .environment(sg)
    }

    private func warmUpIfSelected() {
        if router.selectedTab == .games {
            SGWebViewPool.shared.warmUp()
        }
    }

    // MARK: Sections

    private var offlineBanner: some View {
        HStack(spacing: FBSpacing.s) {
            Image(systemName: "wifi.slash")
            Text("Offline: showing sample games. Can't reach \(SGConfig.baseURL.host() ?? "the server").")
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, FBSpacing.s)
        .background(FBColor.feelingYellow.opacity(0.18))
    }

    private var composerRow: some View {
        Button {
            isCreating = true
        } label: {
            HStack(spacing: FBSpacing.m) {
                AvatarView(user: sg.me.appUser, size: FBAvatarSize.post)
                HStack(spacing: FBSpacing.s) {
                    Image(systemName: "sparkles")
                    Text("Make a game")
                        .font(.fbButton)
                    Spacer(minLength: 0)
                    Text("From your photos")
                        .font(.fbCaption)
                        .opacity(0.85)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, FBSpacing.l)
                .frame(height: 44)
                .background(FBColor.brandBlue, in: Capsule())
            }
            .padding(.horizontal, FBMetrics.screenPadding)
            .padding(.vertical, FBSpacing.m)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Make a game")
    }

    @ViewBuilder
    private var challengesStrip: some View {
        if !sg.challenges.isEmpty {
            VStack(alignment: .leading, spacing: FBSpacing.s) {
                SectionHeader(title: "Challenges for you")
                    .padding(.horizontal, FBMetrics.gutter)
                    .padding(.top, FBSpacing.m)
                ScrollView(.horizontal) {
                    HStack(spacing: FBSpacing.s) {
                        ForEach(sg.challenges) { item in
                            SGChallengeTile(item: item) { play(item) }
                        }
                    }
                    .padding(.horizontal, FBMetrics.gutter)
                }
                .scrollIndicators(.hidden)
                .padding(.bottom, FBSpacing.m)
            }
            FeedSeparator()
        }
    }

    @ViewBuilder
    private var feedContent: some View {
        switch sg.state {
        case .loading:
            ForEach(0..<3, id: \.self) { _ in
                SGCardSkeleton()
                FeedSeparator()
            }
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load games", systemImage: "gamecontroller")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await sg.refresh() } }
                    .buttonStyle(.fb(.primary, expand: false))
            }
            .padding(.vertical, FBSpacing.xxl)
        case .loaded:
            if sg.feedItems.isEmpty {
                ContentUnavailableView {
                    Label("No games yet", systemImage: "gamecontroller")
                } description: {
                    Text("Make the first one from your photos.")
                } actions: {
                    Button("Make a game") { isCreating = true }
                        .buttonStyle(.fb(.primary, expand: false))
                }
                .padding(.vertical, FBSpacing.xxl)
            } else {
                ForEach(sg.feedItems) { item in
                    SGFeedCard(
                        item: item,
                        onPlay: { play(item) },
                        onProfile: { profileUser = $0 }
                    )
                    FeedSeparator()
                }
            }
        }
    }

    private func play(_ item: SGFeedItem) {
        guard let game = item.game else { return }
        Haptics.light()
        var request = SGPlayRequest(game: game)
        if item.kind == .challenge, let challenge = item.challenge {
            request.challengeID = challenge.id
            if let seed = challenge.seed { request.seed = seed }
        }
        playRequest = request
    }
}

// MARK: - Cards

private struct SGChallengeTile: View {
    let item: SGFeedItem
    let onBeat: () -> Void

    var body: some View {
        let game = item.game
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack(spacing: FBSpacing.s) {
                if let actor = item.actor {
                    AvatarView(user: actor.appUser, size: FBAvatarSize.comment)
                }
                Text(game?.emoji ?? "🎮")
                    .font(.system(size: 28)) // Display emoji
                Spacer(minLength: 0)
            }
            Text(challengeText)
                .font(.fbName)
                .foregroundStyle(.white)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            Button("Beat them", action: onBeat)
                .buttonStyle(.fb(.secondary, height: 32))
        }
        .padding(FBSpacing.m)
        .frame(width: 220, height: 168)
        .background(
            SGPalette.gradient(for: game?.palette ?? item.id),
            in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }

    private var challengeText: String {
        if !item.text.isEmpty { return item.text }
        let name = item.actor?.firstName ?? "Someone"
        let score = item.challenge?.score.map(String.init) ?? "a high score"
        return "\(name) scored \(score) on \(game?.title ?? "a game"). Beat them?"
    }

    private var game: SGGame? { item.game }
}

private struct SGFeedCard: View {
    @Environment(SGStore.self) private var sg
    let item: SGFeedItem
    let onPlay: () -> Void
    let onProfile: (SGUser) -> Void

    var body: some View {
        if let game = item.game {
            let creator = sg.creator(of: game, fallback: item.actor)
            VStack(alignment: .leading, spacing: 0) {
                header(creator: creator)
                banner(game: game)
                footer(game: game)
            }
            .background(FBColor.surface)
        }
    }

    private var actor: SGUser? { item.actor }

    private func header(creator: SGUser) -> some View {
        let shown = actor ?? creator
        return HStack(spacing: 10) {
            Button { onProfile(shown) } label: {
                HStack(spacing: 10) {
                    AvatarView(user: shown.appUser, size: FBAvatarSize.post)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(shown.name)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.top, FBMetrics.gutter)
        .padding(.bottom, FBSpacing.s)
    }

    private var subtitle: String {
        let when = item.date?.fbShort
        let what: String
        switch item.kind {
        case .score: what = "shared a score"
        case .challenge: what = "sent a challenge"
        case .game: what = "published a game"
        }
        return when.map { "\(what) · \($0)" } ?? what
    }

    private func banner(game: SGGame) -> some View {
        ZStack(alignment: .bottomLeading) {
            SGPalette.gradient(for: game.palette)
            Text(game.emoji)
                .font(.system(size: 120)) // Display emoji
                .opacity(0.35)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(FBSpacing.m)
            VStack(alignment: .leading, spacing: FBSpacing.xs) {
                if item.kind == .score, let play = item.play {
                    Text("\(play.score)")
                        .font(.system(size: 48, weight: .bold)) // Display score
                        .foregroundStyle(.white)
                }
                Text(game.title)
                    .font(.fbTitle)
                    .foregroundStyle(.white)
                if !game.description.isEmpty && item.kind == .game {
                    Text(game.description)
                        .font(.fbBody)
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                }
                if !item.text.isEmpty && item.kind != .game {
                    Text(item.text)
                        .font(.fbBody)
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                }
            }
            .padding(FBMetrics.gutter)
        }
        .frame(height: 170)
        .clipped()
    }

    private func footer(game: SGGame) -> some View {
        HStack {
            Label("\(game.stats.plays.fbCompact) plays", systemImage: "gamecontroller")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            Spacer()
            Button(item.kind == .game ? "Play" : "Beat it", action: onPlay)
                .buttonStyle(.fb(.primary, expand: false, height: 32))
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.vertical, FBSpacing.s)
    }
}

private struct SGCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: FBSpacing.s) {
            HStack(spacing: 10) {
                Circle().fill(FBColor.skeleton).frame(width: FBAvatarSize.post, height: FBAvatarSize.post)
                VStack(alignment: .leading, spacing: 6) {
                    SkeletonBlock(width: 120, height: 12)
                    SkeletonBlock(width: 80, height: 10)
                }
            }
            SkeletonBlock(height: 170, cornerRadius: 0)
            SkeletonBlock(width: 90, height: 12)
        }
        .padding(FBMetrics.gutter)
        .shimmering()
    }
}

// MARK: - Settings

private struct SGServerSettingsView: View {
    @AppStorage(SettingsKey.scrollGamesBaseURL) private var baseURL = SGConfig.defaultBaseURL
    @Environment(\.dismiss) private var dismiss
    let onSave: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("http://localhost:8787", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Server address")
                } footer: {
                    Text("The simulator reaches your Mac at localhost. On a device, use your Mac's LAN address.")
                }
            }
            .navigationTitle("Scroll Games server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onSave()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

/// Paints the status bar area so feed content doesn't scroll visibly behind the clock.
private struct SGStatusBarBackdrop: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .background(FBColor.surface.ignoresSafeArea(edges: .top))
            .allowsHitTesting(false)
    }
}
