import SwiftUI

struct LoginView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signin = "Sign in"
        case signup = "Create account"

        var id: String { rawValue }
    }

    @EnvironmentObject private var model: AppModel
    @State private var mode: Mode = .signin
    @State private var showMethods: Bool = false

    private var isChecking: Bool {
        model.authStatus == .checking
    }

    private var enabledProviders: [AuthProviderId] {
        AuthProviderId.allCases.filter { providerEnabled($0) }
    }

    private var allProvidersReportedDisabled: Bool {
        guard !model.authProviders.isEmpty else { return false }
        return model.authProviders.allSatisfy { !$0.enabled }
    }

    private var primaryProvider: AuthProviderId? {
        guard !isChecking, enabledProviders.count == 1 else { return nil }
        return enabledProviders[0]
    }

    private var primaryDisabled: Bool {
        isChecking || enabledProviders.isEmpty
    }

    private var primaryLabel: String {
        mode == .signin ? "Continue to Claritas" : "Create Claritas account"
    }

    private var statusLabel: String {
        if isChecking { return "Checking" }
        if enabledProviders.isEmpty { return "Unavailable" }
        return "Ready"
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.darkBlue,
                    ClaritasPalette.darkBlue.opacity(0.88)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(ClaritasPalette.brown.opacity(0.25))
                .frame(width: 340, height: 340)
                .blur(radius: 28)
                .offset(x: -140, y: -250)

            Circle()
                .fill(ClaritasPalette.darkGreen.opacity(0.24))
                .frame(width: 300, height: 300)
                .blur(radius: 24)
                .offset(x: 160, y: 260)

            ScrollView {
                VStack(spacing: 18) {
                    loginCard
                    footerPills
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 24)
            }
        }
    }

    private var loginCard: some View {
        VStack(spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Secure access")
                        .font(.caption2.weight(.semibold))
                        .tracking(2.4)
                        .textCase(.uppercase)
                        .foregroundStyle(ClaritasPalette.beige)

                    Text(mode == .signin ? "Sign in to Claritas" : "Create a Claritas account")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.offWhite)
                }

                Spacer()

                Text(statusLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(statusBadgeBackground)
                    .foregroundStyle(statusBadgeForeground)
                    .clipShape(Capsule())
            }

            modeSwitcher

            if let error = model.authError, !error.isEmpty {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Color(red: 0.96, green: 0.72, blue: 0.73))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color(red: 0.42, green: 0.14, blue: 0.18).opacity(0.55))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(red: 0.73, green: 0.27, blue: 0.30).opacity(0.55), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            Text(mode == .signin
                 ? "Use your trusted identity provider to access the Claritas signal desk."
                 : "Create your Claritas account using the provider you already trust.")
                .font(.footnote)
                .foregroundStyle(ClaritasPalette.beige.opacity(0.9))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(ClaritasPalette.darkBlue.opacity(0.86))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))

            Button(action: handlePrimaryAction) {
                Text(primaryLabel)
                    .font(.footnote.weight(.semibold))
                    .tracking(1.7)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(primaryDisabled ? ClaritasPalette.grey.opacity(0.85) : ClaritasPalette.offWhite)
            .background(primaryDisabled ? ClaritasPalette.grey.opacity(0.55) : ClaritasPalette.darkGreen)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .disabled(primaryDisabled)

            if enabledProviders.isEmpty && !isChecking {
                Text("No providers are enabled yet. Configure an identity provider to continue.")
                    .font(.footnote)
                    .foregroundStyle(ClaritasPalette.beige.opacity(0.9))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(ClaritasPalette.darkBlue.opacity(0.86))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            if enabledProviders.count > 1 {
                Button(action: { showMethods.toggle() }) {
                    Text(showMethods ? "Hide other methods" : "Other methods")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.beige)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if showMethods {
                VStack(spacing: 10) {
                    ForEach(AuthProviderId.allCases) { provider in
                        let meta = ProviderMeta.meta(for: provider, mode: mode)
                        ProviderButton(
                            provider: provider,
                            title: meta.title,
                            subtitle: meta.subtitle,
                            enabled: providerEnabled(provider),
                            busy: isChecking
                        ) {
                            model.startSignIn(provider: provider)
                        }
                    }
                }
            }

            if mode == .signin {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No account yet?")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.offWhite)
                    Text("Create your account in seconds with a provider.")
                        .font(.footnote)
                        .foregroundStyle(ClaritasPalette.beige.opacity(0.9))

                    Button("Create account") {
                        handleModeChange(.signup)
                    }
                    .font(.caption.weight(.semibold))
                    .tracking(1.5)
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .foregroundStyle(ClaritasPalette.offWhite)
                    .background(ClaritasPalette.brown)
                    .clipShape(Capsule())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(ClaritasPalette.darkBlue.opacity(0.86))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Text("Already have access? Sign in.")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.beige)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onTapGesture {
                        handleModeChange(.signin)
                    }
            }
        }
        .padding(18)
        .background(ClaritasPalette.darkBlue.opacity(0.95))
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .shadow(color: Color.black.opacity(0.35), radius: 24, x: 0, y: 16)
    }

    private var modeSwitcher: some View {
        HStack(spacing: 8) {
            modeButton(.signin)
            modeButton(.signup)
        }
        .padding(6)
        .background(ClaritasPalette.darkBlue.opacity(0.86))
        .overlay(
            RoundedRectangle(cornerRadius: 999)
                .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
        )
        .clipShape(Capsule())
    }

    private func modeButton(_ target: Mode) -> some View {
        Button(action: { handleModeChange(target) }) {
            Text(target.rawValue)
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .foregroundStyle(mode == target ? ClaritasPalette.offWhite : ClaritasPalette.beige.opacity(0.85))
                .background(mode == target ? ClaritasPalette.darkGreen : Color.clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var footerPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(["SOC 2 controls", "Encrypted sessions", "Geo-aware policies", "24/7 monitoring"], id: \.self) { item in
                    Text(item.uppercased())
                        .font(.caption2.weight(.semibold))
                        .tracking(2)
                        .foregroundStyle(ClaritasPalette.beige.opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(ClaritasPalette.darkBlue.opacity(0.92))
                        .overlay(
                            RoundedRectangle(cornerRadius: 999)
                                .stroke(ClaritasPalette.beige.opacity(0.45), lineWidth: 1)
                        )
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusBadgeBackground: Color {
        if isChecking {
            return Color(red: 0.18, green: 0.23, blue: 0.28)
        }
        if enabledProviders.isEmpty {
            return Color(red: 0.24, green: 0.15, blue: 0.17)
        }
        return Color(red: 0.05, green: 0.32, blue: 0.27)
    }

    private var statusBadgeForeground: Color {
        if isChecking {
            return Color(red: 0.76, green: 0.79, blue: 0.83)
        }
        if enabledProviders.isEmpty {
            return Color(red: 0.93, green: 0.75, blue: 0.76)
        }
        return Color(red: 0.72, green: 0.90, blue: 0.80)
    }

    private func handleModeChange(_ nextMode: Mode) {
        mode = nextMode
        if nextMode == .signup {
            showMethods = true
        }
    }

    private func handlePrimaryAction() {
        if let primaryProvider {
            model.startSignIn(provider: primaryProvider)
            return
        }
        showMethods = true
    }

    private func providerEnabled(_ id: AuthProviderId) -> Bool {
        if let provider = model.authProviders.first(where: { $0.id == id }) {
            if provider.enabled {
                return true
            }
            if allProvidersReportedDisabled {
                // Keep sign-in tappable when backend/provider state is inconsistent.
                return true
            }
            return false
        }
        if model.authProviders.isEmpty, model.authError != nil {
            return true
        }
        return false
    }
}

private struct ProviderMeta {
    let title: String
    let subtitle: String

    static func meta(for provider: AuthProviderId, mode: LoginView.Mode) -> ProviderMeta {
        switch provider {
        case .google:
            return ProviderMeta(
                title: mode == .signin ? "Continue with Google" : "Sign up with Google",
                subtitle: "Personal or Workspace accounts"
            )
        case .microsoft:
            return ProviderMeta(
                title: mode == .signin ? "Continue with Microsoft" : "Sign up with Microsoft",
                subtitle: "Azure AD or Microsoft 365"
            )
        case .apple:
            return ProviderMeta(
                title: mode == .signin ? "Continue with Apple" : "Sign up with Apple",
                subtitle: "Apple ID for iOS and macOS"
            )
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

    private var badgeLabel: String {
        if busy { return "Checking" }
        return enabled ? "Ready" : "Unavailable"
    }

    private var badgeBackground: Color {
        if busy { return Color(red: 0.18, green: 0.23, blue: 0.28) }
        return enabled ? Color(red: 0.05, green: 0.32, blue: 0.27) : Color(red: 0.22, green: 0.24, blue: 0.28)
    }

    private var badgeForeground: Color {
        if busy { return Color(red: 0.76, green: 0.79, blue: 0.83) }
        return enabled ? Color(red: 0.72, green: 0.90, blue: 0.80) : Color(red: 0.66, green: 0.70, blue: 0.75)
    }

    var body: some View {
        Button(action: { if canUse { onTap() } }) {
            HStack(spacing: 12) {
                ProviderIcon(provider: provider)
                    .opacity(enabled ? 1 : 0.75)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(enabled ? Color(red: 0.86, green: 0.91, blue: 0.95) : Color(red: 0.66, green: 0.70, blue: 0.75))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.56, green: 0.64, blue: 0.70))
                }

                Spacer()

                Text(badgeLabel)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(badgeBackground)
                    .foregroundStyle(badgeForeground)
                    .clipShape(Capsule())
            }
            .padding(14)
            .background(Color(red: 0.05, green: 0.10, blue: 0.15).opacity(enabled ? 1 : 0.92))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color(red: 0.16, green: 0.25, blue: 0.33), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
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
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white)
                Circle()
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
                Text("G")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color(red: 0.26, green: 0.52, blue: 0.96),
                                Color(red: 0.93, green: 0.33, blue: 0.31),
                                Color(red: 0.96, green: 0.76, blue: 0.20),
                                Color(red: 0.18, green: 0.69, blue: 0.37)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
            .frame(width: 44, height: 44)
            .shadow(color: Color.black.opacity(0.05), radius: 3, x: 0, y: 2)

        case .microsoft:
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white)

                let square = CGSize(width: 12, height: 12)
                VStack(spacing: 3) {
                    HStack(spacing: 3) {
                        Rectangle()
                            .fill(Color(red: 0.95, green: 0.31, blue: 0.13))
                            .frame(width: square.width, height: square.height)
                        Rectangle()
                            .fill(Color(red: 0.49, green: 0.73, blue: 0.00))
                            .frame(width: square.width, height: square.height)
                    }
                    HStack(spacing: 3) {
                        Rectangle()
                            .fill(Color(red: 0.00, green: 0.64, blue: 0.94))
                            .frame(width: square.width, height: square.height)
                        Rectangle()
                            .fill(Color(red: 0.99, green: 0.72, blue: 0.00))
                            .frame(width: square.width, height: square.height)
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
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(red: 0.06, green: 0.06, blue: 0.07))
                Image(systemName: "applelogo")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)
            .shadow(color: Color.black.opacity(0.15), radius: 6, x: 0, y: 3)
        }
    }
}
