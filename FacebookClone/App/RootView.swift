import SwiftUI

/// Splash, then either the logged-out screen or the main tabs. Hosts the global toast.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var showSplash = true

    var body: some View {
        ZStack {
            if store.isLoggedIn {
                MainTabView()
                    .transition(.opacity)
            } else {
                LoggedOutView()
                    .transition(.opacity)
            }

            if showSplash {
                SplashView()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: store.isLoggedIn)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 72)
        }
        .task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            withAnimation(.easeOut(duration: 0.35)) {
                showSplash = false
            }
        }
    }
}

/// Shows `store.toast` as a dark snackbar. Add one inside full-screen covers too.
struct ToastHost: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ZStack {
            if let toast = store.toast {
                ToastView(toast: toast)
                    .id(toast.id)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture {
                        store.toast = nil
                    }
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.toast)
    }
}

struct ToastView: View {
    let toast: Toast

    var body: some View {
        HStack(spacing: 10) {
            if let symbol = toast.symbol {
                Image(systemName: symbol)
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
            }
            Text(toast.message)
                .font(.fbBody)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(FBColor.toastBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        .padding(.horizontal, FBMetrics.gutter)
        .accessibilityElement(children: .combine)
    }
}

struct SplashView: View {
    @State private var appeared = false

    var body: some View {
        ZStack {
            FBColor.surface.ignoresSafeArea()

            FacebookLogo(size: 76)
                .scaleEffect(appeared ? 1 : 0.85)
                .opacity(appeared ? 1 : 0)

            VStack(spacing: 2) {
                Spacer()
                Text("from")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                HStack(spacing: 4) {
                    Image(systemName: "infinity")
                        .font(.system(size: FBIconSize.regular, weight: .bold))
                    Text("Meta")
                        .font(.fbHeadline)
                }
                .foregroundStyle(FBColor.primaryText)
                .padding(.bottom, 24)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7)) {
                appeared = true
            }
        }
    }
}

/// Shown after "Log out". Tapping the saved profile signs back in. There are no password fields.
struct LoggedOutView: View {
    @Environment(AppStore.self) private var store
    @State private var isLoggingIn = false

    var body: some View {
        VStack(spacing: 0) {
            Text("English (US)")
                .font(.fbMeta)
                .foregroundStyle(FBColor.secondaryText)
                .padding(.top, 12)

            Spacer()

            FacebookLogo(size: 64)
                .padding(.bottom, 48)

            Button {
                logIn()
            } label: {
                HStack(spacing: 12) {
                    AvatarView(user: store.me, size: FBAvatarSize.row)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.me.name)
                            .font(.fbHeadline)
                            .foregroundStyle(FBColor.primaryText)
                        Text("Tap to continue")
                            .font(.fbMeta)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    Spacer()
                    if isLoggingIn {
                        ProgressView()
                    } else {
                        Image(systemName: "chevron.right")
                            .foregroundStyle(FBColor.secondaryText)
                    }
                }
                .padding(14)
                .background(FBColor.surface, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                        .stroke(FBColor.divider, lineWidth: 1)
                }
            }
            .buttonStyle(.pressable)
            .disabled(isLoggingIn)
            .padding(.horizontal, FBMetrics.screenPadding)

            Spacer()

            Text("This is a demo build. Accounts and data are stored on this device only.")
                .font(.fbCaption)
                .foregroundStyle(FBColor.tertiaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.bottom, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(FBColor.background.ignoresSafeArea())
    }

    private func logIn() {
        isLoggingIn = true
        Haptics.light()
        Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            isLoggingIn = false
            store.logIn()
        }
    }
}
