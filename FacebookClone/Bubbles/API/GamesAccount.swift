import Foundation
import Observation

/// The signed-in games account, held once for the app. Signs in at launch with this device's
/// account (`GamesAuth.signInAsDevice`; created on first launch, password in the Keychain), then
/// keeps the server's user. Every call that needs a token goes through `GamesAPILive.shared`,
/// which uses the same tokens.
///
/// Read with `GamesAccount.shared` (main actor).
@MainActor
@Observable
final class GamesAccount {
    static let shared = GamesAccount()

    enum State: Equatable {
        case signingIn
        case signedIn
        /// Couldn't reach the server or sign in; `message` is shown as is.
        case failed(String)
    }

    private(set) var state: State = .signingIn
    /// The server's account for this device.
    private(set) var user: RemoteUser?

    @ObservationIgnored private var task: Task<Void, Never>?

    private init() {}

    var userID: String? { user?.id }

    /// Signs in once; later calls reuse the same attempt until it ends. Call `retry()` after a failure.
    func signIn() {
        guard task == nil, user == nil else { return }
        state = .signingIn
        task = Task { [weak self] in
            let api = GamesAPILive.shared
            do {
                let user: RemoteUser
                if await api.isSignedIn, let current = try? await api.me() {
                    user = current
                } else {
                    user = try await api.signInAsDevice()
                }
                self?.user = user
                self?.state = .signedIn
            } catch {
                self?.state = .failed(error.localizedDescription)
            }
            self?.task = nil
        }
    }

    func retry() {
        task?.cancel()
        task = nil
        user = nil
        signIn()
    }

    /// Waits for the current sign-in to end. Returns the user, or nil if it failed.
    func waitForUser() async -> RemoteUser? {
        if user == nil, task == nil { signIn() }
        await task?.value
        return user
    }
}
