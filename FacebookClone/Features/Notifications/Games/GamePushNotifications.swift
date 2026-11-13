import SwiftUI
import Observation
import UIKit
import UserNotifications

/// APNs registration and notification taps. All recipient selection and push sending are
/// server-owned. No local notification is scheduled to stand in for a remote push.
@MainActor
@Observable
final class GamePushNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = GamePushNotifications()
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var errorMessage: String?
    private(set) var isRegistering = false
    var pendingNotificationID: String?

    @ObservationIgnored private var token: String?
    @ObservationIgnored private var registeredKey: String?
    @ObservationIgnored private var revision = UUID()

    private static let registrationKey = "notifications.registeredAccountID"
    private static let installationKey = "notifications.installationID"
    static var installationID: String {
        if let id = UserDefaults.standard.string(forKey: installationKey) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: installationKey)
        return id
    }

    /// Match APNSEnvironment to the signed aps-environment entitlement (setup in docs).
    private var environment: String {
        if let value = Bundle.main.object(forInfoDictionaryKey: "APNSEnvironment") as? String,
           ["sandbox", "production"].contains(value) { return value }
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    func install() { UNUserNotificationCenter.current().delegate = self }

    /// Called from an explicit Enable action, so launching the app never springs a prompt.
    func requestPermission() async {
        guard GamesAccount.shared.userID != nil else { return }
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            if granted { UserDefaults.standard.set(true, forKey: SettingsKey.pushNotifications) }
            await synchronize()
        } catch { errorMessage = "Couldn't enable notifications. Try again." }
    }

    func synchronize() async {
        let request = UUID()
        revision = request
        isRegistering = false
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard revision == request else { return }
        authorization = settings.authorizationStatus
        guard GamesAccount.shared.userID != nil,
              UserDefaults.standard.bool(forKey: SettingsKey.pushNotifications),
              [.authorized, .provisional, .ephemeral].contains(authorization) else {
            await unregister()
            return
        }
        install()
        UIApplication.shared.registerForRemoteNotifications()
        if token != nil { await uploadToken() }
    }

    func didRegister(_ data: Data) async {
        token = data.map { String(format: "%02x", $0) }.joined()
        await uploadToken()
    }

    func didFailRegistration(_ error: Error) {
        isRegistering = false
        errorMessage = "Push notifications aren't available in this build. You can still check your inbox."
    }

    private func uploadToken() async {
        guard let token, let user = GamesAccount.shared.userID,
              UserDefaults.standard.bool(forKey: SettingsKey.pushNotifications),
              [.authorized, .provisional, .ephemeral].contains(authorization) else { return }
        let key = user + ":" + token + ":" + environment
        guard registeredKey != key, !isRegistering else { return }
        let request = revision
        UserDefaults.standard.set(user, forKey: Self.registrationKey) // retain cleanup intent even if the response is lost
        isRegistering = true
        defer { if revision == request { isRegistering = false } }
        do {
            try await GamesAPILive.shared.registerGamePushDevice(installationID: Self.installationID, token: token, environment: environment)
            guard revision == request, GamesAccount.shared.userID == user else { return }
            registeredKey = key
            errorMessage = nil
        } catch {
            if revision == request { errorMessage = "Couldn't connect push notifications. Try again." }
        }
    }

    /// Runs while the old account's bearer token is still available. Also stops OS delivery
    /// immediately; the server request is best effort when the phone has lost connectivity.
    func unregister() async {
        revision = UUID()
        isRegistering = false
        registeredKey = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        guard let user = GamesAccount.shared.userID,
              UserDefaults.standard.string(forKey: Self.registrationKey) == user else { return }
        do {
            try await GamesAPILive.shared.unregisterGamePushDevice(installationID: Self.installationID)
            UserDefaults.standard.removeObject(forKey: Self.registrationKey)
            errorMessage = nil
        } catch {
            // Keep a visible retry path for an opt-out that couldn't reach the server.
            errorMessage = "Couldn't update push notifications. Connect and try again."
        }
    }

    func clearForSignOut() {
        pendingNotificationID = nil
        token = nil
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    func updateBadge(_ count: Int) async {
        try? await UNUserNotificationCenter.current().setBadgeCount(max(0, count))
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let id = response.notification.request.content.userInfo["notificationId"] as? String,
              !id.isEmpty, id.count <= 200 else { return }
        await MainActor.run { self.pendingNotificationID = id }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        guard let id = notification.request.content.userInfo["notificationId"] as? String,
              !id.isEmpty, id.count <= 200 else { return [] }
        return await presentIfOwned(id: id)
    }

    private func presentIfOwned(id: String) async -> UNNotificationPresentationOptions {
        guard GamesAccount.shared.userID != nil,
              UserDefaults.standard.bool(forKey: SettingsKey.pushNotifications) else { return [] }
        let inbox = GameNotificationInbox.shared
        inbox.useAccount(GamesAccount.shared.userID)
        guard await inbox.resolve(id: id) != nil else { return [] }
        await inbox.reload()
        return [.banner, .list, .sound]
    }
}

/// SwiftUI's App delegate bridge receives the real APNs token; no token is logged or bundled.
final class GameNotificationsAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        GamePushNotifications.shared.install()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in await GamePushNotifications.shared.didRegister(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        GamePushNotifications.shared.didFailRegistration(error)
    }
}
