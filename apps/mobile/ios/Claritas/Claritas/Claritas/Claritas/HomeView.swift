import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var auth: AuthViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "globe")
                    .imageScale(.large)
                    .foregroundStyle(.tint)
                Text("Welcome to Claritas!")
                    .font(.title2)

                Button("Log Out") {
                    auth.signOut()
                }
                .buttonStyle(.bordered)
                .padding(.top)

                Spacer()
            }
            .padding()
            .navigationTitle("Home")
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AuthViewModel())
}
