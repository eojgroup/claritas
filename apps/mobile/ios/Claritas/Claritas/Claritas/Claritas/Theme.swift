import SwiftUI

extension Color {
    static let claritasBrand = Color(red: 0.12, green: 0.20, blue: 0.32) // dark navy
    static let claritasHeader = Color(red: 0.90, green: 0.93, blue: 0.96) // light bluish gray
    static let claritasBackground = Color(red: 0.95, green: 0.97, blue: 0.99) // very light
    static let claritasCardBorder = Color(red: 0.82, green: 0.86, blue: 0.90)
}

extension View {
    func claritasCard() -> some View {
        self
            .padding(16)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.claritasCardBorder, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.03), radius: 8, x: 0, y: 4)
    }
}
