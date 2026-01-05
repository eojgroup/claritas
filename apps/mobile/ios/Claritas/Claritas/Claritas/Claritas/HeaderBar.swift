import SwiftUI

struct HeaderBar: View {
    var title: String? = nil
    var onSettings: (() -> Void)?
    var onProfile: (() -> Void)?

    var body: some View {
        ZStack {
            Color.claritasHeader
                .ignoresSafeArea(edges: .top)

            HStack {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.claritasBrand)
                            .frame(width: 36, height: 36)
                        Text("C")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                    }
                    if let title {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                    } else {
                        Text("CLARITAS")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.primary)
                    }
                }

                Spacer()

                HStack(spacing: 16) {
                    if let onSettings {
                        Button(action: onSettings) {
                            Image(systemName: "gearshape")
                                .foregroundStyle(.primary)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Image(systemName: "gearshape")
                            .foregroundStyle(.secondary)
                    }

                    if let onProfile {
                        Button(action: onProfile) {
                            Image(systemName: "person.crop.circle")
                                .foregroundStyle(.primary)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Image(systemName: "person.crop.circle")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 10)
        }
        .frame(height: 56)
    }
}

#Preview {
    VStack(spacing: 0) {
        HeaderBar(title: "Dashboard")
        Spacer()
    }
    .background(Color.claritasBackground)
}
