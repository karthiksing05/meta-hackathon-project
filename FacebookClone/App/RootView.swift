import SwiftUI

/// Splash, then either the logged-out screen or the main tabs. Hosts the global toast.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @State private var showSplash = DebugLaunch.value("FB_SKIP_SPLASH") == nil
    @State private var bestOfFive: BestOfFiveOffer?

    init() {
        // Before the first NavigationStack exists: Facebook's white bars on iOS 17 and 18.
        FBSystemBars.configure()
    }

    var body: some View {
        ZStack {
            if store.isLoggedIn && GamesAccount.shared.state != .signedOut {
                MainTabView()
                    .transition(.opacity)
            } else {
                SignInView()
                    .transition(.opacity)
            }

            if showSplash {
                SplashView()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: store.isLoggedIn)
        .animation(.easeInOut(duration: 0.3), value: GamesAccount.shared.state)
        .overlay(alignment: .bottom) {
            ToastHost()
                .padding(.bottom, 72)
        }
        // A new friend gets a best-of-5 offer (BestOfFiveOfferSheet).
        .sheet(item: $bestOfFive) { offer in
            BestOfFiveOfferSheet(offer: offer)
        }
        .task {
            // FB_BEST_OF_5=<userID> (debug): show the offer as if that friend was just added.
            if let id = DebugLaunch.value("FB_BEST_OF_5"), !id.isEmpty {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                bestOfFive = BestOfFiveOffer(friendID: id)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .gamesFriendAdded)) { note in
            if let id = note.object as? String, !id.isEmpty { bestOfFive = BestOfFiveOffer(friendID: id) }
        }
        .task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            // With FB_HOME_AUTOSCROLL_LOG=1: Home's layout should settle before this line.
            FBScrollLog.home.log("splash fading out")
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

