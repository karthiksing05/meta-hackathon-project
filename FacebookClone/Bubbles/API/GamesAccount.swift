import Foundation
import Observation

/// The signed-in games account, held once for the app. Every call that needs a token goes through
/// `GamesAPILive.shared`, which uses the same tokens.
///
/// - At launch: saved tokens sign straight in (`GET /v1/auth/me`). With none, the app shows the
///   sign-in screen (`SignInView`) and waits: the person logs in, creates an account, or continues
///   as a guest (this device's own account, `GamesAuth.signInAsDevice`, password in the Keychain).
/// - Installs that already had a device account keep it, so nobody is signed out by an update.
/// - Launches that jump straight to a screen (`FB_TAB`, `FB_OPEN`, `FB_STUDIO_*`, for agents and
///   screenshots) continue as a guest without showing the screen. `FB_AUTH=screen` forces it.
///
/// Read with `GamesAccount.shared` on the main thread.
@Observable
final class GamesAccount {
    static let shared = GamesAccount()

    enum State: Equatable {
        case signingIn
        case signedIn
        /// No account yet on this phone, or the person logged out: show `SignInView`.
        case signedOut
        /// Couldn't reach the server or sign in; `message` is shown as is.
        case failed(String)
    }

    private(set) var state: State = .signingIn
    /// The server's account for this phone.
    private(set) var user: RemoteUser?

    @ObservationIgnored private var task: Task<Void, Never>?

    private init() {}

    var userID: String? { user?.id }

    /// A device (guest) account rather than one the person made: its email is `…@device.invalid`.
    var isGuest: Bool { user?.email?.hasSuffix("@device.invalid") ?? false }

    /// At launch: saved tokens, else the device account if this phone already has one (or the
    /// launch is automated), else `.signedOut`. Later calls reuse the same attempt.
    func signIn() {
        guard task == nil, user == nil, state != .signedOut else { return }
        state = .signingIn
        task = Task { @MainActor [weak self] in
            let api = GamesAPILive.shared
            do {
                if await api.isSignedIn, let current = try? await api.me() {
                    self?.finish(current)
                } else if await api.hasDeviceAccount || Self.automatedLaunch {
                    self?.finish(try await api.signInAsDevice())
                } else {
                    await api.setAutoSignIn(false)
                    self?.state = .signedOut
                }
            } catch {
                self?.state = .failed(error.localizedDescription)
            }
            self?.task = nil
        }
    }

    /// `POST /v1/auth/login`. Throws a message to show under the form.
    @MainActor
    func logIn(email: String, password: String) async throws {
        let user = try await GamesAPILive.shared.login(email: email.trimmingCharacters(in: .whitespaces), password: password)
        finish(user)
    }

    /// `POST /v1/auth/register`, then signed in.
    @MainActor
    func signUp(name: String, username: String, email: String, password: String) async throws {
        let user = try await GamesAPILive.shared.register(
            email: email.trimmingCharacters(in: .whitespaces),
            username: username.trimmingCharacters(in: .whitespaces).lowercased(),
            displayName: name.trimmingCharacters(in: .whitespaces),
            password: password)
        finish(user)
    }

    /// This phone's own account, with no email or password to remember.
    @MainActor
    func continueAsGuest() async throws {
        finish(try await GamesAPILive.shared.signInAsDevice())
    }

    /// Ends the session on the server and shows the sign-in screen. The device account's
    /// password stays in the Keychain, so "Continue as guest" returns to it.
    @MainActor
    func signOut() async {
        task?.cancel()
        task = nil
        let api = GamesAPILive.shared
        await api.signOut()
        await api.setAutoSignIn(false)
        user = nil
        state = .signedOut
    }

    func retry() {
        task?.cancel()
        task = nil
        user = nil
        if state == .signedOut { return }
        state = .signingIn
        signIn()
    }

    /// Waits for the current sign-in to end. Returns the user, or nil if it failed or nobody is signed in.
    @MainActor
    func waitForUser() async -> RemoteUser? {
        if user == nil, task == nil, state != .signedOut { signIn() }
        await task?.value
        return user
    }

    @MainActor
    private func finish(_ user: RemoteUser) {
        self.user = user
        state = .signedIn
        Task { await GamesAPILive.shared.setAutoSignIn(true) }
        NotificationCenter.default.post(name: .gamesAccountChanged, object: nil)
    }

    private static var automatedLaunch: Bool {
        if DebugLaunch.value("FB_AUTH") == "screen" { return false }
        if DebugLaunch.value("FB_AUTH") == "guest" { return true }
        let env = ProcessInfo.processInfo.environment
        return env.keys.contains { $0 == "FB_TAB" || $0 == "FB_OPEN" || $0.hasPrefix("FB_STUDIO") }
    }
}

extension Notification.Name {
    /// Posted when someone signs in, signs up or continues as a guest (a new account may mean new
    /// friends, Groups, games and scores). Screens that cache server data reload on it.
    static let gamesAccountChanged = Notification.Name("gamesAccountChanged")
}
