import SwiftUI

enum FriendsRowMode {
    case request
    case suggestion
}

/// A person row with 80 pt avatar, mutual friends and action buttons.
/// The visible state is derived from the user's live `friendship`, so a handled row stays in place.
struct FriendsPersonRow: View {
    let user: User
    let mode: FriendsRowMode

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    private enum Status {
        case pending
        case accepted
        case removed
        case sent
        case nowFriends
    }

    private var status: Status {
        switch mode {
        case .request:
            switch user.friendship {
            case .requestReceived: return .pending
            case .friends: return .accepted
            case .me, .none, .requestSent: return .removed
            }
        case .suggestion:
            if store.dismissedSuggestionIDs.contains(user.id) { return .removed }
            switch user.friendship {
            case .requestSent: return .sent
            case .friends: return .nowFriends
            case .me, .none, .requestReceived: return .pending
            }
        }
    }

    private var statusKey: Int {
        switch status {
        case .pending: return 0
        case .accepted: return 1
        case .removed: return 2
        case .sent: return 3
        case .nowFriends: return 4
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                router.push(.profile(user))
            } label: {
                AvatarView(user: user, size: FBAvatarSize.request)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 6) {
                headerLine
                mutualLine
                actions
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .animation(.easeInOut(duration: 0.22), value: statusKey)
    }

    private var headerLine: some View {
        HStack(alignment: .firstTextBaseline) {
            Button {
                router.push(.profile(user))
            } label: {
                NameWithBadge(user: user, font: .fbHeadline)
            }
            .buttonStyle(.plain)
            Spacer(minLength: 4)
            if mode == .request, let date = user.requestDate {
                Text(date.fbShort)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
            }
        }
    }

    @ViewBuilder
    private var mutualLine: some View {
        if user.mutualFriendCount > 0 {
            HStack(spacing: 6) {
                AvatarStack(users: store.mutualFriends(with: user), size: FBAvatarSize.tiny)
                Text("\(user.mutualFriendCount) mutual friends")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch status {
        case .pending:
            HStack(spacing: 8) {
                Button(mode == .request ? "Confirm" : "Add friend") {
                    Haptics.light()
                    if mode == .request {
                        store.confirmRequest(from: user)
                    } else {
                        store.sendRequest(to: user)
                    }
                }
                .buttonStyle(.fb(.primary, height: 36))
                Button(mode == .request ? "Delete" : "Remove") {
                    Haptics.light()
                    if mode == .request {
                        store.deleteRequest(from: user)
                    } else {
                        store.dismissSuggestion(user)
                    }
                }
                .buttonStyle(.fb(.secondary, height: 36))
            }
        case .accepted:
            statusText("Request accepted")
        case .removed:
            statusText(mode == .request ? "Request removed" : "Removed")
        case .sent:
            HStack(spacing: 8) {
                Text("Request sent")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button("Cancel") {
                    Haptics.light()
                    store.cancelRequest(to: user)
                }
                .buttonStyle(.fb(.secondary, height: 36))
            }
        case .nowFriends:
            statusText("You're now friends")
        }
    }

    private func statusText(_ text: String) -> some View {
        Text(text)
            .font(.fbBody)
            .foregroundStyle(FBColor.secondaryText)
            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
    }
}

/// A plain vertical list of `FriendsPersonRow`s.
struct FriendsPeopleList: View {
    let users: [User]
    let mode: FriendsRowMode

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(users) { user in
                FriendsPersonRow(user: user, mode: mode)
            }
        }
    }
}
