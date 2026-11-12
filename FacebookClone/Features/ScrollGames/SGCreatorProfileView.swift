import SwiftUI

/// A creator's games, with a Follow button saved on the server.
struct SGCreatorProfileView: View {
    @Environment(SGStore.self) private var sg
    @Environment(\.dismiss) private var dismiss
    let user: SGUser
    let onPlay: (SGGame) -> Void

    var body: some View {
        let games = sg.games(by: user.id)
        let following = sg.isFollowing(user.id)

        NavigationStack {
            ScrollView {
                VStack(spacing: FBSpacing.m) {
                    AvatarView(user: user.appUser, size: FBAvatarSize.row)
                    Text(user.name)
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Text("\(games.count) \(games.count == 1 ? "game" : "games")")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                    if user.id != SGConfig.userID {
                        Button {
                            Haptics.light()
                            let target = !following
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                                sg.toggleFollow(user.id)
                            }
                            Task {
                                do {
                                    try await SGFollowService.setFollowing(target, userID: user.id)
                                } catch {
                                    if sg.isFollowing(user.id) == target { sg.toggleFollow(user.id) }
                                }
                            }
                        } label: {
                            Label(following ? "Following" : "Follow", systemImage: following ? "checkmark" : "plus")
                        }
                        .buttonStyle(.fb(following ? .secondary : .primary, expand: false, height: 36))
                    }
                }
                .padding(FBMetrics.screenPadding)

                HairlineDivider()

                if games.isEmpty {
                    ContentUnavailableView(
                        "No games yet",
                        systemImage: "gamecontroller",
                        description: Text("\(user.firstName) hasn't published a game.")
                    )
                    .padding(.top, FBSpacing.xl)
                } else {
                    ForEach(games) { game in
                        row(game)
                        HairlineDivider(leadingInset: 76)
                    }
                }
            }
            .background(FBColor.surface)
            .navigationTitle(user.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ game: SGGame) -> some View {
        HStack(spacing: FBSpacing.m) {
            Text(game.emoji)
                .font(.system(size: 28)) // Display emoji
                .frame(width: 52, height: 52)
                .background(
                    SGPalette.gradient(for: game.palette),
                    in: RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text(game.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text("\(game.stats.plays.fbCompact) plays")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
            Button("Play") { onPlay(game) }
                .buttonStyle(.fb(.primary, expand: false, height: 32))
        }
        .padding(.horizontal, FBMetrics.screenPadding)
        .padding(.vertical, FBSpacing.s)
    }
}
