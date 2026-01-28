//
//  ClaritasApp.swift
//  Claritas
//
//  Created by Lars E.O. Jacobson on 04/01/2026.
//

import SwiftUI

@main
struct ClaritasApp: App {
    @StateObject private var auth = AuthViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
        }
    }
}
