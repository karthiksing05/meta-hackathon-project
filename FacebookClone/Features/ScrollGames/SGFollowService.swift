import Foundation

/// Saves follows on the Scroll Games server (`POST` / `DELETE /api/users/{id}/follow`).
enum SGFollowService {
    struct FollowError: Error {}

    static func setFollowing(_ following: Bool, userID: String) async throws {
        let url = SGConfig.baseURL.appendingPathComponent("api/users/\(userID)/follow")
        var request = URLRequest(url: url)
        request.httpMethod = following ? "POST" : "DELETE"
        request.setValue(SGConfig.userID, forHTTPHeaderField: "X-User")
        request.timeoutInterval = 10
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw FollowError()
        }
    }
}
