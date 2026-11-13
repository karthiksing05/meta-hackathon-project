import Foundation

// Live smoke check: GET /readyz and GET /v1/feed, decoded with the app's real wire models.
// Run: tools/games-api-smoke/run.sh [base-url]   (default https://api.ol4ol.com). No tokens, no writes.

let base = URL(string: CommandLine.arguments.dropFirst().first ?? "https://api.ol4ol.com")!
nonisolated(unsafe) var failed = false

func fetch(_ path: String) async -> (Data, Int)? {
    var request = URLRequest(url: URL(string: path, relativeTo: base)!, timeoutInterval: 8)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    } catch {
        print("FAIL \(path): \(error.localizedDescription)")
        failed = true
        return nil
    }
}

if let (data, status) = await fetch("readyz") {
    print("readyz: HTTP \(status) \(String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")")
    if status != 200 { failed = true }
}

if let (data, status) = await fetch("v1/feed?limit=20") {
    do {
        let page = try GamesAPICoding.decoder().decode(RemoteGamePage.self, from: data)
        print("feed: HTTP \(status), \(page.items.count) games, next cursor: \(page.hasMore ? "yes" : "none")")
        if let first = page.items.first {
            print("  first: \(first.id) \"\(first.title)\" by \(first.ownerUsername), \(first.likes) saves, manifest \(first.manifestURL)")
        }
        if status != 200 { failed = true }
        if let first = page.items.first, let (board, s) = await fetch("v1/games/\(first.id)/leaderboard") {
            let rows = try GamesAPICoding.decoder().decode(RemoteScoreboard.self, from: board)
            print("leaderboard(\(first.id)): HTTP \(s), \(rows.items.count) rows")
        }
        if let first = page.items.first, let (one, s) = await fetch("v1/games/\(first.id)") {
            let g = try GamesAPICoding.decoder().decode(RemoteGame.self, from: one)
            print("game(\(first.id)): HTTP \(s), title \"\(g.title)\"")
        }
    } catch {
        print("FAIL decoding feed: \(error)")
        failed = true
    }
}

print(failed ? "SMOKE FAILED" : "SMOKE OK")
exit(failed ? 1 : 0)
