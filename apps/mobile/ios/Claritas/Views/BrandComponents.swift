import SwiftUI

enum ClaritasPalette {
    static let darkBlue = Color(hex: "#173342")
    static let darkGreen = Color(hex: "#1E493B")
    static let lightGreen = Color(hex: "#C2DEC2")
    static let sage = Color(hex: "#8BB99A")
    static let orange = Color(hex: "#D97932")
    static let orangeStrong = Color(hex: "#A94E1D")
    static let grey = Color(hex: "#52656A")
    static let beige = Color(hex: "#D2C5B5")
    static let brown = orangeStrong
    static let offWhite = Color(hex: "#FFFDF7")
    static let text = Color(hex: "#132833")

    static let positive = darkGreen
    static let negative = Color(red: 0.72, green: 0.23, blue: 0.23)

    static func shellBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#0B1718") : Color(hex: "#F4EFE5")
    }

    static func shellSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#112325").opacity(0.82) : Color(hex: "#FFFDF8").opacity(0.78)
    }

    static func shellRaised(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#173033").opacity(0.86) : Color(hex: "#FFFDF8").opacity(0.9)
    }

    static func shellBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B7C3BD").opacity(0.2) : darkBlue.opacity(0.16)
    }

    static func shellBorderStrong(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B7C3BD").opacity(0.34) : darkBlue.opacity(0.3)
    }

    static func shellInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? offWhite : text
    }

    static func shellMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B7C3BD") : grey
    }

    static func shellSidebar(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#081416") : darkBlue
    }

    static func shellHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#294A3A") : lightGreen
    }

    static func shellAccent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#E58B4A") : orange
    }

    static func positiveText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#68A082") : darkGreen
    }

    static func negativeText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D96B62") : Color(hex: "#A73B32")
    }

    static func dataBlue(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#5E91A3") : darkBlue
    }

    static func glassHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color.white.opacity(0.14) : Color.white.opacity(0.72)
    }
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
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? Color(hex: "#102426")
                        : Color(hex: "#E8E1D5"),
                    ClaritasPalette.shellBackground(for: colorScheme)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    ClaritasPalette.darkGreen.opacity(colorScheme == .dark ? 0.14 : 0.08),
                    Color.clear,
                    ClaritasPalette.orange.opacity(colorScheme == .dark ? 0.1 : 0.06)
                ],
                startPoint: .topTrailing,
                endPoint: .bottomLeading
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
                    Text(title.uppercased())
                        .font(.caption2.weight(.semibold))
                        .tracking(3)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }
            content
        }
        .padding(16)
        .brandGlass(cornerRadius: 18, elevated: true)
    }
}

struct BrandSectionHeader: View {
    let kicker: String
    let title: String
    let detail: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kicker.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(3)
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

struct BrandMetricCard: View {
    let title: String
    let value: String
    let detail: String?
    let tone: Color?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(2.6)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.title3.weight(.semibold))
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
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(elevated
                        ? ClaritasPalette.shellRaised(for: colorScheme)
                        : ClaritasPalette.shellSurface(for: colorScheme))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [
                                ClaritasPalette.glassHighlight(for: colorScheme),
                                ClaritasPalette.shellBorder(for: colorScheme),
                                ClaritasPalette.shellBorderStrong(for: colorScheme)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(
                color: Color.black.opacity(colorScheme == .dark ? 0.24 : 0.08),
                radius: elevated ? 20 : 12,
                x: 0,
                y: elevated ? 12 : 7
            )
    }
}

extension View {
    func brandGlass(cornerRadius: CGFloat = 18, elevated: Bool = false) -> some View {
        modifier(BrandGlassModifier(cornerRadius: cornerRadius, elevated: elevated))
    }
}
