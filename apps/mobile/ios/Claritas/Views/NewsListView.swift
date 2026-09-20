import SwiftUI

struct NewsListView: View {
    let items: [NewsItem]
    var compact: Bool = false
    var selectedItemID: Int? = nil
    var onSelectCountry: (String) -> Void
    var onOpenEvent: (String) -> Void = { eventID in
        NotificationCenter.default.post(
            name: .claritasWatchOpenDestination,
            object: "intelligence",
            userInfo: ["eventID": eventID]
        )
    }

    var body: some View {
        if items.isEmpty {
            Text("No news items yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding()
                .brandGlass(cornerRadius: 12)
        } else {
            VStack(spacing: compact ? 0 : 12) {
                ForEach(items) { n in
                    NewsRow(
                        item: n,
                        compact: compact,
                        selected: selectedItemID == n.id,
                        onSelectCountry: onSelectCountry,
                        onOpenEvent: onOpenEvent
                    )
                    if compact && n.id != items.last?.id {
                        Divider()
                    }
                }
            }
        }
    }
}

struct NewsPriorityMetadataView: View {
    let item: NewsItem
    var compact: Bool = false
    @Environment(\.colorScheme) private var colorScheme

    private var tierCode: String? {
        if item.importance?.is_fallback == true { return "unranked" }
        return item.importance?.tier?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var tierTone: Color {
        switch tierCode {
        case "top": return ClaritasPalette.negativeText(for: colorScheme)
        case "high": return ClaritasPalette.shellAccent(for: colorScheme)
        case "notable": return ClaritasPalette.dataBlue(for: colorScheme)
        default: return ClaritasPalette.shellMuted(for: colorScheme)
        }
    }

    private var visibleTags: [NewsTag] {
        item.presentationTags
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 4) {
            HStack(spacing: 5) {
                if let tier = item.importanceTierLabel {
                    Text(tier.uppercased())
                        .font(.caption2.weight(.bold))
                        .tracking(0.6)
                        .foregroundStyle(tierTone)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(tierTone.opacity(0.12), in: Capsule())
                }
                Text(item.primaryCategoryLabel.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.5)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(1)
            }
            if let reason = item.primaryImportanceReason, !reason.isEmpty {
                Text(reason)
                    .font(.caption2)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(compact ? 1 : 2)
            }
            if !visibleTags.isEmpty {
                Text(visibleTags.map(\.label).joined(separator: " · "))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    .lineLimit(1)
                    .accessibilityLabel("Tags: \(visibleTags.map(\.label).joined(separator: ", "))")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct NewsRow: View {
    let item: NewsItem
    let compact: Bool
    let selected: Bool
    var onSelectCountry: (String) -> Void
    var onOpenEvent: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var regularThumbnailSize: CGSize {
        horizontalSizeClass == .regular ? CGSize(width: 176, height: 110) : CGSize(width: 120, height: 75)
    }

    var body: some View {
        if compact {
            compactBody
        } else {
            regularBody
        }
    }

    private var compactBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(sourceLabel ?? "Reporting source") · \(item.chronologyDisplayText)")
                .font(.caption)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .fixedSize(horizontal: false, vertical: true)
            if let urlString = item.url, let url = URL(string: urlString) {
                Link(item.presentationTitle, destination: url)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(item.presentationTitle)
                    .font(.subheadline.weight(.semibold))
            }
            if let disclosure = item.translationDisclosure {
                Text(disclosure).font(.caption2).foregroundStyle(.secondary)
            }
            if let summary = item.presentationSummary, !summary.isEmpty {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                Text(item.primaryCategoryLabel)
                    .font(.caption)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .overlay(Capsule().stroke(ClaritasPalette.shellBorder(for: colorScheme)))
                ForEach(Array(item.subjectCountries.prefix(3)), id: \.self) { iso in
                    Button(iso) { onSelectCountry(iso) }
                        .font(.caption)
                        .frame(minWidth: 44, minHeight: 44)
                        .buttonStyle(.plain)
                }
            }
            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            if let event = item.additionalContextEvents.first {
                Button { onOpenEvent(event.id) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.up")
                        Text(event.additionalContextLabel)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                    }
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                .accessibilityLabel("Explore additional context: \(event.additionalContextLabel)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 16)
        .padding(.horizontal, selected ? 8 : 0)
        .background(
            selected ? ClaritasPalette.shellHighlight(for: colorScheme).opacity(0.28) : Color.clear,
            in: RoundedRectangle(cornerRadius: 10)
        )
    }

    private var regularBody: some View {
        HStack(alignment: .top, spacing: 12) {
            if let imageURL = proxiedImageURL() {
                RemoteImage(url: imageURL)
                    .frame(width: regularThumbnailSize.width, height: regularThumbnailSize.height)
                    .background(ClaritasPalette.shellSurface(for: colorScheme))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 6) {
                if let u = item.url, let url = URL(string: u) {
                    Link(item.presentationTitle, destination: url)
                        .font(.headline)
                        .foregroundStyle(colorScheme == .dark ? ClaritasPalette.sage : ClaritasPalette.darkBlue)
                        .lineLimit(2)
                } else {
                    Text(item.presentationTitle)
                        .font(.headline)
                        .lineLimit(2)
                }
                if let disclosure = item.translationDisclosure {
                    Text(disclosure)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                }
                Text(item.chronologyDisplayText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .fixedSize(horizontal: false, vertical: true)
                NewsPriorityMetadataView(item: item)
                HStack(spacing: 8) {
                    if let source = sourceLabel {
                        Text(source)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(ClaritasPalette.darkGreen.opacity(0.16), in: Capsule())
                            .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                    }
                    if let language = item.language_code, !language.isEmpty {
                        Text(language.uppercased())
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(ClaritasPalette.darkBlue.opacity(0.12), in: Capsule())
                    }
                    ForEach(Array(item.subjectCountries.prefix(3)), id: \.self) { iso in
                        Button(action: { onSelectCountry(iso) }) {
                            Text(iso)
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(ClaritasPalette.shellSurface(for: colorScheme), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }

                }
                if let s = item.presentationSummary {
                    if item.ai_summary != nil {
                        Text("AI-generated English summary · source headline/excerpt only")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Text(s)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                if item.requiresTranslation {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Original publisher headline · \(item.language_code?.uppercased() ?? "unknown language")")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(item.title ?? item.url ?? "Untitled")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                if !item.additionalContextEvents.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("ADDITIONAL CONTEXT")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        ForEach(item.additionalContextEvents.prefix(3)) { event in
                            Button {
                                onOpenEvent(event.id)
                            } label: {
                                HStack(alignment: .top, spacing: 7) {
                                    Image(systemName: event.earth_observation_state == "imagery_available"
                                        ? "sensor.tag.radiowaves.forward"
                                        : "dot.radiowaves.left.and.right")
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 5) {
                                            Text(IntelligenceLinkagePresentation.label(for: event.correlation_factors))
                                                .font(.caption2.weight(.bold))
                                                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                                            if IntelligenceLinkagePresentation.decision(in: event.correlation_factors) == "attached",
                                               let score = event.correlation_score {
                                                Text("Match score \(Int((score * 100).rounded()))%")
                                                    .font(.caption2.monospacedDigit())
                                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                            }
                                        }
                                        Text(event.title)
                                            .font(.caption.weight(.semibold))
                                            .lineLimit(2)
                                        Text(event.additionalContextLabel)
                                            .font(.caption2)
                                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                        Text(IntelligenceLinkagePresentation.explanation(for: event.correlation_factors))
                                            .font(.caption2)
                                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 4)
                                    Image(systemName: "chevron.right")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                }
                                .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                                .padding(9)
                                .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Open \(IntelligenceLinkagePresentation.label(for: event.correlation_factors).lowercased()): \(event.title)")
                        }
                        if item.additionalContextEvents.count > 3 {
                            Text("+\(item.additionalContextEvents.count - 3) more linked investigations")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .brandGlass(cornerRadius: 12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    selected ? ClaritasPalette.shellAccent(for: colorScheme) : Color.clear,
                    lineWidth: selected ? 2 : 0
                )
        )
    }

    private func proxiedImageURL() -> URL? {
        // Try provider-specific image fields before falling back to the URL.
        guard let payload = item.payload else { return nil }
        let urlStr: String? = {
            if case .object(let dict) = payload {
                if let u = dict["image"]?.string { return u }
                if let u = dict["urlToImage"]?.string { return u }
                if let u = dict["image_url"]?.string { return u }
                if let raw = dict["raw"], case .object(let rawObj) = raw, let u = rawObj["image"]?.string { return u }
                if let raw = dict["raw"], case .object(let rawObj) = raw, let u = rawObj["urlToImage"]?.string { return u }
                if let raw = dict["raw"], case .object(let rawObj) = raw, let u = rawObj["image_url"]?.string { return u }
            }
            return nil
        }()
        guard let u = urlStr, let original = URL(string: u) else { return nil }
        return APIClient().imageProxyURL(for: original)
    }

    private var sourceLabel: String? {
        let explicitPublisher = normalizedSourceName(item.publisher)
        if let sourceName = item.source_name?.lowercased(),
           let payload = item.payload?.object {
            let publisher = explicitPublisher
                ?? normalizedSourceName(payload["publisher"]?.string)
                ?? normalizedSourceName(payload["source"]?.string)
            if sourceName == "gdelt", let publisher {
                return "\(publisher) · via GDELT"
            }
            if sourceName == "govuk_search", let publisher {
                return "\(publisher) · via GOV.UK"
            }
            if sourceName == "institutional_rss", let publisher {
                return "\(publisher) · official feed"
            }
        }
        if let explicitPublisher {
            return explicitPublisher
        }
        if let explicit = normalizedSourceName(item.source_name) {
            return explicit
        }
        guard let payload = item.payload else { return nil }
        guard case .object(let dict) = payload else { return nil }

        if let source = normalizedSourceName(dict["provider"]?.string) {
            return source
        }
        if let source = normalizedSourceName(dict["source"]?.string) {
            return source
        }
        if let raw = dict["raw"]?.object {
            if let source = normalizedSourceName(raw["source"]?.string) {
                return source
            }
        }
        return nil
    }

    private func normalizedSourceName(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        switch trimmed.lowercased() {
        case "gdelt":
            return "GDELT"
        case "institutional_rss":
            return "Institutional RSS"
        default:
            return trimmed
        }
    }
}

// Lightweight remote image view using AsyncImage
struct RemoteImage: View {
    let url: URL?
    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image
                        .resizable()
                        .scaledToFill()
                case .failure(_): Color.clear
                case .empty: ProgressView()
                @unknown default: Color.clear
                }
            }
        } else {
            Color.clear
        }
    }
}

// Helpers to unwrap AnyCodable payload values more ergonomically
// no-op

/// Refreshes independently without changing the latest-first reader feed.
struct NewsHighlightsView: View {
    let country: String?
    let category: String
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var items: [NewsItem] = []
    @State private var loadedScope = ""
    @State private var failed = false
    private var scope: String { "\(country ?? "global")|\(category)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Top news · past 24 hours").font(.headline)
            Text("Ranked by importance · refreshes every 5 minutes")
                .font(.caption2).foregroundStyle(.secondary)
            if loadedScope != scope {
                ProgressView("Loading highlights…").font(.caption)
            } else if items.isEmpty {
                Text(failed ? "Highlights are temporarily unavailable." : "No stories in the past 24 hours for this scope.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    HStack(alignment: .top, spacing: 10) {
                        Text(String(format: "%02d", index + 1))
                            .font(.title3.monospacedDigit())
                            .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(item.publisher ?? item.source_name ?? "Reporting source") · \(item.chronologyDisplayText)")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let raw = item.url, let url = URL(string: raw) {
                                Link(item.presentationTitle, destination: url)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                    .multilineTextAlignment(.leading)
                            } else {
                                Text(item.presentationTitle).font(.subheadline.weight(.semibold))
                            }
                            if let disclosure = item.translationDisclosure {
                                Text(disclosure).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                    if index < items.count - 1 { Divider() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(ClaritasPalette.shellBorder(for: colorScheme)))
        .task(id: scope) {
            while !Task.isCancelled {
                do {
                    let page = try await model.api.fetchNews(limit: 3, country: country,
                        category: category, sort: "importance", daily: true, includeMetadata: false)
                    guard !Task.isCancelled else { return }
                    items = page.items
                    failed = false
                } catch {
                    guard !Task.isCancelled else { return }
                    items = []
                    failed = true
                }
                loadedScope = scope
                do { try await Task.sleep(nanoseconds: 300_000_000_000) }
                catch { return }
            }
        }
    }
}
