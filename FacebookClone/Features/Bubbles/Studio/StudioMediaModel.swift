import Observation
import PhotosUI
import SwiftUI
import UIKit

/// The photos and video added on Describe: up to 8 photos and 1 video of up to 60 s. Each one is
/// converted (`MediaUploadPrep`) and uploaded (`MediaUploading`) as soon as it's picked; the plan
/// and the build send the ids (`input`). The server keeps and describes the media.
///
/// DEBUG: `FB_STUDIO_MEDIA_DEMO=1` fills in a few mock items (a photo, a video, one uploading);
/// `=error` adds a failed upload too. Uploads go to the mock then.
@Observable
final class StudioMediaModel {
    struct Item: Identifiable {
        enum Kind { case photo, video }
        enum Phase: Equatable {
            case preparing
            case uploading(Double)
            case uploaded(String)
            case failed(String)
        }

        let id = UUID()
        var kind: Kind
        var phase: Phase = .preparing
        var thumbnail: UIImage?
        var durationSeconds: Double?
        var wasTrimmed = false
        /// The pick, to convert again when converting failed.
        var source: PhotosPickerItem?
        /// The converted file, to upload again when the upload failed.
        var file: MediaUploadFile?

        var isWorking: Bool {
            switch phase {
            case .preparing, .uploading: return true
            case .uploaded, .failed: return false
            }
        }
    }

    static let maxPhotos = 8
    static let maxVideos = 1

    private(set) var items: [Item] = []
    /// "What should the game do with these?"
    var note = ""
    /// Restyle the photos into the game's look (cartoon, never photoreal). Off by default.
    var restyle = false
    /// A one-line note under the strip (a trimmed video, picks over the limit).
    private(set) var notice: String?

    @ObservationIgnored private var tasks: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private let uploader: any MediaUploading = MediaUploadFactory.current

    var photoCount: Int { items.filter { $0.kind == .photo }.count }
    var videoCount: Int { items.filter { $0.kind == .video }.count }
    var canAddPhotos: Bool { photoCount < Self.maxPhotos }
    var canAddVideo: Bool { videoCount < Self.maxVideos }
    var canAddMore: Bool { canAddPhotos || canAddVideo }
    var remainingSlots: Int { (Self.maxPhotos - photoCount) + (Self.maxVideos - videoCount) }
    /// True while anything is still converting or uploading.
    var isBusy: Bool { items.contains(where: \.isWorking) }

    /// What the picker offers: photos, videos or both, by what's left.
    var pickerFilter: PHPickerFilter {
        switch (canAddPhotos, canAddVideo) {
        case (true, false): return .images
        case (false, true): return .videos
        default: return .any(of: [.images, .videos])
        }
    }

    /// The uploaded ids, the note and the restyle switch, for the plan and the build. Mock ids
    /// (`FB_STUDIO_MEDIA_DEMO`, `FB_API=mock`) stay on the device.
    var input: GameMediaInput {
        let ids = items.compactMap { item -> String? in
            guard case .uploaded(let id) = item.phase, !id.hasPrefix(MediaUploadMock.idPrefix) else { return nil }
            return id
        }
        guard !ids.isEmpty else { return .none }
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return GameMediaInput(ids: ids, note: text.isEmpty ? nil : text, restyle: restyle)
    }

    // MARK: Changes

    /// Adds picks, keeping to 8 photos and 1 video, and starts each upload.
    @MainActor
    func add(_ picked: [PhotosPickerItem]) {
        var photos = Self.maxPhotos - photoCount
        var videos = Self.maxVideos - videoCount
        var skipped = 0
        for pick in picked {
            let isVideo = MediaUploadPrep.isVideo(pick)
            if isVideo ? videos <= 0 : photos <= 0 {
                skipped += 1
                continue
            }
            if isVideo { videos -= 1 } else { photos -= 1 }
            let item = Item(kind: isVideo ? .video : .photo, source: pick)
            items.append(item)
            start(item.id)
        }
        notice = skipped > 0 ? "Up to \(Self.maxPhotos) photos and \(Self.maxVideos) video. \(skipped) left out." : nil
    }

