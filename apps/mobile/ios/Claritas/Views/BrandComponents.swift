import SwiftUI

enum ClaritasPalette {
    static let darkBlue = Color(hex: "#0B2028")
    static let darkGreen = Color(hex: "#244D42")
    static let lightGreen = Color(hex: "#B8CFBF")
    static let sage = Color(hex: "#5E927E")
    static let orange = Color(hex: "#D1B78A")
    static let orangeStrong = Color(hex: "#A97846")
    static let grey = Color(hex: "#5C6966")
    static let beige = Color(hex: "#D8C6A3")
    static let brown = orangeStrong
    static let offWhite = Color(hex: "#F7F2E8")
    static let text = Color(hex: "#0B2028")

    static let positive = darkGreen
    static let negative = Color(hex: "#A73B32")

    static func shellBackground(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#07151B") : Color(hex: "#EEE5D5")
    }

    static func shellBackgroundElevated(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#0B2023") : Color(hex: "#E4D7BF")
    }

    static func shellSurface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#102A2A").opacity(0.92) : Color(hex: "#F7F2E8").opacity(0.86)
    }

    static func shellRaised(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#15342F").opacity(0.97) : Color(hex: "#FAF6EE").opacity(0.96)
    }

    static func shellSurfaceMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#193831").opacity(0.84) : Color(hex: "#E5D8C1").opacity(0.82)
    }

    static func shellBorder(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D8C6A3").opacity(0.16) : darkBlue.opacity(0.16)
    }

    static func shellBorderStrong(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D8C6A3").opacity(0.28) : darkBlue.opacity(0.3)
    }

    static func shellInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#F1EBDD") : text
    }

    static func shellMuted(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#B9C3BC") : grey
    }

    static func shellSidebar(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#061118") : Color(hex: "#0B2028")
    }

    static func shellHighlight(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D1B78A").opacity(0.17) : Color(hex: "#D8C6A3").opacity(0.78)
    }

    static func shellAccent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#D1B78A") : Color(hex: "#A97846")
    }

    static func shellAccentSecondary(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#5E927E") : Color(hex: "#2F6858")
    }

    static func positiveText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#82AF99") : Color(hex: "#2F6858")
    }

    static func negativeText(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#DE8178") : Color(hex: "#9B4038")
    }

    static func dataBlue(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: "#7FA3AD") : Color(hex: "#315F70")
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
                        ? Color(hex: "#07151B")
                        : Color(hex: "#E8DCC6")
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
