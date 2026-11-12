import SwiftUI

/// The lowercase "facebook" wordmark at the top of the feed.
struct FacebookWordmark: View {
    var size: CGFloat = 30

    var body: some View {
        Text("facebook")
            .font(.system(size: size, weight: .bold))
            .tracking(-1.1)
            .foregroundStyle(FBColor.wordmark)
            .accessibilityLabel("Facebook")
            .accessibilityAddTraits(.isHeader)
    }
}

/// The round blue "f" logo.
struct FacebookLogo: View {
    var size: CGFloat = 60

    var body: some View {
        Circle()
            .fill(FBColor.brandBlue)
            .frame(width: size, height: size)
            .overlay(alignment: .bottom) {
                Text("f")
                    .font(.system(size: size * 0.92, weight: .heavy))
                    .foregroundStyle(.white)
                    .offset(x: size * 0.06, y: size * 0.2)
            }
            .clipShape(Circle())
            .accessibilityLabel("Facebook")
    }
}

/// The Messenger glyph: a speech bubble with a zigzag cut out of it.
struct MessengerGlyph: View {
    var size: CGFloat = 20
    var color: Color = FBColor.primaryText

    var body: some View {
        ZStack {
            Image(systemName: "bubble.left.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(color)
            MessengerBolt()
                .stroke(style: StrokeStyle(lineWidth: size * 0.12, lineCap: .round, lineJoin: .round))
                .frame(width: size * 0.62, height: size * 0.4)
                .offset(y: -size * 0.06)
                .blendMode(.destinationOut)
        }
        .frame(width: size, height: size)
        .compositingGroup()
        .accessibilityHidden(true)
    }
}

/// The zigzag inside the Messenger bubble.
struct MessengerBolt: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.minY + rect.height * 0.22))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.6, y: rect.minY + rect.height * 0.7))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return path
    }
}
