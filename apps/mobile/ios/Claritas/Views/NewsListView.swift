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
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
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

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(url: proxiedImageURL())
                .frame(width: 120, height: 75)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2)))
            VStack(alignment: .leading, spacing: 6) {
                if let u = item.url, let url = URL(string: u) {
                    Link(item.title ?? u, destination: url)
                        .font(.headline)
                        .lineLimit(2)
                } else {
                    Text(item.title ?? "Untitled")
                        .font(.headline)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    if let source = sourceLabel {
                        Text(source)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(Color(red: 0.07, green: 0.40, blue: 0.32).opacity(0.16), in: Capsule())
                            .foregroundStyle(Color(red: 0.06, green: 0.43, blue: 0.35))
                    }
                    if let iso = item.country_iso2?.uppercased(), !iso.isEmpty {
                        Button(action: { onSelectCountry(iso) }) {
                            Text(iso)
                                .font(.caption)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Color(.secondarySystemBackground), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    if let d = item.eventDate {
                        Text(DateFormatter.localizedString(from: d, dateStyle: .short, timeStyle: .short))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let s = item.summary, !s.isEmpty {
                    Text(s)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.secondary.opacity(0.2)))
    }

    private func proxiedImageURL() -> URL? {
        // Try NewsAPI + TheNewsAPI image fields.
        guard let payload = item.payload else { return nil }
        let urlStr: String? = {
            if case .object(let dict) = payload {
                if let u = dict["urlToImage"]?.string { return u }
                if let u = dict["image_url"]?.string { return u }
                if let raw = dict["raw"], case .object(let rawObj) = raw, let u = rawObj["urlToImage"]?.string { return u }
                if let raw = dict["raw"], case .object(let rawObj) = raw, let u = rawObj["image_url"]?.string { return u }
            }
            return nil
        }()
        guard let u = urlStr, let original = URL(string: u) else { return nil }
        return APIClient().imageProxyURL(for: original)
    }

    private var sourceLabel: String? {
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
        case "newsapi":
            return "NewsAPI"
        case "thenewsapi":
            return "TheNewsAPI"
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
