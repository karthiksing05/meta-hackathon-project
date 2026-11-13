import SwiftUI

/// "Group leaderboards" on a Group's Games tab: each game made for the Group with its top members,
/// from the server's Group-scoped boards (`GET /v1/groups/{id}/games`, then
/// `GET /v1/games/{id}/leaderboard?scope=group&groupId=`). Nothing is added up on the phone; the
/// overall weekly board comes when the server serves one.
struct GroupGameBoardsSection: View {
    let group: FBGroup

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    @State private var games: [Bubble] = []
    @State private var state: FeedLoadState = .idle

    /// How many games and rows to show; the full board is one tap away.
    private let maxGames = 5
    private let rowsPerGame = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "trophy.fill")
                    .foregroundStyle(FBColor.pollOrange)
                    .accessibilityHidden(true)
                Text("Group leaderboards")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
            }
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FBColor.surface)
        .task(id: group.id) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .gamesAccountChanged)) { _ in
            Task { await load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if state.isLoading && games.isEmpty {
            LiveDataStateView(kind: .loading, title: "Loading the Group's boards…")
        } else if let failure = state.failure, games.isEmpty {
            LiveDataStateView(kind: .failed(failure), title: "Couldn't load the Group's games") {
                Task { await load() }
            }
        } else if games.isEmpty {
            LiveDataStateView(
                kind: .empty(group.isMember ? "Make one for the Group and its best scores show up here." : "Join the Group to play its games and get on the boards."),
                title: "No boards yet",
                action: group.isMember
                    ? LiveDataStateView.Action(title: "Make one for the Group", symbol: "sparkles") {
                        router.openStudio(StudioLaunch(mode: .create, groupID: group.id))
                    }
                    : LiveDataStateView.Action(title: "Join the Group", symbol: "person.3.fill") {
                        bubbleStore.join(group) { Task { await load() } }
                    }
            )
        } else {
            VStack(spacing: 14) {
                ForEach(games.prefix(maxGames)) { game in
                    gameBoard(game)
                }
            }
        }
    }

    private func gameBoard(_ game: Bubble) -> some View {
        let rows = bubbleStore.scopedBoards[BubbleStore.boardKey(game.id, .group, groupID: group.id)] ?? []
        let key = BubbleStore.boardKey(game.id, .group, groupID: group.id)
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                router.push(.bubbleBoard(game.id))
            } label: {
                HStack(spacing: 10) {
                    BubbleCoverView(bubble: game, showsEmoji: false)
                        .frame(width: 36, height: 36)
                        .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                    Text(game.title)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Text("See all")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(game.title) Group board")

            if rows.isEmpty {
                HStack(spacing: 8) {
                    Text(bubbleStore.boardStates[key]?.isLoading == true ? "Loading…" : "Nobody in the Group has played yet.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    Spacer(minLength: 0)
                    if bubbleStore.boardStates[key]?.isLoading != true {
                        Button("Play first") { router.play(game.id) }
                            .buttonStyle(.fb(.tinted, expand: false, height: 32))
                            .accessibilityLabel("Play \(game.title) first")
                    }
                }
                .padding(.leading, 46)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.prefix(rowsPerGame).enumerated()), id: \.element.id) { index, entry in
                        BubbleBoardRow(rank: index + 1, entry: entry, bubble: game, compact: true)
                    }
                }
            }
        }
    }

    @MainActor
    private func load() async {
        state = .loading
        do {
            let loaded = try await bubbleStore.loadGames(inGroup: group.id)
            games = loaded
            state = .idle
            for game in loaded.prefix(maxGames) {
                bubbleStore.loadScores(for: game, scope: .group, groupID: group.id)
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
