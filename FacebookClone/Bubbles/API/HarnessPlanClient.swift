import Foundation

/// Asks the server to plan a game before it's built: `POST /v1/harness/plan {request}` ->
/// `{plan, clarify, spec, types, timings}` (backend/internal/api/harness.go, docs/HARNESS_V2.md).
/// The server understands the idea, finds the game type in its catalog, and has Muse fill in every
/// part of the game. It takes about 30 s (up to 115 s on the server), so the call waits 120 s.
///
///     switch try await HarnessPlanClient.shared.plan(request: "a harry potter krillion") {
///     case .plan(let plan): …          // show it, ask its 0–2 questions
///     case .unavailable: …             // planning is off on this server: go straight on
///     }
///
/// Errors: 404 means planning is turned off on the server (`HARNESS_CONTEXT=0`), which is not an
/// error for the app: it's `.unavailable`, and the Plan step steps aside. 503 (Muse isn't set up)
/// is treated the same way. 502 and network errors throw, so the step can offer Try again.
///
/// The call goes through `GamesAPILive`'s session, tokens and refresh. Its `send` is private to
/// its file, so the live transport is a three-line `GamePlanTransport` conformance added there
/// (see the hook patch). Until that lands the client reports `.unavailable` and nothing changes.
///
/// DEBUG: `FB_STUDIO_PLAN=normal|questions|gap|opinion|story|failed|off` answers with a preview
/// fixture (`GamePlanFixtures`) instead of the server, for screenshots. Release builds never read it.
struct HarnessPlanClient: Sendable {
    enum Outcome: Sendable {
        case plan(GamePlan)
        /// Planning isn't available on this server; build without it.
        case unavailable
    }

    static var shared: HarnessPlanClient {
        HarnessPlanClient(transport: (GamesAPIFactory.current as Any) as? GamePlanTransport)
    }

    /// Nil when the live client can't send the request yet.
    let transport: (any GamePlanTransport)?

    /// The server caps the plan at 115 s.
    static let timeout: TimeInterval = 120
    /// The server takes 1 to 2,000 characters of request.
    static let maxRequestCharacters = 2_000

    /// `groupID`: a server Group (or Event) I'm in that the game is for; the server plans with its
    /// name and members (`groupId`).
    func plan(request: String, groupID: String? = nil) async throws -> Outcome {
        #if DEBUG
        if let fixture = DebugLaunch.value("FB_STUDIO_PLAN") {
            return try await GamePlanFixtures.answer(fixture, request: request)
        }
        #endif
        let text = String(request.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxRequestCharacters))
        guard !text.isEmpty, let transport else { return .unavailable }
        var fields: [String: Any] = ["request": text]
        if let groupID, !groupID.isEmpty { fields["groupId"] = groupID }
        let body = try JSONSerialization.data(withJSONObject: fields)
        do {
            return .plan(try GamePlan.decode(try await transport.gamePlanRaw(body: body)))
        } catch GamesAPIError.notFound {
            return .unavailable
        } catch GamesAPIError.server(let status, _) where status == 404 || status == 503 {
            return .unavailable
        }
    }
}

/// Sends the raw plan request and returns the reply body. `GamesAPILive` adopts it in its own file
/// (it needs the private `send`):
///
///     extension GamesAPILive: GamePlanTransport {
///         func gamePlanRaw(body: Data) async throws -> Data {
///             try await send("POST", "v1/harness/plan", body: body, contentType: "application/json",
///                            auth: .required, timeout: HarnessPlanClient.timeout)
///         }
///     }
protocol GamePlanTransport: Sendable {
    func gamePlanRaw(body: Data) async throws -> Data
}
