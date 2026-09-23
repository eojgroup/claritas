import SwiftUI

struct SocialSignalsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query = ""
    @State private var country = ""
    @State private var platform = "all"

    var body: some View {
        BrandBackground {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    BrandSectionHeader(
                        kicker: "Source lens · unverified",
                        title: "Social signal monitor",
                        detail: "Newest attributed posts with the posting account and responsible party preserved."
                    )

                    IntelligenceEventPulseView(sourceLens: "social")

                    trustNotice
                    filters
                    coverageStrip
                    providerFreshness

                    if let error = model.socialLoadError, !error.isEmpty {
                        BrandCard(title: "Social signals unavailable", icon: "exclamationmark.triangle.fill") {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                                Button("Retry") { Task { await refresh() } }
                                    .buttonStyle(.bordered)
                            }
                        }
                    } else if model.socialSignals.isEmpty && model.isRefreshingSocial {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Loading attributed social claims…")
                                .font(.subheadline)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                        .frame(maxWidth: .infinity, minHeight: 160)
                        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
                    } else if model.socialSignals.isEmpty {
                        BrandCard(title: "No social signals in this scope", icon: "dot.radiowaves.left.and.right") {
                            Text("Clear the filters or ask an administrator to configure and run a provider.")
                                .font(.subheadline)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                    } else {
                        ForEach(model.socialSignals) { signal in
                            socialCard(signal)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 20)
            }
            .refreshable { await refresh() }
        }
        .task {
            let selectedCountry = model.selectedCountry?.uppercased() ?? ""
            let scopeChanged = country != selectedCountry
            if scopeChanged { country = selectedCountry }
            if scopeChanged || model.socialSignals.isEmpty { await refresh() }
        }
        .onChange(of: model.selectedCountry) { selectedCountry in
            let nextCountry = selectedCountry?.uppercased() ?? ""
            guard nextCountry != country else { return }
            country = nextCountry
            Task { await refresh() }
        }
    }

    private var trustNotice: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: "exclamationmark.bubble.fill")
                .foregroundStyle(.orange)
                .font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Attributed claim — not a verified fact")
                    .font(.subheadline.weight(.semibold))
                Text("A platform badge and engagement describe the account and reach only. Corroborate material claims with independent reporting or primary evidence.")
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: ClaritasLayout.panelRadius))
        .overlay(RoundedRectangle(cornerRadius: ClaritasLayout.panelRadius).stroke(.orange.opacity(0.4)))
        .accessibilityElement(children: .combine)
    }

    private var filters: some View {
        BrandCard(title: "Signal scope", icon: "line.3.horizontal.decrease.circle") {
            VStack(spacing: 10) {
                TextField("Topic, author, or phrase", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.search)
                    .onSubmit { Task { await refresh() } }

                HStack(spacing: 10) {
                    Picker("Platform", selection: $platform) {
                        Text("All platforms").tag("all")
                        ForEach(SocialPlatform.allCases) { value in
                            Text(value.label).tag(value.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)

                    TextField("Country (ISO2)", text: $country)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 150)
                        .onChange(of: country) { value in
                            country = String(value.uppercased().filter(\.isLetter).prefix(2))
                        }
                }

                Button {
                    Task { await refresh() }
                } label: {
                    Label(model.isRefreshingSocial ? "Refreshing…" : "Refresh social signals", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isRefreshingSocial)
            }
        }
    }

    private var coverageStrip: some View {
        let observedProviders = model.socialCoverage?.coverage.filter { $0.signal_count > 0 }.count ?? 0
        let accounts = model.socialCoverage?.coverage.reduce(0) { $0 + $1.account_count } ?? 0
        return HStack(spacing: 0) {
            metric(value: "\(model.socialSignals.count)", label: "Claims")
            Divider()
            metric(value: "\(accounts)", label: "Accounts")
            Divider()
            metric(value: "\(observedProviders)", label: "Sources seen")
        }
        .padding(12)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    @ViewBuilder
    private var providerFreshness: some View {
        if let response = model.socialCoverage, !response.providers.isEmpty {
            BrandCard(title: "Provider status", icon: "antenna.radiowaves.left.and.right") {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(response.providers) { provider in
                        let coverage = response.coverage.first { $0.platform == provider.id }
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(provider.label)
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Text(providerStatus(provider, coverage: coverage))
                                .font(.caption2)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    if let error = model.socialCoverageLoadError, !error.isEmpty {
                        Text("Provider status refresh failed: \(error)")
                            .font(.caption2)
                            .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                    }
                    Text("Configured access is not proof of a healthy feed. ‘Seen’ means Claritas acquired at least one post in the selected coverage window.")
                        .font(.caption2)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }
        } else if let error = model.socialCoverageLoadError, !error.isEmpty {
            BrandCard(title: "Provider status unavailable", icon: "exclamationmark.triangle") {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
        }
    }

    private func metric(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
        }
        .frame(maxWidth: .infinity)
    }

    private func socialCard(_ signal: SocialSignal) -> some View {
        BrandCard(title: signal.authorLabel, icon: "person.crop.circle.badge.exclamationmark") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    if let handle = signal.handleLabel {
                        Text(handle)
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                    Text(signal.platform.label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                    if signal.posted_by.platform_verified {
                        Label("Platform badge", systemImage: "checkmark.seal.fill")
                            .font(.caption2)
                            .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                            .accessibilityHint("Platform account identity only; the message is not verified")
                    }
                    Spacer()
                    Text(signal.posted_at.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }

                Text("UNVERIFIED SOCIAL CLAIM")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.orange.opacity(0.1), in: Capsule())

                if let title = signal.title, !title.isEmpty {
                    Text(title).font(.headline)
                }
                Text(signal.text)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)

                Text(responsibilityText(signal))
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 8))

                SourceInvestigationButton(domain: "social", recordType: "social_signal", recordID: String(signal.id))
                HStack(spacing: 14) {
                    ForEach(engagementMetrics(for: signal)) { metric in
                        engagement(metric.icon, metric.value)
                            .accessibilityLabel("\(metric.label): \(metric.value.map(String.init) ?? "unavailable")")
                    }
                    Spacer()
                    if let url = signal.sourceURL {
                        Link(destination: url) {
                            Label("Original", systemImage: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
            }
        }
    }

    private func engagement(_ icon: String, _ value: Int?) -> some View {
        Label(value.map(String.init) ?? "—", systemImage: icon)
            .font(.caption2.monospacedDigit())
            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
    }

    private func engagementMetrics(for signal: SocialSignal) -> [SocialEngagementMetric] {
        switch signal.platform {
        case .reddit:
            return [
                .init(label: "Score", icon: "arrow.up", value: signal.engagement.score),
                .init(label: "Comments", icon: "bubble.left", value: signal.engagement.comments)
            ]
        case .youtube:
            return [
                .init(label: "Likes", icon: "hand.thumbsup", value: signal.engagement.likes),
                .init(label: "Comments", icon: "bubble.left", value: signal.engagement.comments),
                .init(label: "Views", icon: "eye", value: signal.engagement.views)
            ]
        case .x, .bluesky:
            return [
                .init(label: "Likes", icon: "heart", value: signal.engagement.likes),
                .init(label: "Replies", icon: "bubble.left", value: signal.engagement.replies),
                .init(label: "Reposts", icon: "arrow.2.squarepath", value: signal.engagement.reposts)
            ]
        }
    }

    private func responsibilityText(_ signal: SocialSignal) -> String {
        let base = "Responsible party: \(signal.responsible_party.name)."
        if let caveat = signal.responsible_party.caveat?.trimmingCharacters(in: .whitespacesAndNewlines),
           !caveat.isEmpty {
            return "\(base) \(caveat)"
        }
        return "\(base) Claritas has not independently verified this message."
    }

    private func providerStatus(
        _ provider: SocialProviderStatus,
        coverage: SocialCoverageRow?
    ) -> String {
        let observation: String
        if let coverage, coverage.signal_count > 0 {
            if let acquiredAt = coverage.latest_acquired_at {
                observation = " · last seen \(acquiredAt.formatted(date: .abbreviated, time: .shortened))"
            } else {
                observation = " · \(coverage.signal_count) seen"
            }
        } else {
            observation = ""
        }
        guard provider.enabled else { return "Disabled\(observation)" }
        guard provider.configured else { return "Setup required\(observation)" }
        guard provider.available else { return "Unavailable\(observation)" }
        guard let coverage, coverage.signal_count > 0 else { return "Configured · no posts seen" }
        if let acquiredAt = coverage.latest_acquired_at {
            return "\(coverage.signal_count) seen · latest \(acquiredAt.formatted(date: .abbreviated, time: .shortened))"
        }
        return "\(coverage.signal_count) seen"
    }

    private func refresh() async {
        await model.refreshSocialSignals(
            platform: SocialPlatform(rawValue: platform),
            country: country.isEmpty ? nil : country,
            query: query.isEmpty ? nil : query
        )
    }
}

private struct SocialEngagementMetric: Identifiable {
    let label: String
    let icon: String
    let value: Int?

    var id: String { label }
}
