import Foundation

extension MuseConfig {
    /// Reads a `MuseConfig.json` file by path. The CLI passes
    /// `FacebookClone/Bubbles/Studio/MuseConfig.json`; the app uses `load(bundle:)`.
    static func load(fileAt url: URL) -> MuseConfig? {
        guard let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(MuseConfig.self, from: data),
              !config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return config
    }

    /// The file first (when given), then the `MUSE_API_KEY` environment variable.
    static func load(file url: URL?, environment: [String: String] = ProcessInfo.processInfo.environment) -> MuseConfig? {
        if let url, let config = load(fileAt: url) {
            return config
        }
        if let key = environment["MUSE_API_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
            return MuseConfig(apiKey: key)
        }
        return nil
    }

    /// For logs: everything except the key.
    var redactedDescription: String {
        "\(baseURL) · planner \(plannerModel) · fast \(fastModel) · image \(imageModel) · fallback \(visionModel) · key set"
    }
}
