import SwiftUI

extension Notification.Name {
    /// A server friendship was just made (`PUT /v1/me/friends/{id}`). `object` is the friend's id.
    /// The app offers a best of 5 with them.
    static let gamesFriendAdded = Notification.Name("gamesFriendAdded")
}

/// Who to offer a best of 5 to, for `.sheet(item:)`.
struct BestOfFiveOffer: Identifiable, Hashable {
    let friendID: String
    var id: String { friendID }
}

/// Offered right after you add a friend: five quick games, head to head, first to 3 wins.
/// Each round is a server challenge ("beat my score", `POST /v1/challenges`); results show in
/// Challenges. Same-seed rounds with verified scores come when the server serves series.
struct BestOfFiveOfferSheet: View {
    let offer: BestOfFiveOffer

    @Environment(AppStore.self) private var appStore
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var sending = false
    @State private var error: String?

    /// Five quick, scored games from the server's feed: microgames first, no dailies.
    private var games: [Bubble] {
        var seen = Set<String>()
        let pool = bubbleStore.feedBubbles.filter { !$0.serverID.isEmpty && !$0.isDaily && seen.insert($0.serverID).inserted }
        let micro = pool.filter { $0.formula.rawValue == "microgame" }
        let rest = pool.filter { $0.formula.rawValue != "microgame" }
        return Array((micro + rest).prefix(5))
    }

    /// "a best of 5" with five games; with fewer on the server, says how many.
    private func matchName(_ count: Int) -> String {
        count >= 5 ? "a best of 5" : count == 1 ? "a 1-game challenge" : "a \(count)-game challenge"
    }

    var body: some View {
        let friend = bubbleStore.resolvePerson(offer.friendID)
        let picks = games
        NavigationStack {
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    HStack(spacing: -10) {
                        AvatarView(user: appStore.me, size: FBAvatarSize.compact)
                        AvatarView(user: friend, size: FBAvatarSize.compact)
                    }
                    Text("You and \(friend.firstName) are friends")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Text(picks.count >= 5 ? "Break the ice with a best of 5: five quick games, first to 3 wins." : "Break the ice with \(matchName(picks.count)): quick games, head to head.")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 8)

                if picks.isEmpty {
                    LiveDataStateView(kind: .empty("No games on the server yet to play together."), title: "No games yet")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(picks.enumerated()), id: \.element.id) { index, game in
                            HStack(spacing: 12) {
                                Text("\(index + 1)")
                                    .font(.fbHeadline)
                                    .foregroundStyle(FBColor.secondaryText)
                                    .frame(width: 20)
                                BubbleCoverView(bubble: game, showsEmoji: false)
                                    .frame(width: 36, height: 36)
                                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                                Text(game.title)
                                    .font(.fbBody)
                                    .foregroundStyle(FBColor.primaryText)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 6)
                        }
                    }
                    .padding(.horizontal, FBMetrics.screenPadding)
                }

                if let error {
                    Text(error)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.notificationRed)
                        .multilineTextAlignment(.center)
                }

                Spacer(minLength: 0)

                Button {
                    start(picks, friend: friend)
                } label: {
                    HStack(spacing: 8) {
                        if sending { ProgressView().tint(.white) }
                        Text("Challenge \(friend.firstName) to \(matchName(picks.count))")
                    }
                }
                .buttonStyle(.fb(.primary, height: 44))
                .disabled(sending || picks.isEmpty)
                .padding(.horizontal, FBMetrics.screenPadding)

                Button("Not now") { dismiss() }
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.bottom, 12)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func start(_ picks: [Bubble], friend: User) {
        sending = true
        error = nil
        Task { @MainActor in
            do {
                let sent = try await ChallengeInbox.shared.send(gameIDs: picks.map(\.id), to: offer.friendID)
                Haptics.success()
                appStore.showToast("Sent \(friend.firstName) \(sent) \(sent == 1 ? "game" : "games") to play", symbol: "trophy.fill")
                dismiss()
                router.push(.challengesInbox)
            } catch {
                self.error = "Couldn't send: \(error.localizedDescription)"
                Haptics.warning()
            }
            sending = false
        }
    }
}
