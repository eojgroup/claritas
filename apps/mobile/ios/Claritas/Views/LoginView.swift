import SwiftUI

struct LoginView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signin = "Sign in"
        case signup = "Create account"
        var id: String { rawValue }
    }

    @EnvironmentObject private var model: AppModel
    @State private var mode: Mode = .signin

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 24) {
                    header
                    heroCopy
                    highlightCards
                    loginCard
                    footerPills
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 36)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Color(red: 0.06, green: 0.16, blue: 0.22)).frame(width: 44, height: 44).offset(x: -10)
                Circle().fill(Color(red: 0.12, green: 0.24, blue: 0.32)).frame(width: 44, height: 44).offset(x: 0)
                Circle().fill(Color(red: 0.18, green: 0.33, blue: 0.44)).frame(width: 44, height: 44).offset(x: 10)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("CLARITAS")
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .tracking(4)
                    .foregroundStyle(Color(red: 0.18, green: 0.25, blue: 0.3))
                Text("Secure access gateway")
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.35, green: 0.4, blue: 0.45))
            }
            Spacer()
            if model.authStatus == .checking {
                Text("Checking")
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.7))
                    .clipShape(Capsule())
            }
        }
    }

    private var heroCopy: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Global clarity starts with trusted identity.")
                .font(.system(size: 30, weight: .semibold, design: .serif))
                .foregroundStyle(Color(red: 0.07, green: 0.15, blue: 0.2))
            Text("Sign in with your provider to unlock the Claritas signal desk. No passwords stored, no extra identity sprawl.")
                .font(.body)
                .foregroundStyle(Color(red: 0.36, green: 0.4, blue: 0.45))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var highlightCards: some View {
        VStack(spacing: 12) {
            HighlightCard(title: "Signal desk access", detail: "Monitor global events, weather, and alerts with one secure sign-in.")
            HighlightCard(title: "Session-first security", detail: "Short-lived sessions with explicit scopes and tight redirect control.")
            HighlightCard(title: "Provider neutrality", detail: "Use the identity provider you already trust. No new passwords.")
            HighlightCard(title: "Audit-ready detail", detail: "Traceable access and revocation with every login event captured.")
        }
    }

    private var loginCard: some View {
        VStack(spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Secure access")
                        .font(.caption2)
                        .foregroundStyle(Color(red: 0.45, green: 0.5, blue: 0.54))
                        .textCase(.uppercase)
                        .tracking(3)
                    Text(mode == .signin ? "Sign in to Claritas" : "Create a Claritas account")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color(red: 0.07, green: 0.15, blue: 0.2))
                }
                Spacer()
                Text(model.authStatus == .checking ? "Checking" : "Ready")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color(red: 0.07, green: 0.15, blue: 0.2))
                    .foregroundStyle(Color(red: 0.98, green: 0.96, blue: 0.93))
                    .clipShape(Capsule())
            }

            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if let error = model.authError, !error.isEmpty {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.72, green: 0.2, blue: 0.2))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color(red: 0.98, green: 0.9, blue: 0.9))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            VStack(spacing: 12) {
                ForEach(AuthProviderId.allCases) { provider in
                    let meta = ProviderMeta.meta(for: provider, mode: mode)
                    ProviderButton(
                        provider: provider,
                        title: meta.title,
                        subtitle: meta.subtitle,
                        enabled: providerEnabled(provider),
                        busy: model.authStatus == .checking
                    ) {
                        model.startSignIn(provider: provider)
                    }
                }
            }

            if mode == .signin {
                Text(model.authStatus == .checking
                     ? "Checking for active sessions and configured providers."
                     : "Select a provider to continue. You'll be redirected to complete sign-in.")
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.4, green: 0.45, blue: 0.48))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.white.opacity(0.8))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Text("No passwords stored. Your identity stays with your provider.")
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.42, green: 0.46, blue: 0.5))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.white.opacity(0.8))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            if mode == .signin {
                Button("Create account") { mode = .signup }
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color(red: 0.07, green: 0.15, blue: 0.2))
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            } else {
                Button("Already have access? Sign in.") { mode = .signin }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color(red: 0.12, green: 0.42, blue: 0.4))
            }
        }
        .padding(20)
        .background(Color(.systemBackground).opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(color: Color.black.opacity(0.12), radius: 20, x: 0, y: 12)
    }

    private var footerPills: some View {
        HStack(spacing: 8) {
            ForEach(["SOC 2 controls", "Encrypted sessions", "Geo-aware policies", "24/7 monitoring"], id: \.self) { item in
                Text(item.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.8))
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func providerEnabled(_ id: AuthProviderId) -> Bool {
        if let provider = model.authProviders.first(where: { $0.id == id }) {
            return provider.enabled
        }
        // If provider discovery fails, allow manual sign-in attempts; backend still enforces provider status.
        if model.authProviders.isEmpty, model.authError != nil {
            return true
        }
        return false
    }
}

private struct HighlightCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Color(red: 0.07, green: 0.15, blue: 0.2))
            Text(detail)
                .font(.footnote)
                .foregroundStyle(Color(red: 0.38, green: 0.42, blue: 0.45))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.white.opacity(0.75))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

