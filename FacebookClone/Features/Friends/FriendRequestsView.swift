import SwiftUI

/// The full friend request list (pushed).
struct FriendRequestsView: View {
    @Environment(AppStore.self) private var store

    @State private var requests: [User] = []
    @State private var showSent = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("\(requests.count) friend requests")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    Spacer()
                    Button {
                        showSent = true
                    } label: {
                        Text("View sent requests")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.accent)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)

                if requests.isEmpty {
                    ContentUnavailableView(
                        "No friend requests",
                        systemImage: "person.crop.circle.badge.checkmark",
                        description: Text("When people send you friend requests, they'll show up here.")
                    )
                    .padding(.top, 40)
                } else {
                    FriendsPeopleList(users: requests, mode: .request)
                }
            }
        }
        .background(FBColor.surface)
        .navigationTitle("Friend requests")
        .navigationBarTitleDisplayMode(.inline)
        .onFirstAppear { requests = store.friendRequests }
        .onChange(of: store.friendRequests.count) {
            let known = Set(requests.map { $0.id })
            let fresh = store.friendRequests.filter { !known.contains($0.id) }
            if !fresh.isEmpty { requests = fresh + requests }
        }
        .sheet(isPresented: $showSent) {
            FriendsSentRequestsSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

private struct FriendsSentRequestsSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.sentRequests.isEmpty {
                    ContentUnavailableView(
                        "No sent requests",
                        systemImage: "paperplane",
                        description: Text("Friend requests you send will show up here.")
                    )
                } else {
                    List {
                        ForEach(store.sentRequests) { user in
                            HStack(spacing: 12) {
                                AvatarView(user: user, size: FBAvatarSize.row)
                                VStack(alignment: .leading, spacing: 4) {
                                    NameWithBadge(user: user)
                                    if let date = user.requestDate {
                                        Text("Sent \(date.fbShort)")
                                            .font(.fbMeta)
                                            .foregroundStyle(FBColor.secondaryText)
                                    }
                                }
                                Spacer(minLength: 8)
                                Button("Cancel") {
                                    Haptics.light()
                                    store.cancelRequest(to: user)
                                }
                                .buttonStyle(.fb(.secondary, expand: false, height: 34))
                            }
                            .listRowBackground(FBColor.surface)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Sent requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
