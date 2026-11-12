import SwiftUI
import UIKit

private enum ProfileTone {
    case blue
    case gray
}

/// A button-looking label that works inside `Menu` (where `ButtonStyle` does not apply).
private struct ProfileButtonLabel: View {
    let title: String
    var symbol: String? = nil
    var tone: ProfileTone = .gray

    var body: some View {
        HStack(spacing: 6) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
            }
            Text(title)
                .font(.fbButton)
                .lineLimit(1)
        }
        .foregroundStyle(tone == .blue ? Color.white : FBColor.primaryText)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: 36)
        .background(
            tone == .blue ? FBColor.brandBlue : FBColor.buttonGray,
            in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous)
        )
        .contentShape(Rectangle())
    }
}

/// The row of action buttons under the profile header. Branches on me / friend / stranger / Page.
struct ProfileActionButtons: View {
    let user: User

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var showMeSheet = false
    @State private var showFriendSheet = false
    @State private var showUnfriendConfirm = false

    private var profileLink: String {
        "https://www.facebook.com/\(user.firstName.lowercased()).\(user.lastName.lowercased())"
    }

    var body: some View {
        Group {
            if user.isMe {
                meButtons
            } else if user.isPage {
                pageButtons
            } else {
                personButtons
            }
        }
        .sheet(isPresented: $showMeSheet) {
            ProfileMeOptionsSheet(user: user, link: profileLink)
                .presentationDetents([.height(300)])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showFriendSheet) {
            ProfileFriendSheet(user: user) {
                Task {
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    showUnfriendConfirm = true
                }
            }
            .presentationDetents([.height(340)])
            .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            "Unfriend \(user.name)?",
            isPresented: $showUnfriendConfirm,
            titleVisibility: .visible
        ) {
            Button("Unfriend", role: .destructive) {
                Haptics.warning()
                store.unfriend(user)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll no longer see each other's friends-only posts.")
        }
    }

    // MARK: Me

    private var meButtons: some View {
        HStack(spacing: 8) {
            Button {
                router.openCreateStory()
            } label: {
                Label("Add to story", systemImage: "plus")
            }
            .buttonStyle(.fb(.primary))

            Button {
                router.push(.editProfile)
            } label: {
                Label("Edit profile", systemImage: "pencil")
            }
            .buttonStyle(.fb(.secondary))

            moreSheetButton
        }
    }

    private var moreSheetButton: some View {
        Button {
            showMeSheet = true
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: FBIconSize.regular, weight: .bold))
                .frame(width: 24)
        }
        .buttonStyle(.fb(.secondary, expand: false))
        .accessibilityLabel("More")
    }

    // MARK: Person

    private var personButtons: some View {
        HStack(spacing: 8) {
            friendshipButton
            messageButton
            moreMenu
        }
    }

    @ViewBuilder
    private var friendshipButton: some View {
        switch user.friendship {
        case .friends:
            Button {
                showFriendSheet = true
            } label: {
                Label("Friends", systemImage: "person.fill.checkmark")
            }
            .buttonStyle(.fb(.secondary))
        case .requestSent:
            Button {
                Haptics.light()
                store.cancelRequest(to: user)
            } label: {
                Label("Cancel request", systemImage: "person.fill.xmark")
            }
            .buttonStyle(.fb(.secondary))
        case .requestReceived:
            Menu {
                Button {
                    Haptics.success()
                    store.confirmRequest(from: user)
                } label: {
                    Label("Confirm", systemImage: "checkmark")
                }
                Button(role: .destructive) {
                    store.deleteRequest(from: user)
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                ProfileButtonLabel(title: "Respond", symbol: "person.fill.questionmark", tone: .blue)
            }
        case .none, .me:
            Button {
                Haptics.light()
                store.sendRequest(to: user)
            } label: {
                Label("Add friend", systemImage: "person.fill.badge.plus")
            }
            .buttonStyle(.fb(.primary))
        }
    }

    private var messageButton: some View {
        Button {
            router.openChat(store.conversation(with: user))
        } label: {
            Label("Message", systemImage: "message.fill")
        }
        .buttonStyle(.fb(user.isFriend || user.isPage ? .primary : .secondary))
    }

    private var moreMenu: some View {
        Menu {
            Button {
                store.showToast("You blocked \(user.name)", symbol: "hand.raised.fill")
            } label: {
                Label("Block", systemImage: "hand.raised")
            }
            Button {
                store.showToast("Thanks for your report", symbol: "flag.fill")
            } label: {
                Label("Report", systemImage: "exclamationmark.bubble")
            }
            Button {
                copyLink()
            } label: {
                Label("Copy link", systemImage: "link")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: FBIconSize.regular, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
                .frame(width: 44, height: 36)
                .background(FBColor.buttonGray, in: RoundedRectangle(cornerRadius: FBMetrics.cornerRadius, style: .continuous))
        }
        .accessibilityLabel("More")
    }

    private func copyLink() {
        UIPasteboard.general.string = profileLink
        store.showToast("Link copied", symbol: "link")
    }

    // MARK: Page

    private var pageButtons: some View {
        HStack(spacing: 8) {
            Button {
                Haptics.light()
                if user.isFollowing {
                    store.unfollow(user)
                } else {
                    store.follow(user)
                }
            } label: {
                if user.isFollowing {
                    Label("Following", systemImage: "checkmark")
                } else {
                    Label("Follow", systemImage: "plus")
                }
            }
            .buttonStyle(.fb(user.isFollowing ? .secondary : .primary))

            messageButton
            moreMenu
        }
    }
}

// MARK: - Sheets

private struct ProfileSheetRow: View {
    let symbol: String
    let title: String
    var destructive: Bool = false

    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(FBColor.buttonGray)
                .frame(width: 40, height: 40)
                .overlay {
                    Image(systemName: symbol)
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                        .foregroundStyle(destructive ? FBColor.notificationRed : FBColor.primaryText)
                }
            Text(title)
                .font(.fbBodyLarge)
                .foregroundStyle(destructive ? FBColor.notificationRed : FBColor.primaryText)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

private struct ProfileMeOptionsSheet: View {
    let user: User
    let link: String

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(FBColor.divider)
                .frame(width: 40, height: 4)
                .padding(.vertical, 10)
            Button {
                dismiss()
                store.showToast("Viewing your profile as the public", symbol: "eye.fill")
            } label: {
                ProfileSheetRow(symbol: "eye", title: "View as")
            }
            .buttonStyle(.plain)

            if let url = URL(string: link) {
                ShareLink(item: url) {
                    ProfileSheetRow(symbol: "square.and.arrow.up", title: "Share profile")
                }
                .buttonStyle(.plain)
            }

            Button {
                dismiss()
                router.push(.comingSoon(title: "Activity log", symbol: "list.bullet.rectangle"))
            } label: {
                ProfileSheetRow(symbol: "list.bullet.rectangle", title: "Activity log")
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .background(FBColor.surface)
    }
}

private struct ProfileFriendSheet: View {
    let user: User
    let onUnfriend: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(FBColor.divider)
                .frame(width: 40, height: 4)
                .padding(.vertical, 10)

            Button {
                store.toggleFavorite(user)
            } label: {
                ProfileSheetRow(
                    symbol: user.isFavorite ? "star.slash" : "star",
                    title: user.isFavorite ? "Remove from Favorites" : "Add to Favorites"
                )
            }
            .buttonStyle(.plain)

            Button {
                if user.isFollowing {
                    store.unfollow(user)
                } else {
                    store.follow(user)
                }
            } label: {
                ProfileSheetRow(
                    symbol: user.isFollowing ? "person.fill.xmark" : "person.fill.badge.plus",
                    title: user.isFollowing ? "Unfollow" : "Follow"
                )
            }
            .buttonStyle(.plain)

            Button {
                dismiss()
                onUnfriend()
            } label: {
                ProfileSheetRow(symbol: "person.crop.circle.badge.minus", title: "Unfriend \(user.firstName)", destructive: true)
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .background(FBColor.surface)
    }
}
