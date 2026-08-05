import SwiftUI

struct NewsListView: View {
    let items: [NewsItem]
    var onSelectCountry: (String) -> Void

    var body: some View {
        if items.isEmpty {
            Text("No news items yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding()
                .brandGlass(cornerRadius: 12)
        } else {
            VStack(spacing: 12) {
                ForEach(items) { n in
                    NewsRow(item: n, onSelectCountry: onSelectCountry)
                }
            }
        }
    }
}

private struct NewsRow: View {
    let item: NewsItem
    var onSelectCountry: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(url: proxiedImageURL())
                .frame(width: 120, height: 75)
                .background(ClaritasPalette.shellSurface(for: colorScheme))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1))
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
