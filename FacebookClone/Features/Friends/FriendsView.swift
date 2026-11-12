import SwiftUI

/// Friends tab root.
struct FriendsView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var requests: [User] = []
    @State private var suggested: [User] = []
    @State private var hasLoaded = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    TabHeader("Friends") {
                        CircleButton(symbol: "magnifyingglass", accessibilityLabel: "Search") {
                            router.push(.search(""))
                        }
                    }
                    .id("friendsTop")
                    chipRow
                    HairlineDivider()
                    requestsSection
                    HairlineDivider()
                    suggestionsSection
                }
            }
            .background(FBColor.surface)
            .refreshable {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                reload()
            }
            .onChange(of: router.scrollToTopSignal(for: .friends)) {
                withAnimation {
                    proxy.scrollTo("friendsTop", anchor: .top)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onFirstAppear { reload() }
        .onChange(of: store.friendRequests.count) {
            mergeNewRequests()
        }
    }

    private func reload() {
        requests = store.friendRequests
        suggested = Array(store.suggestions.prefix(20))
        hasLoaded = true
    }

    private func mergeNewRequests() {
        let known = Set(requests.map { $0.id })
        let fresh = store.friendRequests.filter { !known.contains($0.id) }
        if !fresh.isEmpty {
            withAnimation { requests = fresh + requests }
        }
    }

    private var chipRow: some View {
        HStack(spacing: 8) {
            ChipView(title: "Suggestions") {
                router.push(.friendSuggestions)
            }
            ChipView(title: "Your friends") {
                router.push(.friendsList(store.me))
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var requestsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 6) {
                    Text("Friend requests")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Text("\(store.friendRequests.count)")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.notificationRed)
                }
                Spacer()
                Button {
                    router.push(.friendRequests)
                } label: {
                    Text("See all")
                        .font(.fbBody)
                        .foregroundStyle(FBColor.accent)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)

            if requests.isEmpty {
                Text("No new friend requests")
                    .font(.fbBody)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 16)
            } else {
                FriendsPeopleList(users: Array(requests.prefix(5)), mode: .request)
            }
        }
        .padding(.bottom, 8)
    }

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("People you may know")
                .font(.fbTitle)
                .foregroundStyle(FBColor.primaryText)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 6)

            if suggested.isEmpty && hasLoaded {
                ContentUnavailableView(
                    "No suggestions right now",
                    systemImage: "person.2",
                    description: Text("Check back later for people you may know.")
                )
                .padding(.vertical, 24)
            } else {
                FriendsPeopleList(users: suggested, mode: .suggestion)
            }
        }
        .padding(.bottom, 24)
    }
}

#Preview {
    NavigationStack { FriendsView() }.previewEnvironment()
}
