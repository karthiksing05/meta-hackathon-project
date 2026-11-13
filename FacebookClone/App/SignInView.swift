import SwiftUI

/// Log in, create an account, or continue as a guest, against the games server
/// (`POST /v1/auth/login`, `/register`; `GamesAccount`). Shown when nobody is signed in on this
/// phone, and after "Log out".
struct SignInView: View {
    @Environment(AppStore.self) private var store
    private var account: GamesAccount { GamesAccount.shared }

    private enum Mode { case logIn, signUp }
    private enum Field: Hashable { case name, username, email, password }

    @State private var mode: Mode = .logIn
    @State private var name = ""
    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    var body: some View {
        ScrollView {
            VStack(spacing: FBSpacing.l) {
                FacebookLogo(size: 64)
                    .padding(.top, 56)
                    .padding(.bottom, FBSpacing.l)

                if mode == .signUp {
                    Text("Create a new account")
                        .font(.fbTitle)
                        .foregroundStyle(FBColor.primaryText)
                    field("Full name", text: $name, field: .name, content: .name)
                    field("Username", text: $username, field: .username, content: .username)
                }
                if mode == .logIn {
                    field("Email or username", text: $email, field: .email, content: .username, keyboard: .emailAddress)
                } else {
                    field("Email", text: $email, field: .email, content: .emailAddress, keyboard: .emailAddress)
                }
                secureField

                if let error {
                    Text(error)
                        .font(.fbMeta)
                        .foregroundStyle(FBColor.notificationRed)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("signin.error")
                }

                Button(action: submit) {
                    HStack(spacing: FBSpacing.s) {
                        if busy { ProgressView().tint(.white) }
                        Text(mode == .logIn ? "Log in" : "Sign up")
                    }
                }
                .buttonStyle(.fb(.primary, height: 44))
                .disabled(busy || !canSubmit)
                .opacity(canSubmit ? 1 : 0.6)
                .accessibilityIdentifier("signin.submit")

                if mode == .logIn {
                    divider
                    Button("Create new account") { switchMode(.signUp) }
                        .buttonStyle(.fb(.outline, height: 44))
                        .disabled(busy)
                } else {
                    Button("Already have an account? Log in") { switchMode(.logIn) }
                        .font(.fbMetaEmphasized)
                        .foregroundStyle(FBColor.accent)
                        .disabled(busy)
                }

                Button("Continue without an account", action: guest)
                    .font(.fbMeta)
                    .foregroundStyle(FBColor.secondaryText)
                    .padding(.top, FBSpacing.s)
                    .disabled(busy)
                    .accessibilityIdentifier("signin.guest")

                if case .failed(let message) = account.state {
                    Text(message)
                        .font(.fbCaption)
                        .foregroundStyle(FBColor.tertiaryText)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, FBSpacing.xl)
            .padding(.bottom, FBSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(FBColor.surface.ignoresSafeArea())
        .onSubmit(advance)
    }

    // MARK: Pieces

    private func field(_ title: String, text: Binding<String>, field: Field, content: UITextContentType,
                       keyboard: UIKeyboardType = .default) -> some View {
        TextField(title, text: text)
            .textContentType(content)
            .keyboardType(keyboard)
            .textInputAutocapitalization(field == .name ? .words : .never)
            .autocorrectionDisabled(field != .name)
            .submitLabel(.next)
            .focused($focus, equals: field)
            .modifier(SignInFieldStyle())
            .accessibilityIdentifier("signin.\(field)")
    }

    private var secureField: some View {
        SecureField(mode == .signUp ? "Password (8 or more characters)" : "Password", text: $password)
            .textContentType(mode == .signUp ? .newPassword : .password)
            .submitLabel(.go)
            .focused($focus, equals: .password)
            .modifier(SignInFieldStyle())
            .accessibilityIdentifier("signin.password")
    }

    private var divider: some View {
        HStack(spacing: FBSpacing.m) {
            Rectangle().fill(FBColor.divider).frame(height: 1)
            Text("or").font(.fbMeta).foregroundStyle(FBColor.secondaryText)
            Rectangle().fill(FBColor.divider).frame(height: 1)
        }
        .padding(.vertical, FBSpacing.xs)
    }

    // MARK: Actions

    private var canSubmit: Bool {
        let id = email.trimmingCharacters(in: .whitespaces)
        let base = (mode == .logIn ? id.count >= 3 : id.contains("@")) && password.count >= (mode == .signUp ? 8 : 1)
        guard mode == .signUp else { return base }
        return base && !name.trimmingCharacters(in: .whitespaces).isEmpty && username.trimmingCharacters(in: .whitespaces).count >= 3
    }

    private func advance() {
        switch focus {
        case .name: focus = .username
        case .username: focus = .email
        case .email: focus = .password
        default: if canSubmit { submit() }
        }
    }

    private func switchMode(_ new: Mode) {
        withAnimation(.easeInOut(duration: 0.2)) {
            mode = new
            error = nil
        }
    }

    private func submit() {
        guard canSubmit, !busy else { return }
        run {
            if mode == .logIn {
                try await account.logIn(email: email, password: password)
            } else {
                try await account.signUp(name: name, username: username, email: email, password: password)
            }
        }
    }

    private func guest() {
        run { try await account.continueAsGuest() }
    }

    private func run(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        error = nil
        focus = nil
        Task { @MainActor in
            do {
                try await work()
                Haptics.light()
                password = ""
                store.logIn()
            } catch {
                self.error = error.localizedDescription
                Haptics.warning()
            }
            busy = false
        }
    }
}

private struct SignInFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.fbBodyLarge)
            .foregroundStyle(FBColor.primaryText)
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(FBColor.inputBackground, in: RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: FBMetrics.radiusLarge, style: .continuous)
                    .stroke(FBColor.divider, lineWidth: 1)
            }
    }
}
