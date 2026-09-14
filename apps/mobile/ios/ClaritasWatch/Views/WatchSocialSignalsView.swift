import SwiftUI

struct WatchSocialSignalsView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        WatchSectionLabel(title: "Social claims", icon: "dot.radiowaves.left.and.right")
                        Spacer()
                        WatchRefreshStatus()
                    }

                    WatchCard {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "exclamationmark.bubble.fill")
                                .foregroundStyle(WatchPalette.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Unverified signals")
                                    .font(.caption.weight(.semibold))
                                Text("Account attribution does not establish truth.")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if let error = model.socialLoadError, !error.isEmpty {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Social signals unavailable")
                                    .font(.caption.weight(.semibold))
                                Text(error)
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                                Button("Retry") { Task { await model.refresh() } }
                                    .buttonStyle(.bordered)
                                    .font(.caption2)
                            }
                        }
                    } else if model.social.isEmpty {
                        WatchCard {
                            Text("No social claims in this scope.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.social.prefix(3)) { signal in
                            WatchCard {
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(spacing: 4) {
                                        Text(signal.platform.label.uppercased())
                                            .font(.system(size: 8, weight: .bold))
                                            .foregroundStyle(WatchPalette.orange)
                                        Text(signal.authorLabel)
                                            .font(.caption2.weight(.semibold))
                                            .lineLimit(1)
                                        Spacer()
                                        Text(signal.posted_at.formatted(date: .omitted, time: .shortened))
                                            .font(.system(size: 8).monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(signal.text)
                                        .font(.caption2)
                                        .lineLimit(3)
                                    if let handle = signal.handleLabel,
                                       handle != signal.authorLabel {
                                        Text(handle)
                                            .font(.system(size: 8))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Text("Responsible: \(signal.responsible_party.name)")
                                        .font(.system(size: 8))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    ForEach(Array((signal.linked_events ?? []).prefix(2))) { link in
                                        Button("Investigate on iPhone") {
                                            model.openOnPhone("intelligence", country: link.country_iso2, eventID: link.id)
                                        }
                                        .font(.caption2)
                                        .buttonStyle(.bordered)
                                        .accessibilityLabel("Open investigation on iPhone: \(link.title)")
                                    }
                                    if let engagement = engagementSummary(signal) {
                                        Text(engagement)
                                            .font(.system(size: 8).monospacedDigit())
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                    }

                    Button {
                        model.openOnPhone("social", country: model.selectedCountry)
                    } label: {
                        Label("Open on iPhone", systemImage: "iphone")
                    }
                    .buttonStyle(.bordered)
                    .font(.caption2)
                }
                .padding(.horizontal, 3)
            }
            .navigationTitle("Social")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private func engagementSummary(_ signal: SocialSignal) -> String? {
        let values: [String]
        switch signal.platform {
        case .reddit:
            values = [
                signal.engagement.score.map { "\($0) score" },
                signal.engagement.comments.map { "\($0) comments" }
            ].compactMap { $0 }
        case .youtube:
            values = [
                signal.engagement.views.map { "\($0) views" },
                signal.engagement.comments.map { "\($0) comments" }
            ].compactMap { $0 }
        case .x, .bluesky:
            values = [
                signal.engagement.likes.map { "\($0) likes" },
                signal.engagement.reposts.map { "\($0) reposts" }
            ].compactMap { $0 }
        }
        return values.isEmpty ? nil : values.joined(separator: " · ")
    }
}
