// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ClaritasAppleModels",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "ClaritasAppleModels", targets: ["ClaritasAppleModels"])
    ],
    targets: [
        .target(
            name: "ClaritasAppleModels",
            path: "Claritas/Models",
            sources: ["Models.swift"]
        ),
        .testTarget(
            name: "ClaritasAppleModelsTests",
            dependencies: ["ClaritasAppleModels"],
            path: "Tests"
        )
    ]
)
