import SwiftUI

extension View {
    /// Injects a fresh store and router so `#Preview` blocks render with the mock data.
    func previewEnvironment() -> some View {
        environment(AppStore()).environment(Router())
    }
}
