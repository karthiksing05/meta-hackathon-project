import SwiftUI

/// "Pick up where you left off?" over the game when it was closed mid-run: the score so far, how
/// long ago, and the friend to beat. Resume fast-forwards the saved run; Start over drops it.
struct ResumePromptCard: View {
    let saved: SavedRun
    let gameTitle: String
    /// The friend just ahead (or the top friend) on this game, to keep the run about someone.
    var rival: (name: String, score: Int)? = nil
    var onResume: () -> Void
    var onStartOver: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isShown = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.35)
                .ignoresSafeArea()
                .accessibilityHidden(true)
            VStack(spacing: FBSpacing.m) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(BubbleGlow.brandGradient)
                    .accessibilityHidden(true)
                VStack(spacing: 4) {
                    Text(ResumeCopy.title)
                        .font(.fbHeadline)
                        .foregroundStyle(FBColor.primaryText)
                        .multilineTextAlignment(.center)
                    Text(ResumeCopy.detail(score: saved.score, seconds: saved.log.durationSec, savedAt: saved.savedAt))
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                    if let rival {
                        Label(ResumeCopy.rival(rival.name, rival.score), systemImage: "person.2.fill")
                            .font(.fbMetaEmphasized)
                            .foregroundStyle(FBColor.accent)
                            .padding(.top, 2)
                    }
                }
                VStack(spacing: FBSpacing.s) {
                    Button {
                        Haptics.light()
                        onResume()
                    } label: {
                        Label(ResumeCopy.resume, systemImage: "play.fill")
                    }
                    .buttonStyle(.fb(.primary, height: 44))
                    .accessibilityHint(ResumeCopy.resumeHint(gameTitle))
                    Button {
                        Haptics.light()
                        onStartOver()
                    } label: {
                        Label(ResumeCopy.startOver, systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.fb(.secondary, height: 44))
                }
                .padding(.top, 4)
            }
            .padding(FBSpacing.l)
            .frame(maxWidth: 340)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.5), lineWidth: 0.75)
            )
            .shadow(color: .black.opacity(0.18), radius: 18, y: 6)
            .padding(.horizontal, 24)
            .scaleEffect(isShown || reduceMotion ? 1 : 0.94)
            .opacity(isShown ? 1 : 0)
            .accessibilityElement(children: .contain)
        }
        .onAppear {
            withAnimation(GameMotion.resolved(GameMotion.appear, reduceMotion: reduceMotion)) {
                isShown = true
            }
        }
    }
}

/// Resume copy, in one place.
enum ResumeCopy {
    static let title = "Pick up where you left off?"
    static let resume = "Resume"
    static let startOver = "Start over"

    static func detail(score: Int, seconds: Double, savedAt: Date) -> String {
        let points = score == 1 ? "1 point" : "\(score.withCommas) points"
        let ago = RelativeDateTimeFormatter().localizedString(for: savedAt, relativeTo: Date())
        return "\(points), \(Int(seconds.rounded())) s in · left \(ago)"
    }

    static func rival(_ name: String, _ score: Int) -> String {
        "\(name)'s best is \(score.withCommas)"
    }

    static func resumeHint(_ title: String) -> String {
        "Continues your run of \(title) from where you closed it"
    }
}
