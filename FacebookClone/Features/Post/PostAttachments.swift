import SwiftUI

// MARK: - Link preview

/// Image, uppercase domain, title and subtitle. Opens the URL.
struct PostLinkPreviewCard: View {
    let link: LinkPreview

    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            openURL(link.url)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                if let image = link.imageURL {
                    RemoteImage(url: image)
                        .aspectRatio(1.91, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(link.domain.uppercased())
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                    Text(link.title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if !link.subtitle.isEmpty {
                        Text(link.subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, FBMetrics.gutter)
                .padding(.vertical, 10)
                .background(FBColor.inputBackground)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(link.title), \(link.domain)")
        .accessibilityHint("Opens the link")
    }
}

// MARK: - Shared post

/// The original post embedded in a rounded, bordered box. Tapping it opens the original.
struct PostSharedPostView: View {
    let post: Post

    var body: some View {
        NavigationLink(value: Route.post(post)) {
            VStack(alignment: .leading, spacing: 0) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FBColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(FBColor.divider, lineWidth: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the original post")
    }

    private var header: some View {
        HStack(spacing: 8) {
            AvatarView(user: post.author, size: 32)
            VStack(alignment: .leading, spacing: 1) {
                NameWithBadge(user: post.author)
                HStack(spacing: 4) {
                    if let group = post.group {
                        Text(group.name)
                            .lineLimit(1)
                        Text("·")
                    }
                    Text(post.createdAt.fbShort)
                    Text("·")
                    Image(systemName: post.group?.privacySymbol ?? post.audience.symbol)
                        .font(.system(size: 10))
                }
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var content: some View {
        if post.showsBackground {
            PostBackgroundText(text: post.text, backgroundIndex: post.backgroundIndex ?? 0)
        } else {
            if !post.text.isEmpty {
                Text(PostRichText.make(post.text, linked: false))
                    .font(.fbBody)
                    .foregroundStyle(FBColor.primaryText)
                    .multilineTextAlignment(.leading)
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, FBMetrics.gutter)
                    .padding(.bottom, 10)
            }
            if !post.media.isEmpty {
                PostMediaGrid(post: post, media: post.media, isInteractive: false)
            }
            if let lifeEvent = post.lifeEvent {
                PostLifeEventView(event: lifeEvent)
            }
            if let link = post.link {
                PostLinkPreviewCard(link: link)
            }
        }
    }
}

// MARK: - Poll

/// Poll options. After voting, each option shows an animated percentage bar.
struct PostPollView: View {
    let post: Post
    let poll: Poll

    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(poll.options) { option in
                optionRow(option)
            }
            Text(footer)
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .contentTransition(.numericText())
        }
        .padding(.horizontal, FBMetrics.gutter)
        .padding(.bottom, 6)
    }

    private var hasVoted: Bool {
        poll.myVoteID != nil
    }

    private var footer: String {
        let total = poll.totalVotes
        let votes = "\(total.withCommas) \(total == 1 ? "vote" : "votes")"
        return hasVoted ? votes + " · tap to change" : votes
    }

    private func optionRow(_ option: PollOption) -> some View {
        let isMine = poll.myVoteID == option.id
        let fraction = hasVoted ? poll.fraction(for: option) : 0
        return Button {
            Haptics.selection()
            withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) {
                store.vote(option, in: post)
            }
        } label: {
            HStack(spacing: 8) {
                if hasVoted {
                    Image(systemName: isMine ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 16))
                        .foregroundStyle(isMine ? FBColor.accent : FBColor.tertiaryText)
                }
                Text(option.title)
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if hasVoted {
                    Text(percentText(fraction))
                        .font(.fbMeta.weight(.semibold))
                        .foregroundStyle(FBColor.secondaryText)
                        .contentTransition(.numericText())
                }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(alignment: .leading) {
                GeometryReader { proxy in
                    Rectangle()
                        .fill(isMine ? FBColor.tintedBlueBackground : FBColor.buttonGray)
                        .frame(width: proxy.size.width * CGFloat(fraction))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isMine ? FBColor.accent : FBColor.divider, lineWidth: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.title)
        .accessibilityValue(hasVoted ? percentText(fraction) : "")
        .accessibilityAddTraits(isMine ? .isSelected : [])
    }

    private func percentText(_ fraction: Double) -> String {
        "\(Int((fraction * 100).rounded()))%"
    }
}

// MARK: - Life event

/// "Started a new job", "Moved to Seattle": icon circle, title and subtitle, centered.
struct PostLifeEventView: View {
    let event: LifeEvent

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: event.symbol)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 60, height: 60)
                .background(FBColor.brandBlue, in: Circle())
            Text(event.title)
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
                .multilineTextAlignment(.center)
            if let subtitle = event.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Sponsored

/// The strip under an ad's media: domain, headline and a gray call-to-action button.
/// Uses `post.link` (domain, headline = title, URL); falls back to the advertiser.
struct PostSponsoredStrip: View {
    let post: Post

    @Environment(\.openURL) private var openURL
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(spacing: 0) {
            if post.media.isEmpty, let image = post.link?.imageURL {
                Button(action: openAd) {
                    RemoteImage(url: image)
                        .aspectRatio(1.91, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(domain.uppercased())
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                    Text(headline)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Button(post.sponsorCTA ?? "Learn more", action: openAd)
                    .buttonStyle(.fb(.secondary, expand: false))
            }
            .padding(.horizontal, FBMetrics.gutter)
            .padding(.vertical, 10)
            .background(FBColor.inputBackground)
        }
    }

    private var domain: String {
        if let link = post.link {
            return link.domain
        }
        return post.author.website ?? post.author.name
    }

    private var headline: String {
        post.link?.title ?? post.author.name
    }

    private func openAd() {
        Haptics.light()
        if let url = post.link?.url {
            openURL(url)
        } else {
            store.showToast("Opening \(post.author.name)...", symbol: "safari")
        }
    }
}
