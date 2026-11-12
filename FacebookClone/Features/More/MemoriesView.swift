import SwiftUI

struct MemoriesView: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    @State private var showSettings = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                headerCard
                if store.memories.isEmpty {
                    ContentUnavailableView(
                        "No memories today",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("When you have memories from this day, they'll show up here.")
                    )
                    .padding(.top, 40)
                } else {
                    ForEach(store.memories) { memory in
                        memoryBlock(memory)
                        FeedSeparator()
                    }
                }
            }
        }
        .background(FBColor.background)
        .navigationTitle("Memories")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showSettings = true
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Memory settings")
            }
        }
        .sheet(isPresented: $showSettings) {
            MoreMemorySettingsSheet()
        }
    }

    private var headerCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(FBColor.memoriesBlue)
            Text("On this day")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(FBColor.primaryText)
            Text(todayText)
                .font(.fbBody)
                .foregroundStyle(FBColor.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(FBColor.surface)
        .padding(.bottom, FBMetrics.feedSeparatorHeight)
    }

    private var todayText: String {
        let now = Date()
        return "\(DateFormatters.weekday.string(from: now)), \(DateFormatters.fullMonthDay.string(from: now))"
    }

    private func memoryBlock(_ memory: Post) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundStyle(FBColor.memoriesBlue)
                Text(yearsText(memory.memoryYearsAgo))
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(FBColor.surface)
            PostCard(post: memory)
            Button {
                router.composePost(CreatePostRequest(sharedPost: memory))
            } label: {
                Text("Share")
            }
            .buttonStyle(.fbPrimary)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(FBColor.surface)
        }
    }

    private func yearsText(_ years: Int?) -> String {
        guard let years else { return "A while ago" }
        return years == 1 ? "1 year ago" : "\(years) years ago"
    }
}

private struct MoreMemorySettingsSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var notifications = true
    @State private var hidePeople = false
    @State private var hideDates = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Memory notifications", isOn: $notifications)
                } footer: {
                    Text("Get a notification when you have memories to look back on.")
                }
                Section("Hide memories") {
                    Toggle("Hide people", isOn: $hidePeople)
                    Toggle("Hide dates", isOn: $hideDates)
                }
            }
            .navigationTitle("Memory settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
