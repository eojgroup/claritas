import SwiftUI

final class AuthViewModel: ObservableObject {
    @AppStorage("isLoggedIn") var isLoggedIn: Bool = false
    @Published var errorMessage: String? = nil

    func signIn(email: String, password: String) {
        // Reset any previous error
        errorMessage = nil

        // Very basic validation
        guard email.contains("@") else {
            errorMessage = "Enter a valid email address."
            return
        }
        guard password.count >= 4 else {
            errorMessage = "Password must be at least 4 characters."
            return
        }

        // Simulate success
        isLoggedIn = true
    }

    func signOut() {
        isLoggedIn = false
        errorMessage = nil
    }
}
