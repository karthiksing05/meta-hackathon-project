import PhotosUI
import SwiftUI

/// The bar at the bottom of a chat: tools, the growing "Aa" field, and send or the quick emoji.
struct MessengerComposer: View {
    let conversation: Conversation
    @Binding var draft: String
    @Binding var replyingTo: Message?
    var isFocused: FocusState<Bool>.Binding
    /// Sends `draft` (ChatView handles the reply target and clears the field).
    var onSend: () -> Void

    @Environment(AppStore.self) private var store
    @State private var pickerItem: PhotosPickerItem?
    @State private var showsTools = false
    @State private var showsEmojiStrip = false
    @State private var quickEmojiScale: CGFloat = 1

    var body: some View {
        VStack(spacing: 0) {
            if let reply = replyingTo {
                replyBanner(reply)
            }
            if showsEmojiStrip {
                emojiStrip
            }
            HStack(alignment: .bottom, spacing: 10) {
                tools
                field
                trailingButton
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(FBColor.surface)
        .animation(.easeOut(duration: 0.18), value: hasText)
        .animation(.easeOut(duration: 0.2), value: replyingTo?.id)
        .animation(.easeOut(duration: 0.2), value: showsEmojiStrip)
        .animation(.easeOut(duration: 0.18), value: showsTools)
        .onChange(of: hasText) { _, newValue in
            if newValue {
                showsTools = false
            }
        }
        .onChange(of: pickerItem) { _, item in
            loadPicked(item)
        }
    }

    private var hasText: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Tools

    @ViewBuilder
    private var tools: some View {
        if hasText && !showsTools {
            toolButton("chevron.right", label: "Show actions") {
                showsTools = true
            }
        } else {
            HStack(spacing: 14) {
                toolButton("plus.circle.fill", label: "More actions") {
                    store.showToast("Location, polls and more are coming soon", symbol: "plus.circle.fill")
                }
                toolButton("camera.fill", label: "Camera") {
                    store.showToast("The camera isn't available in this demo", symbol: "camera.fill")
                }
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    toolIcon("photo.fill")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Send a photo")
                toolButton("mic.fill", label: "Voice clip") {
                    store.showToast("Voice clips aren't available in this demo", symbol: "mic.fill")
                }
            }
        }
    }

    private func toolButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            toolIcon(symbol)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func toolIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: FBIconSize.xl, weight: .semibold))
            .foregroundStyle(conversation.themeColor)
            .frame(width: 26, height: 36)
            .contentShape(Rectangle())
    }

    // MARK: Field

    private var field: some View {
        HStack(alignment: .bottom, spacing: 6) {
            TextField("Aa", text: $draft, axis: .vertical)
                .font(.fbBodyLarge)
                .lineLimit(1...5)
                .focused(isFocused)
                .padding(.vertical, 8)
            Button {
                showsEmojiStrip.toggle()
                Haptics.selection()
            } label: {
                Image(systemName: "face.smiling")
                    .font(.system(size: FBIconSize.large, weight: .medium))
                    .foregroundStyle(conversation.themeColor)
                    .frame(width: 28, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showsEmojiStrip ? "Hide emoji" : "Show emoji")
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusXL, style: .continuous))
    }

    // MARK: Send / quick emoji

    @ViewBuilder
    private var trailingButton: some View {
        if hasText {
            Button {
                onSend()
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: FBIconSize.xl))
                    .foregroundStyle(conversation.themeColor)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send")
            .transition(.scale.combined(with: .opacity))
        } else {
            Button {
                sendQuickEmoji()
            } label: {
                Text(conversation.quickEmoji)
                    .font(.system(size: 26)) // Display text
                    .scaleEffect(quickEmojiScale)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send \(conversation.quickEmoji)")
            .transition(.scale.combined(with: .opacity))
        }
    }

    private func sendQuickEmoji() {
        store.sendQuickEmoji(in: conversation)
        Haptics.light()
        withAnimation(.spring(response: 0.18, dampingFraction: 0.5)) {
            quickEmojiScale = 1.45
        }
        Task {
            try? await Task.sleep(nanoseconds: 160_000_000)
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                quickEmojiScale = 1
            }
        }
    }

    // MARK: Reply banner

    private func replyBanner(_ reply: Message) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(replyTitle(for: reply))
                    .font(.fbName)
                    .foregroundStyle(FBColor.primaryText)
                Text(replyPreview(for: reply))
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                replyingTo = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: FBIconSize.small, weight: .bold))
                    .foregroundStyle(FBColor.secondaryText)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel reply")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 2)
        .overlay(alignment: .top) {
            HairlineDivider()
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func replyTitle(for reply: Message) -> String {
        if reply.senderID == store.me.id { return "Replying to yourself" }
        let name = store.messengerSender(of: reply, in: conversation)?.firstName ?? "message"
        return "Replying to \(name)"
    }

    private func replyPreview(for reply: Message) -> String {
        if let text = reply.text { return text }
        if reply.isImage { return "Photo" }
        return reply.bigEmoji ?? ""
    }

    // MARK: Emoji strip

    private var emojiStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(MessengerStyle.composerEmojis, id: \.self) { emoji in
                    Button {
                        draft += emoji
                        Haptics.selection()
                    } label: {
                        Text(emoji)
                            .font(.system(size: 28)) // Display text
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(.pressable)
                    .accessibilityLabel("Insert \(emoji)")
                }
            }
            .padding(.horizontal, 10)
        }
        .padding(.vertical, 4)
        .overlay(alignment: .top) {
            HairlineDivider()
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: Photos

    private func loadPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self) {
                store.sendImage(data, in: conversation)
                Haptics.light()
            } else {
                store.showToast("Couldn't load that photo", symbol: "exclamationmark.triangle.fill")
            }
            pickerItem = nil
        }
    }
}
