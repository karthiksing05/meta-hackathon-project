import SwiftUI

/// Your challenges from the server: friends who challenged you (beat their score, then it shows as
/// beaten) and the ones you sent (each friend's best so far). Opened from the games tab's trophy.
struct ChallengesInboxView: View {
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router

    private var inbox: ChallengeInbox { ChallengeInbox.shared }

    var body: some View {
        List {
            let matches = ServerBracketService.shared.active
            if !matches.isEmpty {
                Section("Your matches") {
                    ForEach(matches) { match in
                        BracketCardView(bracket: match, opponent: matchOpponent(match))
                            .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                            .listRowBackground(Color.clear)
                    }
                }
            }
            let rounds = RoundsCenter.shared.list(nil)
            if !rounds.isEmpty {
                Section(RoundsCopy.rounds) {
                    ForEach(rounds) { round in
                        RoundCardView(round: round, placeName: nil, lineLimit: 1)
                            .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                            .listRowBackground(Color.clear)
                    }
                }
            }
            if inbox.items.isEmpty && matches.isEmpty && rounds.isEmpty {
                Section { emptyState }
            } else {
                if !inbox.received.isEmpty {
                    Section("Challenges for you") {
                        ForEach(inbox.received) { receivedRow($0) }
                    }
                }
                if !inbox.sent.isEmpty {
                    Section("Challenges you sent") {
                        ForEach(inbox.sent) { sentRow($0) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Challenges")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    router.push(.findFriends)
                } label: {
                    Image(systemName: "person.badge.plus")
                }
                .accessibilityLabel("Find friends")
            }
        }
        .refreshable { inbox.reload(); ServerBracketService.shared.reload(); RoundsCenter.shared.load(nil, quiet: true) }
        .onAppear { inbox.reload(); ServerBracketService.shared.reload(); RoundsCenter.shared.load(nil, quiet: true) }
    }

    @ViewBuilder
    private var emptyState: some View {
        if inbox.state.isLoading {
            LiveDataStateView(kind: .loading, title: "Loading your challenges…")
        } else if let failure = inbox.state.failure {
            LiveDataStateView(kind: .failed(failure), title: "Couldn't load your challenges") { inbox.reload() }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "trophy")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(FBColor.pollOrange)
                Text("No challenges yet")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text("Add a friend and challenge them to a best of 5, or tap Challenge after a game.")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .multilineTextAlignment(.center)
                Button("Find friends") { router.push(.findFriends) }
                    .buttonStyle(.fb(.primary, expand: false, height: 36))
                    .padding(.top, 6)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    private func matchOpponent(_ match: FriendBracket) -> User {
        let p = ServerBracketService.shared.opponent(of: match)
        return bubbleStore.person(id: match.opponentID, name: p.map { $0.displayName.isEmpty ? $0.username : $0.displayName } ?? "Friend",
                                  isFriend: true)
    }

    private func receivedRow(_ c: RemoteChallenge) -> some View {
        let name = c.from.displayName.isEmpty ? c.from.username : c.from.displayName
        let target = Int(c.score.rounded())
        return HStack(spacing: 12) {
            gameThumb(c)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(name) challenged you")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text("Beat \(target.withCommas) in \(c.game?.title ?? "a game")")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
                if c.beaten {
                    Label("Beaten · your best \(Int((c.myScore ?? 0).rounded()).withCommas)", systemImage: "checkmark.circle.fill")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.online)
                } else if let mine = c.myScore {
                    Text("Your best: \(Int(mine.rounded()).withCommas)")
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                }
            }
            Spacer(minLength: 0)
            if !c.beaten, c.game != nil {
                Button("Play") { play(c) }
                    .buttonStyle(.fb(.primary, expand: false, height: 32))
            }
        }
        .padding(.vertical, 4)
    }

    private func sentRow(_ c: RemoteChallenge) -> some View {
        let target = Int(c.score.rounded())
        let beat = c.responses.filter(\.beat).count
        return HStack(spacing: 12) {
            gameThumb(c)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.game?.title ?? "A game")
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(1)
                Text("Your score to beat: \(target.withCommas)")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                if c.responses.isEmpty {
                    Text("Waiting for them to play")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.tertiaryText)
                } else {
                    ForEach(c.responses, id: \.userID) { r in
                        Text("\(r.shownName): \(r.display ?? Int(r.score.rounded()).withCommas)\(r.beat ? " · beat you" : "")")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(r.beat ? FBColor.notificationRed : FBColor.online)
                    }
                }
            }
            Spacer(minLength: 0)
            if beat > 0, c.game != nil {
                Button("Rematch") { play(c) }
                    .buttonStyle(.fb(.tinted, expand: false, height: 32))
            }
        }
        .padding(.vertical, 4)
    }

    private func gameThumb(_ c: RemoteChallenge) -> some View {
        RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous)
            .fill(GameColor.accentGradient)
            .frame(width: 44, height: 44)
            .overlay {
                Image(systemName: "gamecontroller.fill")
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }

    private func play(_ c: RemoteChallenge) {
        guard let game = c.game else { return }
        Task { @MainActor in
            if let bubble = await bubbleStore.adopt(game) {
                router.play(bubble.id)
            }
        }
    }
}
