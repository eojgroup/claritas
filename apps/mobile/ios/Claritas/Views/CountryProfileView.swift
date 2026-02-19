import SwiftUI

struct CountryProfileView: View {
    let selectedCountry: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Country profile based on selection")
                .font(.headline)
            if let iso = selectedCountry {
                Text("Country: \(iso)")
                    .font(.subheadline)
                    .bold()
                Text("Recent items from this country in the list are highlighted by the country tag.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("Select a bubble on the map or a country tag in the list to see a brief profile.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
