import SwiftUI

// A sponsored feed page, Instagram-ad style: the brand's name and avatar at the top, the live game
// in the middle (the page itself), and a call-to-action bar with a small "Sponsored" tag at the
// bottom. Only the server decides a page is sponsored (`sponsor` on the feed item); the app has no
// brands of its own.

/// Top of a sponsored page: the brand's avatar and name, "Sponsored" under it.
struct SponsoredHeader: View {
    let sponsor: RemoteSponsor

    var body: some View {
        HStack(spacing: 8) {
            SponsorAvatar(sponsor: sponsor, size: 32)
            VStack(alignment: .leading, spacing: 0) {
                Text(sponsor.name)
                    .font(.fbName)
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Text("Sponsored")
                    .font(.fbMicro)
                    .foregroundStyle(Color.white.opacity(0.8))
            }
        }
        .padding(.leading, 4)
        .padding(.trailing, 12)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.32), in: Capsule())
        .shadow(color: Color.black.opacity(0.25), radius: 2, y: 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sponsored by \(sponsor.name)")
    }
}

/// Bottom of a sponsored page: the CTA ("Play now" unless the server says otherwise), "Learn more"
/// when the sponsor has a page, and the small "Sponsored" tag.
struct SponsoredFooter: View {
    let sponsor: RemoteSponsor
    /// The game's id, for the `sponsor_tap` event.
    let gameID: String
    let onPlay: () -> Void

    @Environment(\.openURL) private var openURL

    private var cta: String {
        let text = sponsor.cta?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? "Play now" : text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Button {
                    Haptics.light()
                    FeedEventReporter.shared.sponsorTap(gameID: gameID)
                    onPlay()
                } label: {
                    HStack {
                        Text(cta)
                            .font(.fbHeadline)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                            .font(.system(size: FBIconSize.small, weight: .bold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .frame(maxWidth: .infinity)
                    .background(FBColor.brandBlue, in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                }
                .buttonStyle(.plain)
                if let url = sponsor.url {
                    Button("Learn more") {
                        FeedEventReporter.shared.sponsorTap(gameID: gameID)
                        openURL(url)
                    }
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: FBMetrics.radiusSmall, style: .continuous))
                }
            }
            Text("Sponsored")
                .font(.fbMicroEmphasized)
                .foregroundStyle(Color.white.opacity(0.75))
                .accessibilityLabel("Sponsored by \(sponsor.name)")
        }
    }
}

/// The brand's avatar from `avatarUrl`, else its initial on a neutral circle.
struct SponsorAvatar: View {
    let sponsor: RemoteSponsor
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            Circle().fill(Color.white.opacity(0.9))
            Text(String(sponsor.name.prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.7))
            if let url = sponsor.avatarURL {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.white.opacity(0.8), lineWidth: 1))
        .accessibilityHidden(true)
    }
}
