import Foundation
import UIKit

/// Tells the server what happened on each feed page, so its recommender (Kevin's `game-recs.js`,
/// run by the API) learns from it. The app ranks nothing: the server picks every page.
///
/// - **Pages.** One page event per feed page you saw (`POST /v1/feed/events`): `gameID`,
///   `feedItemID`, `position`, `sessionID`, the server's `reason` and `team`, dwell time, whether
///   you took over, finished, replayed, saved, liked, floated, opened the board, added a friend or
///   remixed, social moments and who with, and whether you quit mid-run or ended the session.
///   `BubbleFeedModel` reports page changes, visibility, takeovers and finished runs; the tab, the
///   board and floats report the rest with `note(_:gameID:)`. Leaving the tab only pauses the
///   page, so actions on a pushed board still count. Three minutes away ends the session.
/// - **Moments.** A save or social moment (`.bubbleSaveChanged`, `.bubbleSocialSignal`) about the
///   open page's game joins that page; anywhere else it's sent as an off-feed moment (`kind`).
///
/// Events are sent in small batches, on page change and when the app goes to the background.
/// Main thread only.
final class FeedEventReporter {
    static let shared = FeedEventReporter()

    /// Something you did on a feed page.
    enum Signal {
        case runStarted, runFinished, saved, liked, floated, openedBoard, addedFriend, remixed
        /// A `BubbleSocialSignalKind` raw value, with the other people involved.
        case social(String, with: [String])
    }

    private var current: Impression?
    private var pending: [FeedEvent] = []
    private var sending = false
    private var observers: [NSObjectProtocol] = []
    /// Away from the feed this long ends the session.
    private let sessionGap: TimeInterval = 180
    private let enabled = ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] != "1"

    private init() {
        guard enabled else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.feedHidden()
            self?.flush()
        })
        observers.append(center.addObserver(forName: Notification.Name("bubbleSaveChanged"), object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo, let gameID = info["bubbleID"] as? String, info["isSaved"] as? Bool == true else { return }
            self?.moment("saved", gameID: gameID, with: [])
        })
        observers.append(center.addObserver(forName: Notification.Name("bubbleSocialSignal"), object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo, let kind = info["kind"] as? String, let gameID = info["bubbleID"] as? String else { return }
            self?.moment(kind, gameID: gameID, with: info["with"] as? [String] ?? [])
        })
    }

    // MARK: - Pages

    /// The feed settled on a page while the tab is on screen.
    func pageShown(_ item: BubbleFeedItem, position: Int, sessionID: String) {
        guard enabled else { return }
        if let current, current.event.feedItemID == item.id {
            resume()
            return
        }
        finishCurrent(endedSession: false)
        var event = FeedEvent(gameID: item.bubbleID)
        event.feedItemID = item.id.hasPrefix("made-") ? nil : item.id
        event.position = position
        event.sessionID = sessionID
        event.reason = item.serverReason
        event.team = item.team
        current = Impression(event: event, visibleSince: Date())
    }

    /// The games tab is on screen again.
    func feedVisible(_ item: BubbleFeedItem?, position: Int, sessionID: String) {
        guard enabled else { return }
        if let hiddenAt = current?.hiddenAt, Date().timeIntervalSince(hiddenAt) > sessionGap {
            finishCurrent(endedSession: true)
        }
        if let item {
            pageShown(item, position: position, sessionID: sessionID)
        }
    }

    /// The games tab left the screen. The page stays open so later actions still count.
    func feedHidden() {
        guard enabled, var page = current, page.hiddenAt == nil else { return }
        if let since = page.visibleSince {
            page.dwell += Date().timeIntervalSince(since)
        }
        page.visibleSince = nil
        page.hiddenAt = Date()
        current = page
    }

    /// Records a signal for the open page, if it's showing `gameID`.
    func note(_ signal: Signal, gameID: String) {
        guard enabled, var page = current, page.event.gameID == gameID else { return }
        switch signal {
        case .runStarted:
            page.event.tookOver = true
            page.runsStarted += 1
        case .runFinished:
            page.event.runsFinished += 1
            page.runsStarted = max(page.runsStarted, page.event.runsFinished)
        case .saved: page.event.saved = true
        case .liked: page.event.liked = true
        case .floated: page.event.floated = true
        case .openedBoard: page.event.openedBoard = true
        case .addedFriend: page.event.addedFriend = true
        case .remixed: page.event.remixed = true
        case let .social(kind, with: people):
            if !page.event.social.contains(kind) { page.event.social.append(kind) }
            for id in people where !page.event.with.contains(id) { page.event.with.append(id) }
        }
        current = page
    }

    // MARK: - Moments

    /// The CTA on a sponsored page was tapped: its own moment event, `{kind: "sponsor_tap", gameID}`
    /// (Max, backend-api `cdbd915`).
    func sponsorTap(gameID: String) {
        guard enabled else { return }
        var event = FeedEvent(gameID: gameID)
        event.kind = "sponsor_tap"
        enqueue(event)
    }

    private func moment(_ kind: String, gameID: String, with userIDs: [String]) {
        guard enabled else { return }
        if let page = current, page.event.gameID == gameID {
            switch kind {
            case "saved": note(.saved, gameID: gameID)
            case "remix": note(.remixed, gameID: gameID)
            case "add_friend_from_game": note(.addedFriend, gameID: gameID)
            default: note(.social(kind, with: userIDs), gameID: gameID)
            }
            return
        }
        var event = FeedEvent(gameID: gameID)
        event.kind = kind
        event.with = userIDs
        enqueue(event)
    }

    // MARK: - Sending

    private func resume() {
        guard var page = current else { return }
        if let hiddenAt = page.hiddenAt, Date().timeIntervalSince(hiddenAt) > sessionGap {
            let event = page.event
            finishCurrent(endedSession: true)
            var fresh = FeedEvent(gameID: event.gameID)
            fresh.feedItemID = event.feedItemID
            fresh.position = event.position
            fresh.sessionID = event.sessionID
            fresh.reason = event.reason
            fresh.team = event.team
            current = Impression(event: fresh, visibleSince: Date())
            return
        }
        if page.visibleSince == nil {
            page.visibleSince = Date()
        }
        page.hiddenAt = nil
        current = page
    }

    private func finishCurrent(endedSession: Bool) {
        guard var page = current else { return }
        current = nil
        if let since = page.visibleSince {
            page.dwell += Date().timeIntervalSince(since)
        }
        var event = page.event
        event.dwellSec = page.dwell
        event.replays = max(0, page.runsStarted - 1)
        event.quitMidRun = page.runsStarted > event.runsFinished
        event.endedSession = endedSession
        event.at = Date()
        enqueue(event)
    }

    private func enqueue(_ event: FeedEvent) {
        pending.append(event)
        if pending.count >= 5 { flush() }
    }

    /// Sends what's waiting. Failed batches stay for the next try (the server ignores a resent
    /// `eventID`).
    func flush() {
        guard !sending, !pending.isEmpty else { return }
        sending = true
        let batch = pending
        Task { @MainActor [weak self] in
            do {
                try await GamesAPIFactory.current.sendFeedEvents(batch)
                self?.pending.removeFirst(min(batch.count, self?.pending.count ?? 0))
            } catch {
                // Kept; at most 200 waiting.
                if let self, self.pending.count > 200 { self.pending.removeFirst(self.pending.count - 200) }
            }
            self?.sending = false
        }
    }

    private struct Impression {
        var event: FeedEvent
        var visibleSince: Date?
        var hiddenAt: Date?
        var dwell: TimeInterval = 0
        var runsStarted = 0
    }
}
