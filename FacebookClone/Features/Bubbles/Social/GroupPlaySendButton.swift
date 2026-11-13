import SwiftUI

/// The finished game's main "play it together" action, labelled by how the game compares results
/// (`group_play.mode` in its manifest, or the plan's `social` part when Studio just made it):
/// "Challenge a friend: best of 3", "Start a Group round", "Compare picks with your Group".
///
/// It only routes to flows that already exist; it makes no new server calls:
/// - a head-to-head or a Group round: `ChallengePickerSheet` (a friend gets a same-seed challenge;
///   a group chat or a Group gets a shared session, docs/BUBBLES.md 7.2);
/// - a best of 3 or 5: pick a friend, then `ServerBracketService.start` (`POST /v1/series`) with
///   this game in every round, so each round is a fresh server seed;
/// - the Group's week and opinion games: `RemixShareSheet` (a playable card to a chat or Group,
///   with no "beat me" line, since opinion games have no winner).
///
/// A microgame on the server goes to a server round instead (`RoundDestinationSheet`,
/// `POST /v1/rounds`): pick a Group or friends, everyone plays the server's seed, the server replays
/// each run and ranks them (or says how in sync an opinion game's picks are).
struct GroupPlaySendButton: View {
    let bubble: Bubble
    /// Known already (Studio's plan). Nil reads `group_play` from the published manifest.
    var info: GroupPlayInfo? = nil

    @Environment(AppStore.self) private var appStore
    @State private var loaded: GroupPlayInfo?
    @State private var sheet: Sheet?

    private enum Sheet: String, Identifiable {
        case challenge, share, series, round
        var id: String { rawValue }
    }

    private var resolved: GroupPlayInfo { info ?? loaded ?? .fallback }

    var body: some View {
        Button {
            Haptics.light()
            sheet = route(for: resolved)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: resolved.symbol)
                    .font(.system(size: FBIconSize.medium, weight: .bold))
                Text(resolved.sendLabel)
                    .font(.fbButton)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.fb(.tinted, height: 44))
        .accessibilityHint("Everyone plays the same game, then you compare")
        .task(id: bubble.id) {
            guard info == nil, loaded == nil else { return }
            loaded = await Self.load(bubble)
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .challenge:
                ChallengePickerSheet(bubbleID: bubble.id, draft: ChallengeCenter.shared.bestDraft(for: bubble))
            case .share:
                RemixShareSheet(bubble: bubble)
            case .series:
                GroupPlaySeriesPicker(bubble: bubble, bestOf: resolved.bestOf)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            case .round:
                RoundDestinationSheet(bubble: bubble, mode: resolved.mode == .series ? nil : resolved.mode.rawValue)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    private func route(for info: GroupPlayInfo) -> Sheet {
        let onServer = bubble.formula == .microgame && !bubble.serverID.isEmpty
        if onServer, info.mode != .series { return .round }
        switch info.mode {
        case .sameSeedAsync, .groupRound:
            return info.compare == "agreement" ? .share : .challenge
        case .series:
            // Series are for microgames the server has (their runs are replayed); else a challenge.
            return bubble.formula == .microgame && !bubble.serverID.isEmpty ? .series : .challenge
        case .weeklyBoard, .opinionCompare:
            return .share
        }
    }

    /// `group_play` from the game's published manifest (`GET /v1/games/{id}` for its URL, then the
    /// manifest itself). Nil when the game has none or the server can't be reached.
    static func load(_ bubble: Bubble) async -> GroupPlayInfo? {
        let api = GamesAPIFactory.current
        let id = bubble.serverID.isEmpty ? bubble.id : bubble.serverID
        guard let game = try? await api.game(id: id),
              let data = try? await api.fetch(game.manifestURL),
              let manifest = try? JSONValue.parse(data) else { return nil }
        return GroupPlayInfo(manifest: manifest)
    }
}

/// Pick the friend for a best of N on one game. Starting it is `ServerBracketService.start`, the
/// same server series the bracket card and Challenges show.
private struct GroupPlaySeriesPicker: View {
    let bubble: Bubble
    let bestOf: Int

    @Environment(AppStore.self) private var appStore
    @Environment(\.dismiss) private var dismiss
    @State private var startingID: String?
    @State private var failure: String?

    private var friends: [User] {
        BubbleSocialHub.targets(appStore: appStore, kinds: [.friend]).compactMap { appStore.user(id: $0.targetID) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("You each play \(bubble.title) \(bestOf) times on the same courses. Most rounds wins.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Section("Friends") {
                    if friends.isEmpty {
                        Text("Add a friend to play a best of \(bestOf).")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    ForEach(friends) { friend in
                        row(friend)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Best of \(bestOf)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func row(_ friend: User) -> some View {
        HStack(spacing: 12) {
            AvatarView(user: friend, size: FBAvatarSize.comment)
            Text(friend.name)
                .font(.fbName)
                .foregroundStyle(FBColor.primaryText)
            Spacer(minLength: 8)
            Button {
                start(with: friend)
            } label: {
                if startingID == friend.id {
                    ProgressView()
                } else {
                    Text("Challenge")
                }
            }
            .buttonStyle(.fb(.primary, expand: false, height: 32))
            .disabled(startingID != nil)
        }
        .frame(minHeight: 44)
    }

    private func start(with friend: User) {
        Haptics.light()
        startingID = friend.id
        failure = nil
        Task { @MainActor in
            do {
                try await ServerBracketService.shared.start(with: friend.id, games: Array(repeating: bubble, count: bestOf))
                appStore.showToast("Best of \(bestOf) started with \(friend.firstName)", symbol: "trophy.fill")
                dismiss()
            } catch {
                failure = "Couldn't start it: \(error.localizedDescription) Try again."
                startingID = nil
            }
        }
    }
}
