import SwiftUI

enum ClaritasPalette {
    // A restrained command palette shared by iPhone and iPad. The previous
    // green/orange treatment made whole panels compete with their content;
    // navy now carries structure while beige and blue are reserved for state.
    static let darkBlue = Color(hex: "#0B1E2D")
    static let darkGreen = Color(hex: "#253D46")
    static let lightGreen = Color(hex: "#CBD5D8")
    static let sage = Color(hex: "#829EAC")
    static let orange = Color(hex: "#D3C3A5")
    static let orangeStrong = Color(hex: "#927A54")
    static let grey = Color(hex: "#657580")
    static let beige = Color(hex: "#D3C3A5")
    static let brown = orangeStrong
    static let offWhite = Color(hex: "#F7F2E8")
    static let text = Color(hex: "#0B2028")

    static let positive = darkGreen
    static let negative = Color(hex: "#A73B32")

    static func shellBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#07141E") : Color(hex: "#ECEFF0")
    }

    static func shellBackgroundElevated(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#0B1E2D") : Color(hex: "#E2E7E9")
    }

    static func shellSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#102735").opacity(0.96) : Color(hex: "#F7F5F0").opacity(0.94)
    }

    static func shellRaised(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#173140").opacity(0.98) : Color(hex: "#FFFFFF").opacity(0.98)
    }

    static func shellSurfaceMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#203A48").opacity(0.88) : Color(hex: "#E5EAEC").opacity(0.92)
    }

    static func shellBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#AFC0C8").opacity(0.18) : darkBlue.opacity(0.14)
    }

    static func shellBorderStrong(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#AFC0C8").opacity(0.3) : darkBlue.opacity(0.24)
    }

    static func shellInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#F2F0EA") : text
    }

    static func shellMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B8C3C9") : grey
    }

    static func shellSidebar(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#06111A") : Color(hex: "#0B1E2D")
    }

    static func shellHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D3C3A5").opacity(0.16) : Color(hex: "#D3C3A5").opacity(0.7)
    }

    static func shellAccent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D3C3A5") : Color(hex: "#765F3E")
    }

    static func shellAccentSecondary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#91ADBA") : Color(hex: "#426779")
    }

    static func positiveText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#91B7A6") : Color(hex: "#356B58")
    }

    static func negativeText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#DE8178") : Color(hex: "#9B4038")
    }

    static func dataBlue(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#9AB6C4") : Color(hex: "#426779")
    }

    static func glassHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.14) : Color.white.opacity(0.72)
    }
}

enum ClaritasLayout {
    static let minimumTouchTarget: CGFloat = 44
    static let controlRadius: CGFloat = 10
    static let panelRadius: CGFloat = 14
    static let sectionSpacing: CGFloat = 16
}

extension Color {
    init(hex: String) {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") {
            raw.removeFirst()
        }
        if raw.count == 3 {
            raw = raw.map { "\($0)\($0)" }.joined()
        }
        guard raw.count == 6, let value = Int(raw, radix: 16) else {
            self = .clear
            return
        }
        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        self = Color(red: red, green: green, blue: blue)
    }
}

struct BrandBackground<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? Color(hex: "#07141E")
                        : Color(hex: "#E4E8EA")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    ClaritasPalette.shellAccentSecondary(for: colorScheme).opacity(colorScheme == .dark ? 0.08 : 0.07),
                    Color.clear,
                    ClaritasPalette.shellAccent(for: colorScheme).opacity(colorScheme == .dark ? 0.1 : 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            content
        }
    }
}

struct BrandCard<Content: View>: View {
    let title: String?
    let icon: String?
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    init(title: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                HStack(spacing: 8) {
                    if let icon {
                        Image(systemName: icon)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }
            content
        }
        .padding(16)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }
}

struct BrandSectionHeader: View {
    let kicker: String
    let title: String
    let detail: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kicker)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
        }
    }
}

/// A deliberately compact entry point to the daily briefing. It gives the
/// reader the current synthesis before the map without turning the overview
/// into another long briefing page.
struct BriefingOverviewCard: View {
    let briefing: DailySignalBriefing?
    let onOpen: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Label("DAILY BRIEFING", systemImage: "doc.text")
                        .font(.caption2.weight(.bold))
                        .tracking(1.2)
                        .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                    Spacer()
                    if let updated = briefing?.updatedDate {
                        Text(updated.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }

                Text(briefing?.title ?? "Today’s global signal picture")
                    .font(.headline)
                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                    .lineLimit(1)

                if let takeaway = briefing?.key_takeaways.first {
                    Text(takeaway)
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .lineLimit(2)
                } else {
                    Text("Open the briefing for the latest cross-source synthesis.")
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .lineLimit(2)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the complete daily briefing")
    }
}

struct BrandMetricCard: View {
    let title: String
    let value: String
    let detail: String?
    let tone: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tone ?? ClaritasPalette.shellInk(for: colorScheme))
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .brandGlass(cornerRadius: 16)
    }
}

struct BrandPill: View {
    let label: String
    let tone: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                (tone ?? ClaritasPalette.shellHighlight(for: colorScheme)),
                in: Capsule()
            )
            .foregroundStyle(
                tone == nil ? ClaritasPalette.shellInk(for: colorScheme) : ClaritasPalette.offWhite
            )
    }
}

struct BrandGlassModifier: ViewModifier {
    let cornerRadius: CGFloat
    let elevated: Bool
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(elevated
                        ? ClaritasPalette.shellRaised(for: colorScheme)
                        : ClaritasPalette.shellSurface(for: colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        elevated
                            ? ClaritasPalette.shellBorderStrong(for: colorScheme)
                            : ClaritasPalette.shellBorder(for: colorScheme),
                        lineWidth: 0.5
                    )
            )
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? 0.16 : 0.05),
                radius: elevated ? 8 : 3,
                x: 0,
                y: elevated ? 4 : 1
            )
    }
}

extension View {
    func brandGlass(cornerRadius: CGFloat = 18, elevated: Bool = false) -> some View {
        modifier(BrandGlassModifier(cornerRadius: cornerRadius, elevated: elevated))
    }
}
