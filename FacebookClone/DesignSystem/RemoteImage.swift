import SwiftUI
import UIKit

enum RemoteImagePlaceholder {
    /// A flat gray block (feed photos).
    case gray
    /// Nothing, so a view underneath shows through (avatars draw initials behind).
    case clear
}

/// Shows a remote image (or picked photo data) filling exactly the space it is given.
///
/// Size it from outside, e.g. `.frame(height: 300)` or `.aspectRatio(4/3, contentMode: .fit)`.
/// Images come from `ImageLoader`'s cache when possible, so cells don't flicker on re-appear.
struct RemoteImage: View {
    let url: URL?
    var data: Data?
    var contentMode: ContentMode
    var placeholder: RemoteImagePlaceholder

    @State private var image: UIImage?

    init(
        url: URL?,
        data: Data? = nil,
        contentMode: ContentMode = .fill,
        placeholder: RemoteImagePlaceholder = .gray
    ) {
        self.url = url
        self.data = data
        self.contentMode = contentMode
        self.placeholder = placeholder
        let key = RemoteImage.cacheKey(url: url, data: data)
        if data != nil {
            _image = State(initialValue: ImageLoader.shared.cachedDecoded(key: key))
        } else {
            _image = State(initialValue: url.flatMap { ImageLoader.shared.cached($0) })
        }
    }

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .transition(.opacity)
                } else {
                    placeholderView
                }
            }
            .clipped()
            .contentShape(Rectangle())
            .task(id: RemoteImage.cacheKey(url: url, data: data)) {
                await load()
            }
    }

    @ViewBuilder
    private var placeholderView: some View {
        switch placeholder {
        case .gray:
            Rectangle().fill(FBColor.skeleton)
        case .clear:
            Color.clear
        }
    }

    private func load() async {
        let key = RemoteImage.cacheKey(url: url, data: data)
        if let data {
            let decoded = await ImageLoader.shared.decode(data, key: key)
            guard !Task.isCancelled else { return }
            image = decoded
            return
        }
        guard let url else {
            image = nil
            return
        }
        if let cached = ImageLoader.shared.cached(url) {
            image = cached
            return
        }
        image = nil
        let loaded = await ImageLoader.shared.load(url)
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            image = loaded
        }
    }

    /// Cheap identity for the image source. Picked photos are keyed by size plus sampled bytes.
    static func cacheKey(url: URL?, data: Data?) -> String {
        if let data {
            return "data-\(data.count)-\(data.prefix(64).hashValue)-\(data.suffix(64).hashValue)"
        }
        return url?.absoluteString ?? "none"
    }
}
