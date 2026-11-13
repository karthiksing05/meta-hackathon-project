import AVFoundation
import CoreTransferable
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Turns a picked photo or video into the file `POST /v1/media` takes. Format conversion only:
/// the server downscales, describes and keeps the media (CLAUDE.md: the app holds no game data).
///
/// - Photo (HEIC, PNG, JPEG, ...): JPEG at 0.85, long side at most 2,048 px.
/// - Video: MP4 at 1280x720 (or medium quality), the first 60 s when it's longer.
enum MediaUploadPrep {
    static let maxPhotoSide: CGFloat = 2048
    static let jpegQuality: CGFloat = 0.85
    static let maxVideoSeconds: Double = 60
    static let thumbnailSide: CGFloat = 240

    struct Prepared {
        var file: MediaUploadFile
        var thumbnail: UIImage?
        /// Video length after any trim.
        var durationSeconds: Double?
        /// The video was longer than 60 s and was cut to its first 60 s.
        var wasTrimmed = false
    }

    static func isVideo(_ item: PhotosPickerItem) -> Bool {
        item.supportedContentTypes.contains { $0.conforms(to: .movie) || $0.conforms(to: .video) }
    }

    static func prepare(_ item: PhotosPickerItem) async throws -> Prepared {
        if isVideo(item) {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                throw MediaUploadError.unreadable("Couldn't open this video")
            }
            defer { try? FileManager.default.removeItem(at: movie.url) }
            return try await prepareVideo(at: movie.url)
        }
        guard let data = try await item.loadTransferable(type: Data.self) else {
            throw MediaUploadError.unreadable("Couldn't open this photo")
        }
        return try preparePhoto(data)
    }

    // MARK: Photos

    static func preparePhoto(_ data: Data) throws -> Prepared {
        // UIImage reads HEIC, PNG and JPEG, and applies the orientation when drawn.
        guard let image = UIImage(data: data) else { throw MediaUploadError.unreadable("Couldn't open this photo") }
        let resized = scaled(image, maxSide: maxPhotoSide)
        guard let jpeg = resized.jpegData(compressionQuality: jpegQuality) else {
            throw MediaUploadError.unreadable("Couldn't convert this photo")
        }
        return Prepared(file: MediaUploadFile(data: jpeg, mimeType: "image/jpeg", filename: "photo.jpg"),
                        thumbnail: scaled(image, maxSide: thumbnailSide))
    }

    /// Redraws `image` (upright) so its long side is at most `maxSide`.
    static func scaled(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let size = image.size
        let longSide = max(size.width, size.height)
        let scale = longSide > maxSide ? maxSide / longSide : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    // MARK: Video

    static func prepareVideo(at url: URL) async throws -> Prepared {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        let wasTrimmed = duration > maxVideoSeconds + 0.5
        let fits720 = await AVAssetExportSession.compatibility(ofExportPreset: AVAssetExportPreset1280x720, with: asset, outputFileType: .mp4)
        let preset = fits720 ? AVAssetExportPreset1280x720 : AVAssetExportPresetMediumQuality
        guard let export = AVAssetExportSession(asset: asset, presetName: preset) else {
            throw MediaUploadError.unreadable("Couldn't convert this video")
        }
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("media-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: output) }
        export.outputURL = output
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        if wasTrimmed {
            export.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: maxVideoSeconds, preferredTimescale: 600))
        }
        try await run(export)
        let data = try Data(contentsOf: output)
        return Prepared(file: MediaUploadFile(data: data, mimeType: "video/mp4", filename: "video.mp4"),
                        thumbnail: await thumbnail(of: asset),
                        durationSeconds: min(duration, maxVideoSeconds),
                        wasTrimmed: wasTrimmed)
    }

    private static func run(_ session: AVAssetExportSession) async throws {
        let box = ExportBox(session)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                box.session.exportAsynchronously {
                    switch box.session.status {
                    case .completed: continuation.resume()
                    case .cancelled: continuation.resume(throwing: CancellationError())
                    default: continuation.resume(throwing: MediaUploadError.unreadable("Couldn't convert this video"))
                    }
                }
            }
        } onCancel: {
            box.session.cancelExport()
        }
    }

    /// The export session, used from its completion handler and the cancel handler only.
    private final class ExportBox: @unchecked Sendable {
        let session: AVAssetExportSession
        init(_ session: AVAssetExportSession) { self.session = session }
    }

    private static func thumbnail(of asset: AVAsset) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: thumbnailSide, height: thumbnailSide)
        guard let (image, _) = try? await generator.image(at: CMTime(seconds: 0.5, preferredTimescale: 600)) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// A picked movie, copied out of the Photos library into a temporary file.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(ext)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedMovie(url: copy)
        }
    }
}
