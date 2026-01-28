import SwiftUI

private enum AuthMode: String, CaseIterable, Identifiable {
    case signIn
    case signUp

    var id: String { rawValue }

    var title: String {
        switch self {
        case .signIn:
            return "Sign in"
        case .signUp:
            return "Create account"
        }
    }

    var heading: String {
        switch self {
        case .signIn:
            return "Sign in to Claritas"
        case .signUp:
            return "Create your Claritas account"
        }
    }

    var message: String {
        switch self {
        case .signIn:
            return "Use your trusted provider to access the Claritas signal desk."
        case .signUp:
            return "Create your Claritas profile in seconds with a trusted provider."
        }
    }

    func buttonLabel(for provider: AuthProvider) -> String {
        switch self {
        case .signIn:
            return "Continue with \(provider.displayName)"
        case .signUp:
            return "Sign up with \(provider.displayName)"
        }
    }
}

struct LoginView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @State private var mode: AuthMode = .signIn

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    Text(mode.heading)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.primary)

                    Text(mode.message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Picker("Auth mode", selection: $mode) {
                        ForEach(AuthMode.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)

                    if let error = auth.errorMessage {
                        Text(error)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(spacing: 12) {
                        ForEach(AuthProvider.allCases) { provider in
                            ProviderButton(
                                provider: provider,
                                label: mode.buttonLabel(for: provider),
                                helper: provider.helperText,
                                enabled: auth.providerStates[provider] ?? false,
                                busy: auth.isAuthenticating,
                                action: { auth.startProviderAuth(provider) }
                            )
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Self-service access")
                            .font(.footnote.weight(.semibold))
                        Text("No passwords stored. Your identity stays with your provider.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.claritasCardBorder, lineWidth: 1)
                    )

                    if auth.isAuthenticating {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Opening provider...")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding()
            }
            .background(
                LinearGradient(
                    colors: [Color.claritasBackground, Color.white],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            )
            .navigationBarHidden(true)
            .onAppear {
                auth.refreshProviders()
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.claritasBrand)
                    .frame(width: 44, height: 44)
                Text("C")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("CLARITAS")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.primary)
                    .tracking(2)
                Text("Secure access gateway")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

private struct ProviderButton: View {
    let provider: AuthProvider
    let label: String
    let helper: String
    let enabled: Bool
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ProviderIcon(provider: provider)

                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(enabled ? .primary : .secondary)
                    Text(helper)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(busy ? "Checking" : enabled ? "Ready" : "Disabled")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(busy ? Color.gray.opacity(0.2) : enabled ? Color.green.opacity(0.15) : Color.gray.opacity(0.2))
                    .foregroundStyle(enabled ? Color.green : Color.secondary)
                    .clipShape(Capsule())
            }
            .padding(12)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.claritasCardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!enabled || busy)
        .opacity(enabled ? 1 : 0.6)
    }
}

private struct ProviderIcon: View {
    let provider: AuthProvider

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white)
                .frame(width: 40, height: 40)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.black.opacity(0.05), lineWidth: 1)
                )

            switch provider {
            case .google:
                Circle()
                    .fill(
                        AngularGradient(
                            gradient: Gradient(colors: [
                                Color(red: 0.26, green: 0.52, blue: 0.96),
                                Color(red: 0.21, green: 0.65, blue: 0.32),
                                Color(red: 0.98, green: 0.74, blue: 0.02),
                                Color(red: 0.92, green: 0.26, blue: 0.21),
                                Color(red: 0.26, green: 0.52, blue: 0.96)
                            ]),
                            center: .center
                        )
                    )
                    .frame(width: 20, height: 20)
            case .microsoft:
                VStack(spacing: 2) {
                    HStack(spacing: 2) {
                        Color(red: 0.95, green: 0.31, blue: 0.13)
                        Color(red: 0.50, green: 0.73, blue: 0.00)
                    }
                    HStack(spacing: 2) {
                        Color(red: 0.00, green: 0.64, blue: 0.94)
                        Color(red: 1.00, green: 0.73, blue: 0.00)
                    }
                }
                .frame(width: 20, height: 20)
            case .apple:
                Image(systemName: "apple.logo")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.black)
            }
        }
    }
}

#Preview {
    LoginView()
        .environmentObject(AuthViewModel())
}