    @MainActor
    func retry(_ id: UUID) {
        guard let index = items.firstIndex(where: { $0.id == id }), case .failed = items[index].phase else { return }
        items[index].phase = items[index].file == nil ? .preparing : .uploading(0)
        start(id)
    }

    @MainActor
    func remove(_ id: UUID) {
        tasks[id]?.cancel()
        tasks[id] = nil
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        let item = items.remove(at: index)
        if case .uploaded(let mediaID) = item.phase {
            let uploader = uploader
            Task.detached { await uploader.delete(id: mediaID) }
        }
        if item.wasTrimmed || items.isEmpty { notice = nil }
    }

    /// Studio was discarded before anything was built from the media: stop the uploads and delete
    /// what reached the server (best effort).
    func discardAll() {
        tasks.values.forEach { $0.cancel() }
        tasks = [:]
        let ids = items.compactMap { item -> String? in
            if case .uploaded(let id) = item.phase { return id }
            return nil
        }
        items = []
        guard !ids.isEmpty else { return }
        let uploader = uploader
        Task.detached { for id in ids { await uploader.delete(id: id) } }
    }

    // MARK: Upload

    @MainActor
    private func start(_ id: UUID) {
        tasks[id]?.cancel()
        tasks[id] = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let file = try await self.prepareIfNeeded(id)
                try Task.checkCancellation()
                self.update(id) { $0.phase = .uploading(0) }
                let uploaded = try await self.uploader.upload(file) { [weak self] fraction in
                    Task { @MainActor in
                        self?.update(id) { item in
                            if case .uploading = item.phase { item.phase = .uploading(fraction) }
                        }
                    }
                }
                try Task.checkCancellation()
                self.update(id) { $0.phase = .uploaded(uploaded.mediaId) }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                let message = MediaUploadError.from(error).errorDescription ?? "Upload failed"
                self.update(id) { $0.phase = .failed(message) }
            }
            self.tasks[id] = nil
        }
    }

    /// The converted file: kept from an earlier try, or converted now.
    @MainActor
    private func prepareIfNeeded(_ id: UUID) async throws -> MediaUploadFile {
        guard let item = items.first(where: { $0.id == id }) else { throw CancellationError() }
        if let file = item.file { return file }
        guard let source = item.source else { throw MediaUploadError.unreadable("Couldn't open this file") }
        let prepared = try await MediaUploadPrep.prepare(source)
        update(id) {
            $0.file = prepared.file
            $0.thumbnail = prepared.thumbnail
            $0.durationSeconds = prepared.durationSeconds
            $0.wasTrimmed = prepared.wasTrimmed
        }
        if prepared.wasTrimmed {
            notice = "Your video is longer than a minute, so the game uses its first 60 seconds."
        }
        return prepared.file
    }

    @MainActor
    private func update(_ id: UUID, _ change: (inout Item) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }

    // MARK: Debug

    #if DEBUG
    /// `FB_STUDIO_MEDIA_DEMO`: mock items drawn as gradients (no real photos or people).
    func debugFill(_ mode: String) {
        func gradient(_ top: UInt32, _ bottom: UInt32) -> UIImage {
            let size = CGSize(width: 240, height: 240)
            return UIGraphicsImageRenderer(size: size).image { context in
                let colors = [UIColor(hex: top).cgColor, UIColor(hex: bottom).cgColor] as CFArray
                if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
                    context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
                }
            }
        }
        let fake = MediaUploadFile(data: Data(), mimeType: "image/jpeg", filename: "photo.jpg")
        items = [
            Item(kind: .photo, phase: .uploaded("mock-photo-1"), thumbnail: gradient(0xADD8FF, 0x5B5BFF), file: fake),
            Item(kind: .video, phase: .uploaded("mock-video-1"), thumbnail: gradient(0xC9B2FF, 0x1F2B66),
                 durationSeconds: 42, file: fake),
            Item(kind: .photo, phase: .uploading(0.55), thumbnail: gradient(0x7FE0C8, 0x9AC2FF), file: fake),
        ]
        if mode == "error" {
            items.append(Item(kind: .photo, phase: .failed("No connection"), thumbnail: gradient(0xFFD27A, 0xC9B2FF), file: fake))
        }
        note = mode == "empty-note" ? "" : "use my dog as the hero"
    }
    #endif
}
