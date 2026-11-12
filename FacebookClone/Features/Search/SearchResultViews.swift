import SwiftUI

/// Builds a Text with the first case-insensitive match of `query` in bold.
func searchHighlighted(_ text: String, query: String) -> Text {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let range = text.range(of: trimmed, options: .caseInsensitive) else {
        return Text(text)
    }
    let before = String(text[text.startIndex..<range.lowerBound])
    let match = String(text[range])
    let after = String(text[range.upperBound...])
    return Text(before) + Text(match).bold() + Text(after)
}

struct SearchSectionTitle: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.fbTitle)
            .foregroundStyle(FBColor.primaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)
    }
}

struct SearchPersonRow: View {
    @Environment(AppStore.self) private var store
    let user: User
    let query: String
    let open: (Route) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button {
                open(.profile(user))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: 60)
                    VStack(alignment: .leading, spacing: 2) {
                        searchHighlighted(user.name, query: query)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            trailing
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var subtitle: String {
        switch user.friendship {
        case .me: return "You"
        case .friends: return "Friend"
        case .requestSent, .requestReceived, .none:
            if user.mutualFriendCount > 0 {
                let suffix = user.mutualFriendCount == 1 ? "mutual friend" : "mutual friends"
                return "\(user.mutualFriendCount) \(suffix)"
            }
            return user.city.isEmpty ? "Person" : user.city
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch user.friendship {
        case .me, .friends:
            EmptyView()
        case .requestSent:
            Text("Requested")
                .font(.fbButton)
                .foregroundStyle(FBColor.secondaryText)
        case .requestReceived:
            Button("Confirm") {
                Haptics.success()
                store.confirmRequest(from: user)
            }
            .buttonStyle(.fb(.primary, expand: false, height: 36))
        case .none:
            Button("Add friend") {
                Haptics.light()
                store.sendRequest(to: user)
            }
            .buttonStyle(.fb(.tinted, expand: false, height: 36))
        }
    }
}

struct SearchPageRow: View {
    @Environment(AppStore.self) private var store
    let page: User
    let query: String
    let open: (Route) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button {
                open(.profile(page))
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: page, size: 60)
                    VStack(alignment: .leading, spacing: 2) {
                        searchHighlighted(page.name, query: query)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text("\(page.category ?? "Page") · \(page.followerCount.fbCompact) followers")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if page.isFollowing {
                Text("Following")
                    .font(.fbButton)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                Button("Follow") {
                    Haptics.light()
                    store.follow(page)
                }
                .buttonStyle(.fb(.tinted, expand: false, height: 36))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

struct SearchGroupRow: View {
    @Environment(AppStore.self) private var store
    let group: FBGroup
    let query: String
    let open: (Route) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button {
                open(.group(group))
            } label: {
                HStack(spacing: 12) {
                    RemoteImage(url: group.coverURL)
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        searchHighlighted(group.name, query: query)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(2)
                        Text("\(group.privacyText) · \(group.memberCount.fbCompact) members")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if group.isMember {
                Text("Joined")
                    .font(.fbButton)
                    .foregroundStyle(FBColor.secondaryText)
            } else {
                Button("Join") {
                    Haptics.light()
                    store.toggleMembership(group)
                }
                .buttonStyle(.fb(.tinted, expand: false, height: 36))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

struct SearchPostRow: View {
    let post: Post
    let query: String
    let open: (Route) -> Void

    var body: some View {
        Button {
            open(.post(post))
        } label: {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(user: post.author, size: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(post.author.name) · \(post.createdAt.fbShort)")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                    searchHighlighted(post.text, query: query)
                        .font(.fbBody)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SearchListingCell: View {
    let listing: Listing
    let open: (Route) -> Void

    var body: some View {
        Button {
            open(.listing(listing))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Color.clear
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        RemoteImage(url: listing.coverURL, data: listing.imageData.first)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(listing.priceText)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(listing.title)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SearchEventRow: View {
    let event: FBEvent
    let query: String
    let open: (Route) -> Void

    var body: some View {
        Button {
            open(.event(event))
        } label: {
            HStack(spacing: 12) {
                RemoteImage(url: event.coverURL)
                    .frame(width: 60, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.startDate.eventStyle)
                        .font(.fbCaption.weight(.semibold))
                        .foregroundStyle(FBColor.eventRed)
                        .lineLimit(1)
                    searchHighlighted(event.title, query: query)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                    Text(event.locationName)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
