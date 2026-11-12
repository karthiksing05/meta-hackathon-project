import SwiftUI

struct ComingSoonView: View {
    let title: String
    let symbol: String

    @Environment(Router.self) private var router

    var body: some View {
        VStack(spacing: 20) {
            ContentUnavailableView(
                title,
                systemImage: symbol,
                description: Text("This part of Facebook isn't in the demo yet.")
            )
            Button {
                router.popToRoot()
                router.select(.home)
            } label: {
                Text("Back to Feed")
            }
            .buttonStyle(.fb(.primary, expand: false, height: 40))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FBColor.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
