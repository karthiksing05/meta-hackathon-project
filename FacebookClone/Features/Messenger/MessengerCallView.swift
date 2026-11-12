import SwiftUI

/// A simulated audio or video call. "Calling..." for about two seconds, then "Connected"
/// with a running timer. Presented as a full-screen cover from ChatView.
struct MessengerCallView: View {
    let conversation: Conversation
    let isVideo: Bool

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var isConnected = false
    @State private var elapsed = 0
    @State private var isMuted = false
    @State private var isSpeakerOn = false
    @State private var isCameraOn: Bool
    @State private var pulse = false

    init(conversation: Conversation, isVideo: Bool = false) {
        self.conversation = conversation
        self.isVideo = isVideo
        _isCameraOn = State(initialValue: isVideo)
    }

    var body: some View {
        ZStack {
            background
            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                callerInfo
                Spacer(minLength: 0)
                controls
            }
            if isCameraOn {
                selfPreview
                    .transition(.scale(scale: 0.8, anchor: .topTrailing).combined(with: .opacity))
            }
        }
        .environment(\.colorScheme, .dark)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isCameraOn)
        .animation(.easeInOut(duration: 0.4), value: isConnected)
        .task {
            await runCall()
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                pulse = true
            }
        }
    }

    /// The caller's "camera" fills the screen once a video call connects.
    private var showsRemoteVideo: Bool {
        isVideo && isConnected
    }

    // MARK: Background

    private var background: some View {
        ZStack {
            Color.black
            if let user = conversation.primaryUser {
                AvatarView.color(for: user.id)
                    .opacity(0.55)
                RemoteImage(url: user.avatarURL, data: user.avatarData, placeholder: .clear)
                    .blur(radius: showsRemoteVideo ? 0 : 40)
                    .scaleEffect(showsRemoteVideo ? 1 : 1.3)
                    .opacity(showsRemoteVideo ? 1 : 0.8)
            }
            LinearGradient(
                colors: [Color.black.opacity(0.35), Color.black.opacity(0.1), Color.black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack {
            Button {
                endCall()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.15), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Leave call")
            Spacer()
            Label("End-to-end encrypted", systemImage: "lock.fill")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.75))
            Spacer()
            Color.clear
                .frame(width: 40, height: 40)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: Caller

    private var callerInfo: some View {
        VStack(spacing: 14) {
            if !showsRemoteVideo {
                ZStack {
                    if !isConnected {
                        Circle()
                            .stroke(Color.white.opacity(0.4), lineWidth: 2)
                            .frame(width: 150, height: 150)
                            .scaleEffect(pulse ? 1.3 : 0.9)
                            .opacity(pulse ? 0 : 1)
                    }
                    MessengerConversationAvatar(conversation: conversation, size: 120, showsOnline: false)
                }
                .frame(height: 170)
                .transition(.scale.combined(with: .opacity))
            }
            Text(conversation.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text(isConnected ? "Connected" : callingText)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.8))
            if isConnected {
                Text(MessengerFormat.callDuration(elapsed))
                    .font(.system(size: 18, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
            }
        }
        .padding(.horizontal, 24)
        .shadow(color: Color.black.opacity(0.3), radius: 6, y: 2)
    }

    private var callingText: String {
        isVideo ? "Video calling..." : "Calling..."
    }

    // MARK: Self preview

    private var selfPreview: some View {
        VStack {
            HStack {
                Spacer()
                ZStack {
                    LinearGradient(
                        colors: [Color(hex: 0x4B4C4F), Color(hex: 0x1C1D1F)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    AvatarView(user: store.me, size: 56)
                    VStack {
                        Spacer()
                        Text("You")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.bottom, 8)
                    }
                }
                .frame(width: 104, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.25), lineWidth: 1)
                }
                .shadow(color: Color.black.opacity(0.35), radius: 8, y: 3)
            }
            Spacer()
        }
        .padding(.top, 64)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Your camera preview")
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 18) {
            controlButton(
                symbol: isSpeakerOn ? "speaker.wave.3.fill" : "speaker.wave.2.fill",
                label: isSpeakerOn ? "Speaker on" : "Speaker off",
                isActive: isSpeakerOn
            ) {
                isSpeakerOn.toggle()
            }
            controlButton(
                symbol: isCameraOn ? "video.fill" : "video.slash.fill",
                label: isCameraOn ? "Turn camera off" : "Turn camera on",
                isActive: isCameraOn
            ) {
                isCameraOn.toggle()
            }
            controlButton(
                symbol: isMuted ? "mic.slash.fill" : "mic.fill",
                label: isMuted ? "Unmute" : "Mute",
                isActive: isMuted
            ) {
                isMuted.toggle()
            }
            Button {
                endCall()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(FBColor.notificationRed, in: Circle())
            }
            .buttonStyle(.pressable)
            .accessibilityLabel("End call")
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 18)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.bottom, 28)
    }

    private func controlButton(symbol: String, label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(isActive ? Color.black : Color.white)
                .frame(width: 54, height: 54)
                .background(isActive ? Color.white : Color.white.opacity(0.18), in: Circle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel(label)
    }

    // MARK: Call flow

    private func runCall() async {
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        guard !Task.isCancelled else { return }
        isConnected = true
        Haptics.success()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { break }
            withAnimation {
                elapsed += 1
            }
        }
    }

    private func endCall() {
        Haptics.medium()
        if isConnected {
            store.showToast("Call ended · \(MessengerFormat.callDuration(elapsed))", symbol: "phone.down.fill")
        } else {
            store.showToast("Call canceled", symbol: "phone.down.fill")
        }
        dismiss()
    }
}
