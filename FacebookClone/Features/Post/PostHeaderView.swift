import SwiftUI

/// Avatar, name with context ("▸ Group", "is 😊 feeling happy", "is with ..."),
/// time · audience, and the "..." and "×" buttons.
///
/// Names, groups and tagged people are links (`PostLink`) that `PostCard` routes in-app.
struct PostHeaderView: View {
    let post: Post
    var showsHide: Bool = true
    var onOptions: () -> Void
    var onHide: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NavigationLink(value: Route.profile(post.author)) {
                AvatarView(user: post.author, size: avatarSize, ring: ring)
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(post.author.name), profile")

            VStack(alignment: .leading, spacing: 3) {
                title
                    .tint(FBColor.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
                subtitle
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 1)

            trailingButtons
        }
        .padding(.leading, FBMetrics.gutter)
        .padding(.trailing, 4)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    // MARK: Avatar

    private var ring: AvatarRing {
        guard let story = store.story(for: post.author), !story.items.isEmpty else { return .none }
        return .story(seen: story.isSeen)
    }

    /// Ringed avatars shrink a little so every header avatar takes the same space.
    private var avatarSize: CGFloat {
        if case .story = ring {
            return 35
        }
        return 40
    }

    // MARK: First line

    private var title: Text {
        var text = Text(nameString)
        if post.author.isVerified {
            text = text + Text(" ") + Text(Image(systemName: "checkmark.seal.fill"))
                .font(.system(size: FBIconSize.small))
                .foregroundStyle(FBColor.brandBlue)
        }
        return text + Text(contextString)
    }

    private var nameString: AttributedString {
        bold(post.author.name, link: PostLink.profile(post.author))
    }

    private var contextString: AttributedString {
        var result = AttributedString()
        if let group = post.group {
            result.append(plain(" ▸ ", color: FBColor.secondaryText))
            result.append(bold(group.name, link: PostLink.group(group)))
        } else if let owner = post.timelineOwner {
            result.append(plain(" ▸ ", color: FBColor.secondaryText))
            result.append(bold(owner.name, link: PostLink.profile(owner)))
        }

        var hasPhrase = false
        if let feeling = post.feeling {
            result.append(plain(" is \(feeling.emoji) feeling "))
            result.append(bold(feeling.name))
            hasPhrase = true
        }

        let tagged = post.taggedUsers
        if let first = tagged.first {
            result.append(plain(hasPhrase ? " with " : " is with "))
            result.append(bold(first.name, link: PostLink.profile(first)))
            if tagged.count == 2 {
                result.append(plain(" and "))
                result.append(bold(tagged[1].name, link: PostLink.profile(tagged[1])))
            } else if tagged.count > 2 {
                result.append(plain(" and "))
                result.append(bold("\(tagged.count - 1) others"))
            }
            hasPhrase = true
        }

        if let location = post.location, !location.isEmpty {
            result.append(plain(hasPhrase ? " at " : " is at "))
            result.append(bold(location))
            hasPhrase = true
        }

        if let activity = post.activityText, !activity.isEmpty {
            result.append(plain(" " + activity))
        } else if hasPhrase {
            result.append(plain("."))
        }
        return result
    }

    private func plain(_ string: String, color: Color = FBColor.primaryText) -> AttributedString {
        var part = AttributedString(string)
        part.font = Font.fbBody
        part.foregroundColor = color
        return part
    }

    private func bold(_ string: String, link: URL? = nil) -> AttributedString {
        var part = AttributedString(string)
        part.font = Font.fbName
        part.foregroundColor = FBColor.primaryText
        part.link = link
        return part
    }

    // MARK: Second line

    private var subtitle: some View {
        HStack(spacing: 4) {
            if post.isSponsored {
                Text("Sponsored")
            } else {
                TimelineView(.everyMinute) { _ in
                    Text(post.createdAt.fbShort)
                }
            }
            Text("·")
            Image(systemName: audienceSymbol)
                .font(.system(size: FBIconSize.xs))
                .accessibilityLabel(audienceLabel)
            if post.isEdited {
                Text("·")
                Text("Edited")
            }
        }
        .font(.fbMeta)
        .foregroundStyle(FBColor.secondaryText)
        .lineLimit(1)
    }

    private var audienceSymbol: String {
        if post.isSponsored { return "globe.americas.fill" }
        if let group = post.group { return group.privacySymbol }
        return post.audience.symbol
    }

    private var audienceLabel: String {
        if post.isSponsored { return "Public" }
        if let group = post.group { return group.privacyText }
        return post.audience.title
    }

    // MARK: Buttons

    private var trailingButtons: some View {
        HStack(spacing: 0) {
            Button(action: onOptions) {
                headerIcon("ellipsis")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("More options")

            if showsHide {
                Button(action: onHide) {
                    headerIcon("xmark")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Hide post")
            }
        }
    }

    private func headerIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: FBIconSize.regular, weight: .semibold))
            .foregroundStyle(FBColor.secondaryText)
            .frame(width: 36, height: 36)
            .contentShape(Rectangle())
    }
}
