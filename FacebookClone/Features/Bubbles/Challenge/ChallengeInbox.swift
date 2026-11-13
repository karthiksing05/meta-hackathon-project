import Foundation
import Observation

/// The server's challenges for the signed-in account (`GET`/`POST /v1/challenges`): the ones
/// friends sent you and the ones you sent, with how each side is doing. Nothing is kept on the
/// phone beyond the last list the server returned.
@MainActor
@Observable
final class ChallengeInbox {
    static let shared = ChallengeInbox()

    private(set) var items: [RemoteChallenge] = []
    private(set) var state: FeedLoadState = .idle

    var received: [RemoteChallenge] { items.filter(\.isReceived) }
    var sent: [RemoteChallenge] { items.filter { !$0.isReceived } }
    /// Received challenges you haven't beaten yet: the badge on the games tab's trophy.
    var openCount: Int { received.filter { !$0.beaten }.count }

    @ObservationIgnored private var task: Task<Void, Never>?

    private init() {
        NotificationCenter.default.addObserver(forName: .gamesAccountChanged, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                ChallengeInbox.shared.items = []
                ChallengeInbox.shared.reload()
            }
        }
    }

    /// Fetches the list again (pull to refresh, after a run, after sending).
    func reload() {
        guard task == nil else { return }
        state = .loading
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.task = nil }
            guard await GamesAccount.shared.waitForUser() != nil else {
                state = .failed(GamesAPIError.signInRequired.localizedDescription)
                return
            }
            do {
                items = try await GamesAPIFactory.current.challenges()
                state = .idle
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }

    /// Sends "beat my score" in each game to one friend. Returns how many went out; the first
    /// error's message is thrown when none did.
    @discardableResult
    func send(gameIDs: [String], to friendID: String) async throws -> Int {
        var sentCount = 0
        var firstError: Error?
        for id in gameIDs {
            do {
                try await GamesAPIFactory.current.sendChallenge(gameID: id, toUserIDs: [friendID])
                sentCount += 1
            } catch {
                firstError = firstError ?? error
            }
        }
        reload()
        if sentCount == 0, let firstError { throw firstError }
        return sentCount
    }
}
