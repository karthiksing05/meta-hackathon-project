import SwiftUI

extension View {
    /// Injects a fresh store, Bubble store and router so `#Preview` blocks render with the mock data.
    func previewEnvironment() -> some View {
        let store = AppStore()
        let bubbleStore = BubbleStore(appStore: store)
        return environment(store).environment(bubbleStore).environment(Router())
    }
}
