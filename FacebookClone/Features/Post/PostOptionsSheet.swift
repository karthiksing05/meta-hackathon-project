import SwiftUI

/// Everything the "..." sheet can do. `PostCard` runs the choice after the sheet closes.
enum PostOption: Hashable {
    case save
    case notifications
    case favorite
    case hide
    case snooze
    case unfollow
    case copyLink
    case report
    case edit
    case editAudience
    case delete
    case whyAd
}

private struct PostOptionItem: Identifiable {
    let option: PostOption
    let symbol: String
    let title: String
    var subtitle: String? = nil
    var isDestructive = false

    var id: PostOption { option }
}

/// The "..." sheet: grouped rows with an icon, a title and a subtitle, like the real app.
struct PostOptionsSheet: View {
    let post: Post
    var onSelect: (PostOption) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(Array(sections.enumerated()), id: \.offset) { _, items in
                    section(items)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 20)
            .padding(.bottom, 16)
        }
        .background(FBColor.background)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(FBColor.background)
    }

    private func section(_ items: [PostOptionItem]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    HairlineDivider(leadingInset: 52)
                }
                row(item)
            }
        }
        .background(FBColor.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func row(_ item: PostOptionItem) -> some View {
        Button {
            Haptics.light()
            onSelect(item.option)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: item.symbol)
                    .font(.system(size: 19))
                    .foregroundStyle(item.isDestructive ? FBColor.notificationRed : FBColor.primaryText)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.fbName)
                        .foregroundStyle(item.isDestructive ? FBColor.notificationRed : FBColor.primaryText)
                    if let subtitle = item.subtitle {
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Rows

    private var sections: [[PostOptionItem]] {
        if post.author.isMe {
            return [
                [edit, editAudience],
                [save, notifications, copyLink],
                [delete],
            ]
        }
        if post.isSponsored {
            return [
                [save, hide(title: "Hide ad", subtitle: "See fewer ads like this."), whyAd],
                [copyLink, report(title: "Report ad")],
            ]
        }
        return [
            [save, notifications, favorite],
            [hide(title: "Hide post", subtitle: "See fewer posts like this."), snooze, unfollow],
            [copyLink, report(title: "Report post")],
        ]
    }

    private var save: PostOptionItem {
        post.isSaved
            ? PostOptionItem(option: .save, symbol: "bookmark.slash", title: "Unsave post", subtitle: "Remove this from your saved items.")
            : PostOptionItem(option: .save, symbol: "bookmark", title: "Save post", subtitle: "Add this to your saved items.")
    }

    private var notifications: PostOptionItem {
        post.notificationsOn
            ? PostOptionItem(option: .notifications, symbol: "bell.slash", title: "Turn off notifications for this post")
            : PostOptionItem(option: .notifications, symbol: "bell", title: "Turn on notifications for this post")
    }

    private var favorite: PostOptionItem {
        let name = post.author.name
        return post.author.isFavorite
            ? PostOptionItem(option: .favorite, symbol: "star.slash", title: "Remove \(name) from Favorites")
            : PostOptionItem(option: .favorite, symbol: "star", title: "Add \(name) to Favorites", subtitle: "Prioritize their posts in Feed.")
    }

    private func hide(title: String, subtitle: String) -> PostOptionItem {
        PostOptionItem(option: .hide, symbol: "eye.slash", title: title, subtitle: subtitle)
    }

    private var snooze: PostOptionItem {
        PostOptionItem(
            option: .snooze,
            symbol: "clock",
            title: "Snooze \(post.author.firstName) for 30 days",
            subtitle: "Temporarily stop seeing posts."
        )
    }

    private var unfollow: PostOptionItem {
        PostOptionItem(
            option: .unfollow,
            symbol: "person.badge.minus",
            title: "Unfollow \(post.author.name)",
            subtitle: post.author.isPage ? "Stop seeing posts from this Page." : "Stop seeing posts but stay friends."
        )
    }

    private var copyLink: PostOptionItem {
        PostOptionItem(option: .copyLink, symbol: "link", title: "Copy link")
    }

    private func report(title: String) -> PostOptionItem {
        PostOptionItem(
            option: .report,
            symbol: "exclamationmark.bubble",
            title: title,
            subtitle: "We won't let \(post.author.firstName) know who reported this."
        )
    }

    private var whyAd: PostOptionItem {
        PostOptionItem(option: .whyAd, symbol: "info.circle", title: "Why am I seeing this ad?")
    }

    private var edit: PostOptionItem {
        PostOptionItem(option: .edit, symbol: "pencil", title: "Edit post")
    }

    private var editAudience: PostOptionItem {
        PostOptionItem(
            option: .editAudience,
            symbol: post.audience.symbol,
            title: "Edit audience",
            subtitle: post.audience.title
        )
    }

    private var delete: PostOptionItem {
        PostOptionItem(option: .delete, symbol: "trash", title: "Delete post", isDestructive: true)
    }
}

/// Who can see a post: Public, Friends, Friends except..., Only me.
struct PostAudiencePicker: View {
    let selection: Audience
    var onSelect: (Audience) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var current: Audience

    init(selection: Audience, onSelect: @escaping (Audience) -> Void) {
        self.selection = selection
        self.onSelect = onSelect
        _current = State(initialValue: selection)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(Audience.allCases) { audience in
                        row(audience)
                    }
                } header: {
                    Text("Who can see your post?")
                } footer: {
                    Text("Your post will show up in Feed, on your profile and in search results.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Edit audience")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if current != selection {
                            onSelect(current)
                        }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ audience: Audience) -> some View {
        Button {
            Haptics.selection()
            current = audience
        } label: {
            HStack(spacing: 12) {
                Image(systemName: audience.symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 40, height: 40)
                    .background(FBColor.buttonGray, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(audience.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text(audience.subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer(minLength: 8)
                Image(systemName: current == audience ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(current == audience ? FBColor.accent : FBColor.tertiaryText)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(current == audience ? .isSelected : [])
    }
}
