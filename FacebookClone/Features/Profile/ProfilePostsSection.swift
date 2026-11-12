import SwiftUI

/// A square avatar-style image with an initials fallback.
struct ProfileSquareAvatar: View {
    let user: User

    var body: some View {
        ZStack {
            Rectangle().fill(AvatarView.color(for: user.id))
            Text(user.initials)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.white)
            RemoteImage(url: user.avatarURL, data: user.avatarData, placeholder: .clear)
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// The "Posts" tab of a profile: details, featured photos, friends, composer and timeline.
struct ProfilePostsSection: View {
    let user: User
    let onSeeAbout: () -> Void
    let onOpenPhotos: ([Media], Int) -> Void

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var showFilters = false

    private var posts: [Post] { store.posts(by: user) }

    var body: some View {
        VStack(spacing: 0) {
            detailsCard
            ProfileGap()
            featuredCard
            ProfileGap()
            friendsCard
            ProfileGap()
            postsHeader
            composer
            ProfileGap()
            timeline
        }
        .sheet(isPresented: $showFilters) {
            ProfileFiltersSheet()
                .presentationDetents([.medium])
        }
    }

    // MARK: Details

    private var detailsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Details")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
            if !user.work.isEmpty {
                detailRow("briefcase.fill", prefix: user.isPage ? "Category " : "Works at ", bold: user.work)
            }
            if !user.school.isEmpty {
                detailRow("graduationcap.fill", prefix: "Studied at ", bold: user.school)
            }
            if !user.city.isEmpty {
                detailRow("house.fill", prefix: "Lives in ", bold: user.city)
            }
            if !user.hometown.isEmpty {
                detailRow("mappin.and.ellipse", prefix: "From ", bold: user.hometown)
            }
            if !user.relationship.isEmpty && !user.isPage {
                detailRow("heart.fill", prefix: "", bold: user.relationship)
            }
            if let website = user.website, !website.isEmpty {
                detailRow("link", prefix: "", bold: website)
            }
            detailRow("clock.fill", prefix: "Joined ", bold: user.joinedDate.formatted(.dateTime.month(.wide).year()))

            Button(user.isMe ? "See your About info" : "See \(user.firstName)'s About info") {
                onSeeAbout()
            }
            .buttonStyle(.fb(.tinted))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FBColor.surface)
    }

    private func detailRow(_ symbol: String, prefix: String, bold: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 24)
            (Text(prefix).foregroundStyle(FBColor.primaryText)
                + Text(bold).fontWeight(.semibold).foregroundStyle(FBColor.primaryText))
                .font(.fbBodyLarge)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Featured

    @ViewBuilder
    private var featuredCard: some View {
        let photos = Array(store.photos(of: user).prefix(3))
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Featured")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                HStack(spacing: 6) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { index, media in
                        Button {
                            onOpenPhotos(photos, index)
                        } label: {
                            RemoteImage(url: media.url, data: media.data)
                                .aspectRatio(0.8, contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.pressable)
                        .accessibilityLabel("Featured photo \(index + 1)")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(FBColor.surface)
            ProfileGap()
        }
    }

    // MARK: Friends

    private var friendsCard: some View {
        let friends = Array(store.friends(of: user).prefix(6))
        let count = user.isMe ? store.friends.count : user.friendCount
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 3)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Friends")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Text("\(count.withCommas) friends")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                }
                Spacer()
                Button {
                    if user.isMe {
                        router.push(.search(""))
                    } else {
                        router.push(.friendsList(user))
                    }
                } label: {
                    Text(user.isMe ? "Find friends" : "See all friends")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(friends) { friend in
                    Button {
                        router.push(.profile(friend))
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            ProfileSquareAvatar(user: friend)
                            Text(friend.name)
                                .font(.fbMeta.weight(.semibold))
                                .foregroundStyle(FBColor.primaryText)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .buttonStyle(.pressable)
                }
            }
            Button("See all friends") {
                router.push(.friendsList(user))
            }
            .buttonStyle(.fb(.secondary))
        }
        .padding(16)
        .background(FBColor.surface)
    }

    // MARK: Timeline

    private var postsHeader: some View {
        HStack {
            Text("Posts")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
            Spacer()
            Button {
                showFilters = true
            } label: {
                Label("Filters", systemImage: "slider.horizontal.3")
                    .font(.fbButton)
                    .foregroundStyle(FBColor.primaryText)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(FBColor.buttonGray, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(FBColor.surface)
    }

    @ViewBuilder
    private var composer: some View {
        if user.isMe {
            ComposerBar()
        } else if user.isFriend {
            ComposerBar(placeholder: "Write something to \(user.firstName)...", timelineOwner: user)
        }
    }

    @ViewBuilder
    private var timeline: some View {
        let items = posts
        if items.isEmpty {
            ContentUnavailableView(
                "No posts to show",
                systemImage: "text.bubble",
                description: Text(user.isMe ? "Share something to see it here." : "When \(user.firstName) posts, you'll see it here.")
            )
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
            .background(FBColor.surface)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(items) { post in
                    PostCard(post: post)
                    FeedSeparator()
                }
            }
        }
    }
}

// MARK: - Filters

private struct ProfileFiltersSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var year = "All"
    @State private var postedBy = "Anyone"

    private let years: [String] = {
        let current = Calendar.current.component(.year, from: Date())
        return ["All"] + (0..<8).map { String(current - $0) }
    }()

    var body: some View {
        NavigationStack {
            Form {
                Section("Year") {
                    Picker("Year", selection: $year) {
                        ForEach(years, id: \.self) { Text($0).tag($0) }
                    }
                }
                Section("Posted by") {
                    Picker("Posted by", selection: $postedBy) {
                        Text("Anyone").tag("Anyone")
                        Text("Only me").tag("Only me")
                        Text("Others").tag("Others")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        year = "All"
                        postedBy = "Anyone"
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
