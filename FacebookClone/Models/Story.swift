import Foundation
import Observation

enum StoryContent: Hashable {
    case photo(URL?)
    case localPhoto(Data)
    /// Text on a `PostBackground` preset.
    case text(String, backgroundIndex: Int)
    /// Bubbles: a Burst of a Bubble, played full-bleed. Nil `replay` means the demo bot plays.
    case bubble(id: String, replay: BubbleInputLog?, score: Int?)
}

struct StoryItem: Identifiable, Hashable {
    let id: String
    var content: StoryContent
    var createdAt: Date
    /// Seconds the item stays on screen.
    var duration: TimeInterval
    var caption: String?
    var viewerCount: Int

    init(
        id: String = UUID().uuidString,
        content: StoryContent,
        createdAt: Date = Date(),
        duration: TimeInterval = 5,
        caption: String? = nil,
        viewerCount: Int = 0
    ) {
        self.id = id
        self.content = content
        self.createdAt = createdAt
        self.duration = duration
        self.caption = caption
        self.viewerCount = viewerCount
    }

    var thumbnailURL: URL? {
        if case .photo(let url) = content { return url }
        return nil
    }
}

/// All of one person's active story items.
@Observable
final class Story: Identifiable, Hashable {
    let id: String
    let author: User
    var items: [StoryItem]
    var seenItemIDs: Set<String>

    init(id: String = UUID().uuidString, author: User, items: [StoryItem], seenItemIDs: Set<String> = []) {
        self.id = id
        self.author = author
        self.items = items
        self.seenItemIDs = seenItemIDs
    }

    var isSeen: Bool {
        !items.isEmpty && items.allSatisfy { seenItemIDs.contains($0.id) }
    }

    var latestDate: Date {
        items.map { $0.createdAt }.max() ?? .distantPast
    }

    /// Where the viewer should start: the first unseen item, or 0 if all are seen.
    var firstUnseenIndex: Int {
        items.firstIndex { !seenItemIDs.contains($0.id) } ?? 0
    }

    /// The item shown on the story card in the tray.
    var previewItem: StoryItem? {
        guard !items.isEmpty else { return nil }
        return items[min(firstUnseenIndex, items.count - 1)]
    }

    static func == (lhs: Story, rhs: Story) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
