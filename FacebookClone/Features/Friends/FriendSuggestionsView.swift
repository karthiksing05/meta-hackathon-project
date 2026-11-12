import SwiftUI

/// The full "People you may know" list (pushed).
struct FriendSuggestionsView: View {
    @Environment(AppStore.self) private var store

    @State private var suggested: [User] = []
    @State private var hasLoaded = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text("People you may know")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)

                if suggested.isEmpty && hasLoaded {
                    ContentUnavailableView(
                        "No suggestions right now",
                        systemImage: "person.2",
                        description: Text("Check back later for people you may know.")
                    )
                    .padding(.top, 40)
                } else {
                    FriendsPeopleList(users: suggested, mode: .suggestion)
                }
            }
        }
        .background(FBColor.surface)
        .navigationTitle("Suggestions")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            suggested = store.suggestions
        }
        .onFirstAppear {
            suggested = store.suggestions
            hasLoaded = true
        }
    }
}
