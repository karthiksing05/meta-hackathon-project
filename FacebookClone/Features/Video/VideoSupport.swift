import SwiftUI
import UIKit

// MARK: - Layout constants

/// Names shared by the Video tab's scroll view and its cards.
enum VideoFeedLayout {
    /// Coordinate space of the feed's scroll view. Cards report their frames in it.
    static let scrollSpace = "VideoFeedScrollSpace"
    /// Scroll anchor at the top of the feed (re-tapping the tab scrolls here).
    static let topAnchor = "VideoFeedTopAnchor"
}

// MARK: - Feed chips

enum VideoFeedChip: String, CaseIterable, Identifiable {
    case forYou
    case live
    case reels
    case following
    case saved

    var id: String { rawValue }

    var title: String {
        switch self {
        case .forYou: return "For you"
        case .live: return "Live"
        case .reels: return "Reels"
        case .following: return "Following"
        case .saved: return "Saved"
        }
    }

    var symbol: String? {
        switch self {
        case .forYou: return nil
        case .live: return "dot.radiowaves.left.and.right"
        case .reels: return "film"
        case .following: return nil
        case .saved: return "bookmark"
        }
    }
}

// MARK: - Sheets

/// Sheets shown over the Video tab and over Reels.
enum VideoSheetRoute: Identifiable {
    case comments(Post)
    case share(Post)
    /// The "..." sheet on a reel.
    case reelOptions(Post)

    var id: String {
        switch self {
        case .comments(let post): return "comments-\(post.id)"
        case .share(let post): return "share-\(post.id)"
        case .reelOptions(let post): return "options-\(post.id)"
        }
    }
}

struct VideoSheetContent: View {
    let route: VideoSheetRoute

    var body: some View {
        switch route {
        case .comments(let post):
            CommentsView(post: post)
                .presentationDetents([.large])
        case .share(let post):
            ShareSheetView(post: post)
                .presentationDetents([.large])
        case .reelOptions(let post):
            ReelsOptionsSheet(post: post)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Which feed video plays

/// Remembers where each feed video sits on screen and picks the one nearest the
/// middle of the visible area. Only that card's player runs.
@Observable
final class VideoPlaybackTracker {
    private(set) var activeID: String?

    @ObservationIgnored private var viewportHeight: CGFloat = 0
    @ObservationIgnored private var frames: [String: CGRect] = [:]

    func update(_ id: String, frame: CGRect) {
        frames[id] = frame
        recompute()
    }

    func remove(_ id: String) {
        guard frames.removeValue(forKey: id) != nil else { return }
        recompute()
    }

    func setViewportHeight(_ height: CGFloat) {
        guard height > 0, height != viewportHeight else { return }
        viewportHeight = height
        recompute()
    }

    private func recompute() {
        let height: CGFloat = viewportHeight > 0 ? viewportHeight : 600
        let middle = height / 2
        var bestID: String?
        var bestDistance = CGFloat.greatestFiniteMagnitude
        for (id, frame) in frames where frame.height > 1 {
            let visible = min(frame.maxY, height) - max(frame.minY, 0)
            guard visible > 0 else { continue }
            let mostlyVisible = visible / frame.height >= 0.5
            let fillsScreen = visible >= height * 0.35
            guard mostlyVisible || fillsScreen else { continue }
            let distance = abs(frame.midY - middle)
            if distance < bestDistance {
                bestDistance = distance
                bestID = id
            }
        }
        if bestID != activeID {
            activeID = bestID
        }
    }
}

/// Reports a feed video's frame to the tracker while it is on screen.
/// Put it in the `.background` of the video area.
struct VideoFrameReporter: View {
    let id: String
    let tracker: VideoPlaybackTracker

    var body: some View {
        GeometryReader { proxy in
            let frame = proxy.frame(in: .named(VideoFeedLayout.scrollSpace))
            Color.clear
                .onAppear { tracker.update(id, frame: frame) }
                .onChange(of: frame) { _, newFrame in
                    tracker.update(id, frame: newFrame)
                }
                .onDisappear { tracker.remove(id) }
        }
    }
}

/// Tells the tracker how tall the feed's visible area is.
struct VideoViewportReader: View {
    let tracker: VideoPlaybackTracker

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onAppear { tracker.setViewportHeight(proxy.size.height) }
                .onChange(of: proxy.size.height) { _, height in
                    tracker.setViewportHeight(height)
                }
        }
    }
}

// MARK: - Playback progress

/// Elapsed time of one looping player. Kept in a small observable object so only the
/// views that show the time (pill, progress bar) redraw ten times a second.
@Observable
final class VideoProgressModel {
    private(set) var elapsed: Double = 0
    private(set) var duration: Double = 0
    /// True once real frames are playing, so the poster can give way to the video.
    private(set) var hasStarted = false

    var fraction: Double {
        guard duration > 0 else { return 0 }
        return min(max(elapsed / duration, 0), 1)
    }

    func update(elapsed: Double, duration: Double) {
        self.elapsed = elapsed
        self.duration = duration
        if !hasStarted && elapsed > 0.05 {
            hasStarted = true
        }
    }

    func reset() {
        elapsed = 0
        duration = 0
        hasStarted = false
    }
}

/// A thin playback progress line.
struct VideoProgressBar: View {
    let progress: VideoProgressModel
    var tint: Color = FBColor.brandBlue
    var track: Color = Color.white.opacity(0.3)
    var height: CGFloat = 3

    var body: some View {
        Rectangle()
            .fill(track)
            .frame(height: height)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(tint)
                    .scaleEffect(x: CGFloat(progress.fraction), y: 1, anchor: .leading)
            }
            .animation(.linear(duration: 0.1), value: progress.fraction)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

// MARK: - Live videos

/// A couple of watch videos play as "live" broadcasts with a fake, gently moving audience.
enum VideoLiveStats {
    /// The ids picked by a stable hash, so the same videos are live on every render.
    static func liveIDs(in videos: [Post], count: Int = 2) -> Set<String> {
        let ranked = videos.sorted { lhs, rhs in
            SeededGenerator.stableHash(lhs.id) < SeededGenerator.stableHash(rhs.id)
        }
        return Set(ranked.prefix(count).map { $0.id })
    }

    /// "N watching", changing a little every few seconds.
    static func watchers(for post: Post, at date: Date) -> Int {
        let base = 600 + Int(SeededGenerator.stableHash(post.id) % 14_000)
        let bucket = Int(date.timeIntervalSince1970 / 3)
        let jitter = Int(SeededGenerator.stableHash("\(post.id)-\(bucket)") % 81) - 40
        return max(base + jitter, 1)
    }
}

// MARK: - Links

enum VideoLinks {
    static func url(for post: Post) -> String {
        if post.isReel {
            return "https://www.facebook.com/reel/\(post.id)"
        }
        return "https://www.facebook.com/watch/?v=\(post.id)"
    }

    @MainActor
    static func copy(_ post: Post, store: AppStore) {
        UIPasteboard.general.string = url(for: post)
        Haptics.light()
        store.showToast("Link copied", symbol: "link")
    }
}

// MARK: - Store helpers

extension AppStore {
    /// Watch videos that show as live broadcasts in the Video tab.
    var videoLiveIDs: Set<String> {
        VideoLiveStats.liveIDs(in: watchVideos)
    }

    /// True when the video's author is a friend or someone you follow.
    func videoIsFromFollowed(_ post: Post) -> Bool {
        post.author.isFriend || post.author.isFollowing
    }
}
