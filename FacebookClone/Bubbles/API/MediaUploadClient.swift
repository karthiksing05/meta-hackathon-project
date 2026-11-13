import Foundation

// Photos and video a person adds to a game request (branch `media-in`, backend contract
// "Media in the harness"):
//
//     POST   /v1/media              multipart, one part named `file` -> 201 UploadedMedia
//     GET    /v1/media/{id}/thumb   image/jpeg (bearer token)
//     DELETE /v1/media/{id}         204
//
// `POST /v1/harness/plan` and `POST /v1/generate` then take `media: [id]`, `mediaNote` and
// `mediaRestyle` (`GameMediaInput`). The server owns the media: it downscales, describes and keeps
// it, and deletes it with the game. The app only converts formats before the upload
// (`MediaUploadPrep`): JPEG photos, MP4 video of at most 60 s.

/// `POST /v1/media` -> 201.
struct UploadedMedia: Decodable, Equatable, Sendable {
    var mediaId: String
    var kind: String
    var width: Int?
    var height: Int?
    var durationMs: Int?
    var thumbUrl: String?
}

/// What a game request says about the media: the uploaded ids, what to do with them, and whether
/// to restyle photos into the game's look. Only sent when there are ids.
struct GameMediaInput: Equatable, Sendable {
    var ids: [String] = []
    var note: String?
    var restyle = false

    static let none = GameMediaInput()

    /// The server takes up to 9 ids (8 photos and 1 video) and 300 characters of note.
    static let maxItems = 9
    static let maxNoteCharacters = 300

    var isEmpty: Bool { ids.isEmpty }

    /// Adds `media`, `mediaNote` and `mediaRestyle` to a request body; nothing when there are no ids.
    func add(to payload: inout [String: Any]) {
        guard !ids.isEmpty else { return }
        payload["media"] = Array(ids.prefix(Self.maxItems))
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            payload["mediaNote"] = String(note.prefix(Self.maxNoteCharacters))
        }
        if restyle { payload["mediaRestyle"] = true }
    }
}

/// One file ready to upload: already JPEG or MP4.
struct MediaUploadFile: Sendable {
    var data: Data
    var mimeType: String
    var filename: String
}

/// Uploads media to the server (or the mock). `progress` runs with 0...1 as the body is sent.
protocol MediaUploading: Sendable {
    func upload(_ file: MediaUploadFile, progress: @escaping @Sendable (Double) -> Void) async throws -> UploadedMedia
    /// `DELETE /v1/media/{id}`. Best effort: never throws.
    func delete(id: String) async
}

enum MediaUploadError: LocalizedError, Equatable {
    case server(status: Int)
    case network
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .server(413): return "Too big to upload"
        case .server(415): return "This file type can't be used"
        case .server(422): return "Couldn't read this video"
        case .server(429): return "Your upload space is full"
        case .server(503): return "Uploads aren't on yet"
        case .server: return "Upload failed"
        case .network: return "No connection"
        case .unreadable(let why): return why
        }
    }

    static func from(_ error: Error) -> MediaUploadError {
        if let error = error as? MediaUploadError { return error }
        if let error = error as? GamesAPIError {
            switch error {
            case .server(let status, _): return .server(status: status)
            case .network: return .network
            default: return .server(status: 0)
            }
        }
        return .network
    }
}

// MARK: - Live

/// Uploads through `GamesAPILive` (its base URL, tokens and refresh), with a task delegate for
/// upload progress.
struct MediaUploadClient: MediaUploading {
    let api: GamesAPILive

    /// A 60 s video can be tens of MB on a slow connection.
    static let timeout: TimeInterval = 180

    func upload(_ file: MediaUploadFile, progress: @escaping @Sendable (Double) -> Void) async throws -> UploadedMedia {
        let boundary = "media-\(UUID().uuidString)"
        let body = Self.multipart(file, boundary: boundary)
        let delegate = MediaUploadProgress(onProgress: progress)
        let data = try await api.mediaUpload(body: body, contentType: "multipart/form-data; boundary=\(boundary)", delegate: delegate)
        progress(1)
        do { return try GamesAPICoding.decoder().decode(UploadedMedia.self, from: data) }
        catch { throw GamesAPIError.decoding(String(describing: error).prefix(200).description) }
    }

    func delete(id: String) async {
        await api.mediaDelete(id: id)
    }

    static func multipart(_ file: MediaUploadFile, boundary: String) -> Data {
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(file.filename)\"\r\n".utf8))
        body.append(Data("Content-Type: \(file.mimeType)\r\n\r\n".utf8))
        body.append(file.data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }
}

/// Reports `didSendBodyData` as a fraction.
final class MediaUploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        // Hold back the last bit until the server answers.
        onProgress(min(0.97, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }
}

// MARK: - Mock

/// Previews, `FB_API=mock` and `FB_STUDIO_MEDIA_DEMO`: progress over about a second, then a fake
/// id (`mock-…`). Mock ids never go to the server (`StudioMediaModel.input`).
struct MediaUploadMock: MediaUploading {
    static let idPrefix = "mock-"

    func upload(_ file: MediaUploadFile, progress: @escaping @Sendable (Double) -> Void) async throws -> UploadedMedia {
        for step in 1...10 {
            try await Task.sleep(nanoseconds: 100_000_000)
            progress(Double(step) / 10)
        }
        let id = Self.idPrefix + (0..<10).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        let isVideo = file.mimeType.hasPrefix("video/")
        return UploadedMedia(mediaId: id, kind: isVideo ? "video" : "photo", width: 1024, height: 768,
                             durationMs: isVideo ? 30_000 : 0, thumbUrl: "/v1/media/\(id)/thumb")
    }

    func delete(id: String) async {}
}

enum MediaUploadFactory {
    /// The server, except in previews, with `FB_API=mock` and for `FB_STUDIO_MEDIA_DEMO`.
    static var current: any MediaUploading {
        if FacebookDataMode.current == .mock || DebugLaunch.value("FB_STUDIO_MEDIA_DEMO") != nil {
            return MediaUploadMock()
        }
        return MediaUploadClient(api: GamesAPIFactory.current)
    }
}
