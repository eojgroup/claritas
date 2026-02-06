import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("THEME_DARK") private var dark: Bool = false
    @State private var isSigningOut: Bool = false

    private var displayName: String {
        model.authUser?.display_name ?? model.authUser?.email ?? "Signed in"
    }

    private var emailLabel: String {
        model.authUser?.email ?? "Email not provided"
    }

    private var userInitials: String {
        let source = model.authUser?.display_name ?? model.authUser?.email ?? "C"
        let parts = source.split(separator: " ")
        if parts.count >= 2 {
            let first = parts.first?.first.map(String.init) ?? ""
            let last = parts.last?.first.map(String.init) ?? ""
            return (first + last).uppercased()
        }
        return String(source.prefix(1)).uppercased()
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    headerCard
                    accountDetailsCard
                    providerCard
                    preferencesCard
                    sessionCard
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var headerCard: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 20)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.08, green: 0.16, blue: 0.22),
                            Color(red: 0.12, green: 0.2, blue: 0.26)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.white.opacity(0.15))
                            .frame(width: 64, height: 64)
                        Text(userInitials)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Signed in as")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.white.opacity(0.7))
                            .textCase(.uppercase)
                            .tracking(3)
                        Text(displayName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.white)
                        Text(emailLabel)
                            .font(.footnote)
                            .foregroundStyle(Color.white.opacity(0.7))
                    }
                    Spacer()
                }
                HStack(spacing: 8) {
                    ForEach(model.authUser?.roles ?? ["Standard access"], id: \.self) { role in
                        Text(role.uppercased())
                            .font(.caption2.weight(.semibold))
                            .tracking(2)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.white.opacity(0.15), in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(20)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.15), radius: 20, x: 0, y: 12)
    }

    private var accountDetailsCard: some View {
        BrandCard(title: "Account details", icon: "person.crop.circle") {
            ProfileRow(label: "User ID", value: model.authUser.map { String($0.id) } ?? "—")
            ProfileRow(label: "Display name", value: model.authUser?.display_name ?? "Not set")
            ProfileRow(label: "Email", value: model.authUser?.email ?? "Not provided")
            ProfileRow(label: "Roles", value: (model.authUser?.roles?.isEmpty == false) ? (model.authUser?.roles?.joined(separator: ", ") ?? "") : "Standard access")
        }
    }

    private var providerCard: some View {
        BrandCard(title: "Identity providers", icon: "lock.shield") {
            if model.authProviders.isEmpty {
                Text("No providers reported yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(model.authProviders) { provider in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(providerLabel(provider))
                                .font(.subheadline.weight(.semibold))
                            Text(provider.enabled ? "Enabled and ready" : "Disabled")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(provider.enabled ? "Active" : "Inactive")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(provider.enabled ? Color.green.opacity(0.18) : Color.gray.opacity(0.18), in: Capsule())
                            .foregroundStyle(provider.enabled ? Color.green : Color.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var preferencesCard: some View {
        BrandCard(title: "Preferences", icon: "slider.horizontal.3") {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Theme")
                        .font(.subheadline.weight(.semibold))
                    Text("Match your current workspace.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: { dark.toggle() }) {
                    Label(dark ? "Light" : "Dark", systemImage: dark ? "sun.max.fill" : "moon.fill")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var sessionCard: some View {
        BrandCard(title: "Session", icon: "checkmark.seal") {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Active session")
                        .font(.subheadline.weight(.semibold))
                    Text("Managed by your identity provider.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: signOut) {
                    Label(isSigningOut ? "Signing out…" : "Sign out", systemImage: "arrow.backward.circle")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.red.opacity(0.85))
                .disabled(isSigningOut)
            }
        }
    }

    private func signOut() {
        guard !isSigningOut else { return }
        isSigningOut = true
        Task {
            await model.logout()
            isSigningOut = false
        }
    }

    private func providerLabel(_ provider: AuthProvider) -> String {
        if let name = provider.display_name, !name.isEmpty { return name }
        switch provider.id {
        case .google: return "Google"
        case .microsoft: return "Microsoft"
        case .apple: return "Apple"
        }
    }
}

private struct ProfileRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.trailing)
        }
    }
}
