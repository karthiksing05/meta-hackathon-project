import SwiftUI

/// The yellow "Ad" tag on paid content (sponsored games and posts), the way Facebook marks ads.
struct AdBadge: View {
    var body: some View {
        Text("Ad")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Color.black)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Color(red: 1.0, green: 0.82, blue: 0.0), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
            .accessibilityLabel("Ad")
    }
}
