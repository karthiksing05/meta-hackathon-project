import SwiftUI
import UIKit

/// What the user asked to play: a game, with a fixed seed when answering a challenge.
struct SGPlayRequest: Identifiable {
    let id = UUID()
    let game: SGGame
    var seed: Int = SGConfig.randomSeed()
    var challengeID: String? = nil
}

/// Full-screen play session: the player, then the result once the game ends.
struct SGPlayFlowView: View {
    let request: SGPlayRequest
    @Environment(\.dismiss) private var dismiss

    @State private var attempt = 0
    @State private var seed: Int
    @State private var challengeID: String?
    @State private var result: SGPlayResult?
    @State private var response: SGPlayResponse?
    @State private var isSubmitting = false
    @State private var submitError: String?

    init(request: SGPlayRequest) {
        self.request = request
        _seed = State(initialValue: request.seed)
        _challengeID = State(initialValue: request.challengeID)
    }

    var body: some View {
        ZStack {
            if let result {
                SGResultView(
                    game: request.game,
                    result: result,
                    response: response,
                    isSubmitting: isSubmitting,
                    submitError: submitError,
                    onPlayAgain: playAgain,
                    onDone: { dismiss() }
                )
                .transition(.opacity)
            } else {
                SGPlayerSurface(gameID: request.game.id, seed: seed, challengeID: challengeID) { finished in
                    finish(finished)
                }
                .id(attempt)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .topLeading) {
                    CircleButton(accessibilityLabel: "Close", action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: FBIconSize.regular, weight: .semibold))
                            .foregroundStyle(FBColor.primaryText)
                    }
                    .padding(FBMetrics.screenPadding)
                }
            }
        }
        .background(FBColor.darkCanvas.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.2), value: result == nil)
    }

    private func finish(_ finished: SGPlayResult) {
        guard result == nil else { return }
        result = finished
        response = nil
        submitError = nil
        isSubmitting = true
        let gameID = request.game.id
        let challenge = challengeID
        Task {
            do {
                response = try await ScrollGamesAPI.shared.submitPlay(gameID: gameID, result: finished, challengeID: challenge)
            } catch {
                submitError = error.localizedDescription
            }
            isSubmitting = false
        }
    }

    private func playAgain() {
        result = nil
        response = nil
        submitError = nil
        challengeID = nil
        seed = SGConfig.randomSeed()
        attempt += 1
    }
}

struct SGResultView: View {
    let game: SGGame
    let result: SGPlayResult
    let response: SGPlayResponse?
    let isSubmitting: Bool
    let submitError: String?
    let onPlayAgain: () -> Void
    let onDone: () -> Void

    @Environment(AppStore.self) private var store
    @State private var isChallenging = false
    @State private var shareItems: [Any]?
    @State private var challengePosted = false
    @State private var challengeError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: FBSpacing.l) {
                scoreCard
                if let beat = response?.beat {
                    beatLine(beat)
                }
                if let submitError {
                    Label("Score not saved: \(submitError)", systemImage: "exclamationmark.triangle")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .multilineTextAlignment(.center)
                }
                actions
            }
            .padding(FBMetrics.screenPadding)
            .padding(.top, FBSpacing.xl)
        }
        .background(FBColor.background.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            ToastHost().padding(.bottom, 24)
        }
        .sheet(isPresented: Binding(get: { shareItems != nil }, set: { if !$0 { shareItems = nil } })) {
            SGActivityView(items: shareItems ?? [])
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private var scoreCard: some View {
        VStack(spacing: FBSpacing.m) {
            Text(game.emoji)
                .font(.system(size: 44)) // Display emoji
            Text(game.title)
                .font(.fbHeadline)
                .foregroundStyle(.white)
            Text("\(result.score)")
                .font(.system(size: 72, weight: .bold)) // Display score
                .foregroundStyle(.white)
                .contentTransition(.numericText())
            HStack(spacing: FBSpacing.xl) {
                stat("\(result.correct)", "correct")
                stat("\(result.bestStreak)", "best streak")
                if let rank = response?.rank {
                    stat("#\(rank)", "rank")
                }
            }
            verifiedBadge
        }
        .frame(maxWidth: .infinity)
        .padding(FBSpacing.xl)
        .background(
            SGPalette.gradient(for: game.palette),
            in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
        )
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.fbTitle)
                .foregroundStyle(.white)
            Text(label)
                .font(.fbCaption)
                .foregroundStyle(.white.opacity(0.85))
        }
    }

    @ViewBuilder
    private var verifiedBadge: some View {
        if isSubmitting {
            Label("Verifying score...", systemImage: "hourglass")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(.white.opacity(0.85))
        } else if response?.verified == true {
            Label("Verified by server replay", systemImage: "checkmark.seal.fill")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.black.opacity(0.25), in: Capsule())
        } else if response != nil {
            Label("Not verified", systemImage: "exclamationmark.circle")
                .font(.fbCaptionEmphasized)
                .foregroundStyle(.white.opacity(0.85))
        }
    }

    private func beatLine(_ beat: SGBeat) -> some View {
        Text(beat.won
            ? "You beat \(beat.user)'s \(beat.score)!"
            : "\(beat.user) still has you beat with \(beat.score).")
            .font(.fbHeadline)
            .foregroundStyle(beat.won ? FBColor.online : FBColor.primaryText)
            .multilineTextAlignment(.center)
    }

    private var actions: some View {
        VStack(spacing: FBSpacing.s) {
            Button {
                challengeFriends()
            } label: {
                if isChallenging {
                    ProgressView().tint(.white)
                } else {
                    Label(challengePosted ? "Challenge sent" : "Challenge friends", systemImage: "paperplane.fill")
                }
            }
            .buttonStyle(.fb(.primary, height: 44))
            .disabled(isChallenging || response?.play?.id == nil)

            if challengePosted {
                Label("Posted to the feed", systemImage: "checkmark.circle.fill")
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.online)
            }
            if let challengeError {
                Text(challengeError)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.notificationRed)
            }

            Button("Play again", action: onPlayAgain)
                .buttonStyle(.fb(.secondary, height: 44))
            Button("Done", action: onDone)
                .buttonStyle(.fb(.outline, height: 44))
        }
    }

    private func challengeFriends() {
        guard let playID = response?.play?.id, !isChallenging else { return }
        isChallenging = true
        challengeError = nil
        Task {
            defer { isChallenging = false }
            do {
                let created = try await ScrollGamesAPI.shared.createChallenge(gameID: game.id, playID: playID)
                var items: [Any] = []
                if let text = created.text { items.append(text) }
                if let url = created.url.flatMap(URL.init(string:)) { items.append(url) }
                Haptics.success()
                challengePosted = true
                store.showToast("Challenge posted to the feed", symbol: "checkmark.circle.fill")
                if !items.isEmpty { shareItems = items }
            } catch {
                challengeError = "Couldn't create the challenge: \(error.localizedDescription)"
            }
        }
    }
}

/// The system share sheet.
struct SGActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
