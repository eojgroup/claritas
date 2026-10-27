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
            LazyVStack(spacing: compact ? 0 : 12) {
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

    private var visibleTags: [NewsTag] {
        item.presentationTags
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 4) {
            HStack(spacing: 5) {
                Text(item.primaryCategoryLabel.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.5)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(1)
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

    @State private var detailExpansion: Bool?

    private var showsDetails: Bool { detailExpansion ?? selected }

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
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(sourceLabel ?? "Reporting source")
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Text(compactTimestamp)
                    .monospacedDigit()
                    .lineLimit(1)
                    .layoutPriority(1)
                    .accessibilityLabel(item.chronologyDisplayText)
            }
            .font(.caption2)
            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))

            Button {
                detailExpansion = !showsDetails
            } label: {
                HStack(alignment: .top, spacing: 6) {
                    Text(item.presentationTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        .multilineTextAlignment(.leading)
                        .lineLimit(showsDetails ? nil : 3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: showsDetails ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }
                .frame(minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(showsDetails ? "Collapses report details" : "Expands the full headline, summary and original source")
            .accessibilityValue(showsDetails ? "Expanded" : "Collapsed")

            if let disclosure = item.translationDisclosure {
                Text(disclosure).font(.caption2).foregroundStyle(.secondary)
            }
            if showsDetails {
                if let summary = item.presentationSummary, !summary.isEmpty {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
                if item.requiresTranslation {
                    Text("Original: \(item.title ?? item.url ?? "Untitled")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let imageURL = proxiedImageURL() {
                    RemoteImage(url: imageURL)
                        .frame(height: 140)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if let urlString = item.url, let url = URL(string: urlString) {
                    Link(destination: url) {
                        Label("Read original source", systemImage: "arrow.up.right")
                            .font(.caption.weight(.semibold))
                            .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                    }
                }
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    compactCategoryAndPlace
                    Spacer(minLength: 0)
                    SourceInvestigationButton(domain: "news", recordType: "item", recordID: String(item.id), onOpenEvent: onOpenEvent)
                }
                VStack(alignment: .leading, spacing: 0) {
                    compactCategoryAndPlace
                    SourceInvestigationButton(domain: "news", recordType: "item", recordID: String(item.id), onOpenEvent: onOpenEvent)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
        .padding(.horizontal, selected ? 8 : 0)
        .background(
            selected ? ClaritasPalette.shellHighlight(for: colorScheme).opacity(0.28) : Color.clear,
            in: RoundedRectangle(cornerRadius: 10)
        )
    }

    private var compactTimestamp: String {
        guard let date = item.chronologyDate else { return "Time unavailable" }
        return "\(item.chronologyLabel) \(date.formatted(.dateTime.day().month(.abbreviated).hour().minute()))"
    }

    private var compactCategoryAndPlace: some View {
        HStack(spacing: 4) {
            Text(item.primaryCategoryLabel)
                .lineLimit(1)
            ForEach(Array(item.subjectCountries.prefix(2)), id: \.self) { iso in
                Button(iso) { onSelectCountry(iso) }
                    .frame(minWidth: ClaritasLayout.minimumTouchTarget, minHeight: ClaritasLayout.minimumTouchTarget)
                    .buttonStyle(.plain)
                    .accessibilityLabel("Show \(iso) reporting")
            }
        }
        .font(.caption2)
        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
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
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
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
                SourceInvestigationButton(domain: "news", recordType: "item", recordID: String(item.id), onOpenEvent: onOpenEvent)
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

/// Every source enters the same event → related signals → original source flow.
struct SourceInvestigationButton: View {
    @EnvironmentObject private var model: AppModel
    let domain: String
    let recordType: String
    let recordID: String
    var onOpenEvent: (String) -> Void = { eventID in
        NotificationCenter.default.post(name: .claritasWatchOpenDestination, object: "intelligence", userInfo: ["eventID": eventID])
    }
    @State private var isLoading = false
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button {
                Task { await openInvestigation() }
            } label: {
                HStack(spacing: 8) {
                    if isLoading { ProgressView().controlSize(.small) }
                    else { Image(systemName: "point.3.connected.trianglepath.dotted") }
                    Text(isLoading ? "Finding signals…" : "Related signals")
                    Image(systemName: "chevron.right")
                }
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.leading)
                .frame(minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Explore event and related signals")
            .disabled(isLoading)
            if let message {
                Text(message).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    @MainActor private func openInvestigation() async {
        isLoading = true
        message = nil
        defer { isLoading = false }
        do {
            let resolution = try await model.api.resolveIntelligenceSource(domain: domain, recordType: recordType, recordID: recordID)
            if let eventID = resolution.event_id {
                model.selectedIntelligenceEventID = eventID
                onOpenEvent(eventID)
            } else {
                message = resolution.reason ?? "An event is not available for this source yet."
            }
        } catch {
            message = "Related signals could not be loaded. Try again."
        }
    }
}
