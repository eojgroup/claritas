import SwiftUI

struct NewsListView: View {
    let items: [NewsItem]
    var compact: Bool = false
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
                    NewsRow(item: n, compact: compact, onSelectCountry: onSelectCountry, onOpenEvent: onOpenEvent)
                    if compact && n.id != items.last?.id {
                        Divider()
                    }
                }
            }
        }
    }
}

private struct NewsRow: View {
    let item: NewsItem
    let compact: Bool
    var onSelectCountry: (String) -> Void
    var onOpenEvent: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if compact {
            compactBody
        } else {
            regularBody
        }
    }

    private var compactBody: some View {
        HStack(alignment: .top, spacing: 10) {
            if let imageURL = proxiedImageURL() {
                RemoteImage(url: imageURL)
                    .frame(width: 74, height: 54)
                    .background(ClaritasPalette.shellSurface(for: colorScheme))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 4) {
                if let urlString = item.url, let url = URL(string: urlString) {
                    Link(item.presentationTitle, destination: url)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        .lineLimit(2)
                } else {
                    Text(item.presentationTitle)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                }
                HStack(spacing: 5) {
                    if let source = sourceLabel {
                        Text(source).lineLimit(1)
                    }
                    if let iso = item.country_iso2?.uppercased(), !iso.isEmpty {
                        Text("·")
                        Button(iso) { onSelectCountry(iso) }
                            .buttonStyle(.plain)
                    }
                    Spacer(minLength: 2)
                    if let date = item.eventDate {
                        Text(date.formatted(date: .numeric, time: .shortened))
                            .monospacedDigit()
                    }
                }
                .font(.caption2)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                if let summary = item.presentationSummary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let event = item.linked_events.first {
                    Button {
                        onOpenEvent(event.id)
                    } label: {
                        Label("\(item.linked_events.count) linked \(item.linked_events.count == 1 ? "event" : "events")", systemImage: "link")
                            .font(.caption2.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    .accessibilityLabel("Open linked event: \(event.title)")
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var regularBody: some View {
        HStack(alignment: .top, spacing: 12) {
            if let imageURL = proxiedImageURL() {
                RemoteImage(url: imageURL)
                    .frame(width: 120, height: 75)
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
                    if let iso = item.country_iso2?.uppercased(), !iso.isEmpty {
                        Button(action: { onSelectCountry(iso) }) {
                            Text(iso)
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(ClaritasPalette.shellSurface(for: colorScheme), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    if let d = item.eventDate {
                        Text(DateFormatter.localizedString(from: d, dateStyle: .short, timeStyle: .short))
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
                if !item.linked_events.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("LINKED SIGNALS · \(item.linked_events.count)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                        ForEach(item.linked_events.prefix(3)) { event in
                            Button {
                                onOpenEvent(event.id)
                            } label: {
                                HStack(alignment: .top, spacing: 7) {
                                    Image(systemName: event.earth_observation_state == "imagery_available"
                                        ? "sensor.tag.radiowaves.forward"
                                        : "dot.radiowaves.left.and.right")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(event.title)
                                            .font(.caption.weight(.semibold))
                                            .lineLimit(2)
                                        Text("\(event.domain_count) lenses · \(event.evidence_count) records · \(Int(event.confidence * 100))% confidence")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("Open linked signal: \(event.title)")
                        }
                        if item.linked_events.count > 3 {
                            Text("+\(item.linked_events.count - 3) more linked investigations")
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
        if item.source_name?.lowercased() == "gdelt",
           let payload = item.payload?.object,
           let publisher = normalizedSourceName(payload["source"]?.string) {
            return "\(publisher) · via GDELT"
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
