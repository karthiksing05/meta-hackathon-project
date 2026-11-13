import SwiftUI

/// "Make today's Daily": shown on a Group's games block to the Group's owner only.
struct GroupDailyOwnerRow: View {
    let hasDaily: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.light()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: FBIconSize.medium, weight: .semibold))
                    .foregroundStyle(FBColor.accent)
                    .frame(width: 34, height: 34)
                    .background(FBColor.accent.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(hasDaily ? "Change today's Daily" : "Make today's Daily")
                        .font(.fbName)
                        .foregroundStyle(FBColor.primaryText)
                    Text("Everyone in the Group plays the same game today. Members get a notification.")
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: FBIconSize.small, weight: .semibold))
                    .foregroundStyle(FBColor.secondaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(FBColor.surface)
            .overlay(alignment: .top) { HairlineDivider() }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hasDaily ? "Change today's Daily" : "Make today's Daily")
    }
}

/// Picks one of the Group's games as today's Daily (`POST /v1/groups/{id}/daily`), or opens Studio
/// to make a new one for the Group.
struct GroupDailyPickerSheet: View {
    let group: FBGroup
    let games: [Bubble]

    @Environment(BubbleStore.self) private var bubbleStore
    @Environment(AppStore.self) private var appStore
    @Environment(Router.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var sending: String?
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        dismiss()
                        router.openStudio(StudioLaunch(mode: .create, groupID: group.id))
                    } label: {
                        Label("Make a new game for today", systemImage: "sparkles")
                            .font(.fbName)
                    }
                } footer: {
                    Text("Muse builds it for \(group.name). Once it's made, pick it here.")
                }
                Section("The Group's games") {
                    if games.isEmpty {
                        Text("No games in this Group yet.")
                            .font(.fbBody)
                            .foregroundStyle(FBColor.secondaryText)
                    }
                    ForEach(games) { bubble in
                        Button {
                            pick(bubble)
                        } label: {
                            HStack(spacing: 12) {
                                BubbleCoverView(bubble: bubble)
                                    .frame(width: 44, height: 44)
                                    .clipShape(RoundedRectangle(cornerRadius: FBMetrics.radiusMedium, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(bubble.title)
                                        .font(.fbName)
                                        .foregroundStyle(FBColor.primaryText)
                                        .lineLimit(1)
                                    Text(bubble.rule)
                                        .font(.fbMeta)
                                        .foregroundStyle(FBColor.secondaryText)
                                        .lineLimit(2)
                                }
                                Spacer(minLength: 0)
                                if sending == bubble.id {
                                    ProgressView()
                                } else if bubbleStore.dailyBubble(for: group)?.id == bubble.id {
                                    Text("Today")
                                        .font(.fbCaptionEmphasized)
                                        .foregroundStyle(FBColor.accent)
                                }
                            }
                        }
                        .disabled(sending != nil)
                        .accessibilityLabel("Make \(bubble.title) today's Daily")
                    }
                }
                if let errorText {
                    Section {
                        Text(errorText)
                            .font(.fbMeta)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Today's Daily")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func pick(_ bubble: Bubble) {
        sending = bubble.id
        errorText = nil
        Task { @MainActor in
            do {
                try await bubbleStore.makeDaily(bubble, in: group)
                Haptics.light()
                appStore.showToast("\(bubble.title) is today's Daily. The Group has been told.", symbol: "sun.max.fill")
                dismiss()
            } catch {
                errorText = error.localizedDescription
            }
            sending = nil
        }
    }
}
