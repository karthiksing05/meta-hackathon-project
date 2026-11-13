import SwiftUI

/// The minimized builds, docked above the tab bar like a music mini-player (`GameBuildTracker`).
///
/// - Building: the working title, the current step ("Muse is playtesting…") and a thin progress
///   ring. Tap to reopen Studio on that step.
/// - Ready: "Your game is ready" with Play, which opens Studio's Try it.
/// - Didn't work: the reason, Try again, and a close button.
/// - More than one: one pill ("2 games building") that opens into a pill per build.
///
/// Put it right above the tab bar (`MainTabView`) and at the bottom of Messenger.
struct GameBuildDock: View {
    @Environment(Router.self) private var router
    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isExpanded = false

    private var tracker: GameBuildTracker { .shared }

    var body: some View {
        let builds = tracker.docked
        VStack(spacing: FBSpacing.xs) {
            if builds.count == 1, let build = builds.first {
                GameBuildPill(build: build, actions: actions)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else if builds.count > 1 {
                if isExpanded {
                    ForEach(builds) { build in
                        GameBuildPill(build: build, actions: actions)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                GameBuildStackPill(builds: builds, isExpanded: isExpanded) {
                    Haptics.selection()
                    withAnimation(animation) { isExpanded.toggle() }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, FBSpacing.s)
        .padding(.bottom, builds.isEmpty ? 0 : FBSpacing.s)
        .animation(animation, value: builds)
        .onChange(of: builds.count) { _, count in
            if count < 2 { isExpanded = false }
        }
        .task {
            tracker.resumeIfNeeded()
            #if DEBUG
            GameBuildFixtures.applyIfRequested(router: router, bubbleStore: bubbleStore)
            if GameBuildFixtures.startsExpanded { isExpanded = true }
            #endif
        }
    }

    private var animation: Animation { reduceMotion ? GameMotion.reduced : GameMotion.appear }

    private var actions: GameBuildPill.Actions {
        GameBuildPill.Actions(
            open: { tracker.open($0, router: router) },
            retry: { tracker.retry($0, router: router) },
            dismiss: { id in withAnimation(animation) { tracker.dismiss(id) } }
        )
    }
}

// MARK: - One build

struct GameBuildPill: View {
    struct Actions {
        var open: (UUID) -> Void
        var retry: (UUID) -> Void
        var dismiss: (UUID) -> Void
    }

    let build: GameBuild
    let actions: Actions

    var body: some View {
        HStack(spacing: FBSpacing.m) {
            Button { actions.open(build.id) } label: {
                HStack(spacing: FBSpacing.m) {
                    GameBuildBadge(build: build)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(headline)
                            .font(.fbName)
                            .foregroundStyle(FBColor.primaryText)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(.fbMeta)
                            .foregroundStyle(build.status == .failed ? FBColor.notificationRed : FBColor.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint(build.status == .building ? "Opens Studio" : "")

            trailing
        }
        .padding(.leading, FBSpacing.s)
        .padding(.trailing, FBSpacing.m)
        .padding(.vertical, FBSpacing.s)
        .gameBuildCard()
    }

    private var headline: String {
        switch build.status {
        case .building: return build.title
        case .ready: return "Your \(ProductName.singular) is ready"
        case .failed: return "Didn't work"
        }
    }

    private var subtitle: String {
        switch build.status {
        case .building: return build.stepText
        case .ready: return build.title
        case .failed: return "\(build.title) · \(build.stepText)"
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch build.status {
        case .building:
            Image(systemName: "chevron.up")
                .font(.system(size: FBIconSize.small, weight: .semibold))
                .foregroundStyle(FBColor.secondaryText)
                .frame(width: 32, height: 44)
                .contentShape(Rectangle())
                .onTapGesture { actions.open(build.id) }
                .accessibilityLabel("Open Studio")
                .accessibilityAddTraits(.isButton)
        case .ready:
            GameBuildActionButton(title: "Play", symbol: "play.fill") { actions.open(build.id) }
        case .failed:
            HStack(spacing: FBSpacing.xs) {
                GameBuildActionButton(title: "Try again", symbol: nil) { actions.retry(build.id) }
                Button { actions.dismiss(build.id) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                        .foregroundStyle(FBColor.secondaryText)
                        .frame(width: 28, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
        }
    }
}

// MARK: - Several builds

struct GameBuildStackPill: View {
    let builds: [GameBuild]
    let isExpanded: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: FBSpacing.m) {
                ZStack {
                    ForEach(Array(builds.prefix(2).enumerated().reversed()), id: \.element.id) { index, build in
                        GameBuildBadge(build: build)
                            .offset(x: CGFloat(index) * 10)
                    }
                }
                .frame(width: 50, alignment: .leading)
                VStack(alignment: .leading, spacing: 1) {
                    Text(Self.headline(for: builds))
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: isExpanded ? "chevron.down" : "chevron.up")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 32, height: 44)
            }
            .padding(.leading, FBSpacing.s)
            .padding(.trailing, FBSpacing.m)
            .padding(.vertical, FBSpacing.s)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .gameBuildCard()
        .accessibilityElement(children: .combine)
        .accessibilityHint(isExpanded ? "Hides each one" : "Shows each one")
    }

    private var subtitle: String {
        if isExpanded { return "Tap one to open it" }
        return builds.map(\.title).joined(separator: " · ")
    }

    /// "2 games building", or "1 ready · 1 building".
    static func headline(for builds: [GameBuild]) -> String {
        let building = builds.filter { $0.status == .building }.count
        let ready = builds.filter { $0.status == .ready }.count
        let failed = builds.filter { $0.status == .failed }.count
        if building == builds.count {
            return "\(building) \(ProductName.plural) building"
        }
        if ready == builds.count {
            return "\(ready) \(ProductName.plural) ready"
        }
        var parts: [String] = []
        if ready > 0 { parts.append("\(ready) ready") }
        if building > 0 { parts.append("\(building) building") }
        if failed > 0 { parts.append("\(failed) didn't work") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Pieces

/// The leading circle: a progress ring while building, the poster when ready, a warning on failure.
private struct GameBuildBadge: View {
    let build: GameBuild

    private let size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(GameColor.wash)
            switch build.status {
            case .building:
                Circle()
                    .stroke(GameColor.skeleton, lineWidth: 3)
                Circle()
                    .trim(from: 0, to: max(0.04, min(build.progress, 1)))
                    .stroke(GameColor.accentGradient, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.4), value: build.progress)
                Image(systemName: "sparkles")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(GameColor.deep)
                    .symbolEffect(.pulse, options: .repeating)
            case .ready:
                poster
                    .clipShape(Circle())
                Circle().strokeBorder(GameColor.accentGradient, lineWidth: 2)
            case .failed:
                Image(systemName: "exclamationmark")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(FBColor.notificationRed)
            }
        }
        .frame(width: size, height: size)
        .background(Circle().fill(FBColor.elevated).padding(-2))
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var poster: some View {
        if build.poster != nil || build.posterURL != nil {
            RemoteImage(url: build.posterURL, data: build.poster)
        } else {
            ZStack {
                GameColor.gradient
                Image(systemName: "gamecontroller.fill")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(GameColor.ink)
            }
        }
    }
}

/// "Play" and "Try again": a small filled capsule in the accent gradient.
private struct GameBuildActionButton: View {
    let title: String
    let symbol: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: FBSpacing.xs) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: FBIconSize.xs, weight: .bold))
                }
                Text(title)
                    .font(.fbButton)
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, FBSpacing.m)
            .frame(height: 32)
            .background(GameColor.accentGradient, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
    }
}

private extension View {
    /// The floating card the pills sit on.
    func gameBuildCard() -> some View {
        background {
            RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                .fill(FBColor.elevated)
                .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
        }
        .overlay {
            RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                .strokeBorder(FBColor.divider, lineWidth: 0.5)
        }
    }
}

#Preview {
    VStack {
        Spacer()
        GameBuildPill(
            build: GameBuild(id: UUID(), request: "A pancake rush game", title: "Pancake rush",
                             stepText: "Muse is playtesting…", progress: 0.7, startedAt: Date(), isMinimized: true),
            actions: .init(open: { _ in }, retry: { _ in }, dismiss: { _ in })
        )
        .padding(.horizontal, FBSpacing.s)
    }
    .previewEnvironment()
}
