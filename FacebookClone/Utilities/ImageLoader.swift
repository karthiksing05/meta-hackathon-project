import UIKit

/// Downloads, decodes and caches images. Requests for the same URL share one download.
final class ImageLoader {
    static let shared = ImageLoader()

    private let memory: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 400
        cache.totalCostLimit = 200 * 1024 * 1024
        return cache
    }()

    private let fetcher = Fetcher()

    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url.absoluteString as NSString)
    }

    func cachedDecoded(key: String) -> UIImage? {
        memory.object(forKey: key as NSString)
    }

    func load(_ url: URL) async -> UIImage? {
        let key = url.absoluteString as NSString
        if let image = memory.object(forKey: key) { return image }
        guard let image = await fetcher.fetch(url) else { return nil }
        memory.setObject(image, forKey: key, cost: image.approximateByteCost)
        return image
    }

    /// Decodes picked-photo data off the main thread and caches it under `key`.
    func decode(_ data: Data, key: String) async -> UIImage? {
        let cacheKey = key as NSString
        if let image = memory.object(forKey: cacheKey) { return image }
        let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let raw = UIImage(data: data) else { return nil }
            return raw.preparingForDisplay() ?? raw
        }.value
        guard let decoded else { return nil }
        memory.setObject(decoded, forKey: cacheKey, cost: decoded.approximateByteCost)
        return decoded
    }

    /// Warms the cache for images the user is likely to see next (the feed's preload buffer).
    func prefetch(_ urls: [URL]) {
        for url in urls.prefix(48) where cached(url) == nil {
            Task(priority: .utility) {
                _ = await self.load(url)
            }
        }
    }

    private actor Fetcher {
        private var tasks: [URL: Task<UIImage?, Never>] = [:]

        private let session: URLSession = {
            let configuration = URLSessionConfiguration.default
            configuration.urlCache = URLCache(memoryCapacity: 40 * 1024 * 1024, diskCapacity: 400 * 1024 * 1024)
            configuration.requestCachePolicy = .returnCacheDataElseLoad
            configuration.timeoutIntervalForRequest = 20
            return URLSession(configuration: configuration)
        }()

        func fetch(_ url: URL) async -> UIImage? {
            if let existing = tasks[url] {
                return await existing.value
            }
            let session = self.session
            let task = Task.detached(priority: .userInitiated) { () -> UIImage? in
                guard let result = try? await session.data(from: url) else { return nil }
                if let http = result.1 as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    return nil
                }
                guard let image = UIImage(data: result.0) else { return nil }
                return image.preparingForDisplay() ?? image
            }
            tasks[url] = task
            let image = await task.value
            tasks[url] = nil
            return image
        }
    }
}

private extension UIImage {
    var approximateByteCost: Int {
        guard let cgImage else { return 1 }
        return cgImage.bytesPerRow * cgImage.height
    }
}