private struct ProviderMeta {
    let title: String
    let subtitle: String

    static func meta(for provider: AuthProviderId, mode: LoginView.Mode) -> ProviderMeta {
        switch provider {
        case .google:
            return ProviderMeta(title: mode == .signin ? "Continue with Google" : "Sign up with Google",
                                subtitle: "Personal or Workspace accounts")
        case .microsoft:
            return ProviderMeta(title: mode == .signin ? "Continue with Microsoft" : "Sign up with Microsoft",
                                subtitle: "Azure AD or Microsoft 365")
        case .apple:
            return ProviderMeta(title: mode == .signin ? "Continue with Apple" : "Sign up with Apple",
                                subtitle: "Apple ID for iOS and macOS")
        }
    }
}

private struct ProviderButton: View {
    let provider: AuthProviderId
    let title: String
    let subtitle: String
    let enabled: Bool
    let busy: Bool
    let onTap: () -> Void

    private var canUse: Bool { enabled && !busy }

    var body: some View {
        Button(action: { if canUse { onTap() } }) {
            HStack(spacing: 12) {
                ProviderIcon(provider: provider)
                    .opacity(enabled ? 1 : 0.9)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color(red: 0.07, green: 0.15, blue: 0.2).opacity(enabled ? 1 : 0.75))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.5, green: 0.54, blue: 0.58).opacity(enabled ? 1 : 0.8))
                }
                Spacer()
                Text(busy ? "Checking" : enabled ? "Ready" : "Unavailable")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(busy ? Color.gray.opacity(0.2) : (enabled ? Color.green.opacity(0.2) : Color.gray.opacity(0.15)))
                    .foregroundStyle(busy ? Color.gray : (enabled ? Color.green : Color.gray))
                    .clipShape(Capsule())
            }
            .padding(14)
            .background(Color.white.opacity(enabled ? 1 : 0.92))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(enabled ? Color.black.opacity(0.08) : Color.black.opacity(0.06), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!canUse)
    }
}

private struct ProviderIcon: View {
    let provider: AuthProviderId

    var body: some View {
        switch provider {
        case .google:
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.white)
                Circle().strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
                Text("G")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(
                        LinearGradient(colors: [Color(red: 0.26, green: 0.52, blue: 0.96),
                                                Color(red: 0.93, green: 0.33, blue: 0.31),
                                                Color(red: 0.96, green: 0.76, blue: 0.2),
                                                Color(red: 0.18, green: 0.69, blue: 0.37)],
                                       startPoint: .topLeading,
                                       endPoint: .bottomTrailing)
                    )
            }
            .frame(width: 44, height: 44)
            .shadow(color: Color.black.opacity(0.05), radius: 3, x: 0, y: 2)
        case .microsoft:
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.white)
                let square = CGSize(width: 12, height: 12)
                VStack(spacing: 3) {
                    HStack(spacing: 3) {
                        Rectangle().fill(Color(red: 0.95, green: 0.31, blue: 0.13)).frame(width: square.width, height: square.height)
                        Rectangle().fill(Color(red: 0.49, green: 0.73, blue: 0.0)).frame(width: square.width, height: square.height)
                    }
                    HStack(spacing: 3) {
                        Rectangle().fill(Color(red: 0.0, green: 0.64, blue: 0.94)).frame(width: square.width, height: square.height)
                        Rectangle().fill(Color(red: 0.99, green: 0.72, blue: 0.0)).frame(width: square.width, height: square.height)
                    }
                }
            }
            .frame(width: 44, height: 44)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.black.opacity(0.08), lineWidth: 1)
            )
        case .apple:
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color(red: 0.06, green: 0.06, blue: 0.07))
                Image(systemName: "applelogo")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)
            .shadow(color: Color.black.opacity(0.15), radius: 6, x: 0, y: 3)
        }
    }
}
