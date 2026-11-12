import SwiftUI

/// The sheet behind the header's "+" button: Post, Story, Reel, Live, Note, Event, Sell.
struct CreateMenuSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                Text("Create")
                    .font(.fbTitle)
                    .foregroundStyle(FBColor.primaryText)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.horizontal, 16)
                    .padding(.top, 22)
                    .padding(.bottom, 10)
                ForEach(HomeCreateMenuItem.allCases) { item in
                    Button {
                        perform(item)
                    } label: {
                        HomeCreateMenuRow(item: item)
                    }
                    .buttonStyle(HomeMenuRowButtonStyle())
                }
            }
            .padding(.bottom, 16)
        }
        .background(FBColor.surface)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    /// Closes the sheet first, then runs the action once the sheet is out of the way.
    private func perform(_ item: HomeCreateMenuItem) {
        Haptics.light()
        let router = router
        let store = store
        router.isCreateMenuPresented = false
        Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            switch item {
            case .post:
                router.composePost()
            case .story:
                router.openCreateStory()
            case .reel:
                store.showToast("Creating reels isn't available in this demo", symbol: "play.rectangle.fill")
            case .live:
                store.showToast("Going live isn't available in this demo", symbol: "video.fill")
            case .note:
                store.showToast("Notes aren't available in this demo", symbol: "text.bubble.fill")
            case .event:
                router.select(.home)
                router.push(.events)
            case .sell:
                router.select(.marketplace)
            }
        }
    }
}

enum HomeCreateMenuItem: String, CaseIterable, Identifiable {
    case post
    case story
    case reel
    case live
    case note
    case event
    case sell

    var id: String { rawValue }

    var title: String {
        switch self {
        case .post: return "Post"
        case .story: return "Story"
        case .reel: return "Reel"
        case .live: return "Live"
        case .note: return "Note"
        case .event: return "Event"
        case .sell: return "Sell something"
        }
    }

    var subtitle: String {
        switch self {
        case .post: return "Share what's on your mind"
        case .story: return "Share a photo or write something"
        case .reel: return "Share a short video"
        case .live: return "Broadcast to your friends"
        case .note: return "Share a quick thought"
        case .event: return "Bring people together"
        case .sell: return "List an item on Marketplace"
        }
    }

    var symbol: String {
        switch self {
        case .post: return "square.and.pencil"
        case .story: return "book.fill"
        case .reel: return "play.rectangle.fill"
        case .live: return "video.fill"
        case .note: return "text.bubble.fill"
        case .event: return "calendar"
        case .sell: return "tag.fill"
        }
    }

    var color: Color {
        switch self {
        case .post: return FBColor.brandBlue
        case .story: return FBColor.savedPurple
        case .reel: return FBColor.reelsPink
        case .live: return FBColor.liveRed
        case .note: return FBColor.memoriesBlue
        case .event: return FBColor.eventRed
        case .sell: return FBColor.marketplaceTeal
        }
    }
}

private struct HomeCreateMenuRow: View {
    let item: HomeCreateMenuItem

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(item.color)
                .frame(width: 40, height: 40)
                .overlay {
                    Image(systemName: item.symbol)
                        .font(.system(size: FBIconSize.regular, weight: .semibold))
                        .foregroundStyle(.white)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.fbHeadline)
                    .foregroundStyle(FBColor.primaryText)
                Text(item.subtitle)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// Highlights the whole row while pressed, like a table cell.
private struct HomeMenuRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? FBColor.inputBackground : Color.clear)
    }
}

#Preview {
    Color.clear
        .sheet(isPresented: .constant(true)) {
            CreateMenuSheet()
        }
        .previewEnvironment()
}
