import SwiftUI

/// Full-screen vertical Reels. One reel per page; only the current page plays, with sound
/// unless muted from the top bar. Ends with a "You're all caught up" page.
struct ReelsView: View {
    let startReelID: String?

    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var currentID: String?
    @State private var isMuted = false
    @State private var sheetRoute: VideoSheetRoute?

    private static let endPageID = "reels-end-page"

    init(startReelID: String?) {
        self.startReelID = startReelID
        _currentID = State(initialValue: startReelID)
    }

    var body: some View {
        GeometryReader { geometry in
            let insets = geometry.safeAreaInsets
            ZStack(alignment: .top) {
                Color.black
                content(insets: insets)
                topScrim(height: insets.top + 96)
                ReelsTopBar(isMuted: $isMuted, onClose: close, onCamera: showCameraToast)
                    .padding(.top, insets.top)
            }
            .ignoresSafeArea()
        }
        .background(Color.black.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 16)
        }
        .preferredColorScheme(.dark)
        .sheet(item: $sheetRoute) { route in
            VideoSheetContent(route: route)
        }
        .onAppear {
            let reels = store.reels
            if currentID == nil || !reels.contains(where: { $0.id == currentID }) {
                currentID = reels.first?.id
            }
        }
    }

    // MARK: Pages

    @ViewBuilder
    private func content(insets: EdgeInsets) -> some View {
        if store.reels.isEmpty {
            ContentUnavailableView {
                Label("No reels right now", systemImage: "film")
            } description: {
                Text("Check back later for new reels.")
            }
            .foregroundStyle(Color.white)
        } else {
            pager(insets: insets)
        }
    }

    private func pager(insets: EdgeInsets) -> some View {
        let reels = store.reels
        let currentIndex = index(of: currentID, in: reels)
        return ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(reels.enumerated()), id: \.element.id) { index, reel in
                        page(for: reel, isNearby: abs(index - currentIndex) <= 1, insets: insets)
                    }
                    ReelsEndPage(onBackToTop: backToTop)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(Self.endPageID)
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $currentID)
            .ignoresSafeArea()
            .onAppear {
                guard let target = currentID else { return }
                proxy.scrollTo(target, anchor: .top)
            }
        }
    }

    private func page(for reel: Post, isNearby: Bool, insets: EdgeInsets) -> some View {
        ReelsPage(
            reel: reel,
            isCurrent: reel.id == currentID,
            shouldLoad: isNearby,
            isSuspended: sheetRoute != nil,
            isMuted: isMuted,
            insets: insets,
            onComments: { sheetRoute = .comments(reel) },
            onShare: { sheetRoute = .share(reel) },
            onMore: { sheetRoute = .reelOptions(reel) },
            onOpenProfile: { user in openProfile(user) }
        )
        .containerRelativeFrame([.horizontal, .vertical])
    }

    /// Index of the page on screen. The end page counts as one past the last reel.
    private func index(of id: String?, in reels: [Post]) -> Int {
        if let id, let found = reels.firstIndex(where: { $0.id == id }) {
            return found
        }
        return id == Self.endPageID ? reels.count : 0
    }

    private func topScrim(height: CGFloat) -> some View {
        LinearGradient(
            colors: [Color.black.opacity(0.55), Color.clear],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: height)
        .allowsHitTesting(false)
    }

    // MARK: Actions

    private func close() {
        dismiss()
    }

    private func showCameraToast() {
        Haptics.light()
        store.showToast("Creating reels isn't available in this demo", symbol: "camera.fill")
    }

    private func backToTop() {
        Haptics.light()
        withAnimation(.easeInOut(duration: 0.45)) {
            currentID = store.reels.first?.id
        }
    }

    /// Profiles open in the tab underneath, so close Reels first.
    private func openProfile(_ user: User) {
        dismiss()
        router.push(.profile(user))
    }
}

// MARK: - Top bar

private struct ReelsTopBar: View {
    @Binding var isMuted: Bool
    let onClose: () -> Void
    let onCamera: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            iconButton("xmark", label: "Close", action: onClose)
            Text("Reels")
                .font(.fbTitle)
                .foregroundStyle(Color.white)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            iconButton(isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: isMuted ? "Unmute" : "Mute") {
                Haptics.light()
                isMuted.toggle()
            }
            iconButton("camera", label: "Create a reel", action: onCamera)
        }
        .padding(.horizontal, 8)
        .frame(height: 48)
        .shadow(color: Color.black.opacity(0.35), radius: 3, y: 1)
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: FBIconSize.large, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - End page

private struct ReelsEndPage: View {
    let onBackToTop: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundStyle(Color.white)
            Text("You're all caught up")
                .font(.fbTitle)
                .foregroundStyle(Color.white)
            Text("You've watched all the reels we have for you right now.")
                .font(.fbBody)
                .foregroundStyle(Color.white.opacity(0.7))
                .multilineTextAlignment(.center)
            Button(action: onBackToTop) {
                Label("Back to the top", systemImage: "arrow.up")
            }
            .buttonStyle(.fb(.primary, expand: false, height: 40))
            .padding(.top, 8)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }
}

// MARK: - Options sheet

/// The "..." sheet on a reel.
struct ReelsOptionsSheet: View {
    let post: Post

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var saveTitle: String { post.isSaved ? "Unsave reel" : "Save reel" }
    private var saveSubtitle: String { post.isSaved ? "Remove this from your saved items." : "Add this to your saved items." }
    private var saveSymbol: String { post.isSaved ? "bookmark.slash" : "bookmark" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            row(symbol: saveSymbol, title: saveTitle, subtitle: saveSubtitle) {
                store.toggleSave(post)
            }
            row(symbol: "eye.slash", title: "Not interested", subtitle: "See fewer reels like this.") {
                store.showToast("You'll see fewer reels like this", symbol: "eye.slash")
            }
            row(symbol: "link", title: "Copy link", subtitle: nil) {
                VideoLinks.copy(post, store: store)
            }
            row(symbol: "flag", title: "Report reel", subtitle: "\(post.author.firstName) won't know who reported this.") {
                store.showToast("Thanks for letting us know", symbol: "flag.fill")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(FBColor.surface)
    }

    private func row(symbol: String, title: String, subtitle: String?, action: @escaping () -> Void) -> some View {
        Button {
            dismiss()
            action()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.regular, weight: .semibold))
                    .foregroundStyle(FBColor.primaryText)
                    .frame(width: 38, height: 38)
                    .background(FBColor.buttonGray, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    if let subtitle {
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ReelsView(startReelID: nil)
        .previewEnvironment()
}
