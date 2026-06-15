#!/usr/bin/env ruby

require "fileutils"
require "xcodeproj"

ROOT = File.expand_path(__dir__)
PROJECT_PATH = File.join(ROOT, "Claritas", "Claritas.xcodeproj")
IOS_SOURCE_ROOT = File.join(ROOT, "Claritas")
WATCH_SOURCE_ROOT = File.join(ROOT, "ClaritasWatch")
IPAD_SOURCE_ROOT = File.join(ROOT, "ClaritasPad")

bundle_id = ENV.fetch("BUNDLE_ID", "com.eojgroup.claritas")
watch_bundle_id = ENV.fetch("WATCH_BUNDLE_ID", "#{bundle_id}.watchkitapp")
ipad_bundle_id = ENV.fetch("IPAD_BUNDLE_ID", "#{bundle_id}.ipad")
development_team = ENV.fetch("DEVELOPMENT_TEAM", "VTBJTFDTQY")
ios_deployment_target = ENV.fetch("IOS_DEPLOYMENT_TARGET", "16.0")
ipados_deployment_target = ENV.fetch("IPADOS_DEPLOYMENT_TARGET", ios_deployment_target)
watchos_deployment_target = ENV.fetch("WATCHOS_DEPLOYMENT_TARGET", "10.0")

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH)
project.root_object.attributes["LastSwiftUpdateCheck"] = "1600"
project.root_object.attributes["LastUpgradeCheck"] = "1600"

ios_target = project.new_target(:application, "Claritas", :ios, ios_deployment_target)
ipad_target = project.new_target(:application, "Claritas iPad", :ios, ipados_deployment_target)
watch_target = project.new_target(:watch2_app, "Claritas Watch App", :watchos, watchos_deployment_target)

# Swift modules autolink these frameworks. Removing xcodeproj's version-pinned
# framework references keeps the generated project portable across Xcode SDKs.
[ios_target, ipad_target, watch_target].each do |target|
  target.frameworks_build_phase.files.each(&:remove_from_project)
end
project.frameworks_group.children.each(&:remove_from_project)

def configure_target(target, settings)
  target.build_configurations.each do |configuration|
    configuration.build_settings.merge!(settings)
  end
end

configure_target(
  ios_target,
  {
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor",
    "CODE_SIGN_STYLE" => "Automatic",
    "CURRENT_PROJECT_VERSION" => "1",
    "DEVELOPMENT_TEAM" => development_team,
    "GENERATE_INFOPLIST_FILE" => "NO",
    "INFOPLIST_FILE" => "Info.plist",
    "INFOPLIST_KEY_CFBundleDisplayName" => "Claritas",
    "INFOPLIST_KEY_LSApplicationCategoryType" => "public.app-category.news",
    "IPHONEOS_DEPLOYMENT_TARGET" => ios_deployment_target,
    "MARKETING_VERSION" => "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER" => bundle_id,
    "SDKROOT" => "iphoneos",
    "SWIFT_VERSION" => "5.0",
    "TARGETED_DEVICE_FAMILY" => "1"
  }
)

configure_target(
  ipad_target,
  {
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor",
    "CODE_SIGN_STYLE" => "Automatic",
    "CURRENT_PROJECT_VERSION" => "1",
    "DEVELOPMENT_TEAM" => development_team,
    "GENERATE_INFOPLIST_FILE" => "NO",
    "INFOPLIST_FILE" => "../ClaritasPad/Info.plist",
    "INFOPLIST_KEY_CFBundleDisplayName" => "Claritas",
    "INFOPLIST_KEY_LSApplicationCategoryType" => "public.app-category.news",
    "IPHONEOS_DEPLOYMENT_TARGET" => ipados_deployment_target,
    "MARKETING_VERSION" => "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER" => ipad_bundle_id,
    "SDKROOT" => "iphoneos",
    "SUPPORTS_MACCATALYST" => "NO",
    "SWIFT_VERSION" => "5.0",
    "TARGETED_DEVICE_FAMILY" => "2"
  }
)

configure_target(
  watch_target,
  {
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor",
    "CLARITAS_IOS_BUNDLE_IDENTIFIER" => bundle_id,
    "CODE_SIGN_STYLE" => "Automatic",
    "CURRENT_PROJECT_VERSION" => "1",
    "DEVELOPMENT_TEAM" => development_team,
    "GENERATE_INFOPLIST_FILE" => "NO",
    "INFOPLIST_FILE" => "../ClaritasWatch/Info.plist",
    "INFOPLIST_KEY_CFBundleDisplayName" => "Claritas",
    "MARKETING_VERSION" => "1.0",
    "PRODUCT_BUNDLE_IDENTIFIER" => watch_bundle_id,
    "SDKROOT" => "watchos",
    "SKIP_INSTALL" => "YES",
    "SWIFT_VERSION" => "5.0",
    "TARGETED_DEVICE_FAMILY" => "4",
    "WATCHOS_DEPLOYMENT_TARGET" => watchos_deployment_target
  }
)

root_group = project.main_group
ios_group = root_group.new_group("Claritas")
ipad_group = root_group.new_group("ClaritasPad", "../ClaritasPad")
watch_group = root_group.new_group("ClaritasWatch", "../ClaritasWatch")

def add_files(group, base_path, relative_paths)
  relative_paths.to_h do |relative_path|
    absolute_path = File.join(base_path, relative_path)
    raise "Missing file: #{absolute_path}" unless File.file?(absolute_path) || File.directory?(absolute_path)
    [relative_path, group.new_file(relative_path)]
  end
end

ios_swift_paths = Dir.chdir(IOS_SOURCE_ROOT) { Dir.glob("**/*.swift").sort }
ios_resource_paths = ["Assets.xcassets", "Config.plist"]
ios_refs = add_files(ios_group, IOS_SOURCE_ROOT, ios_swift_paths + ios_resource_paths + ["Info.plist"])

watch_swift_paths = Dir.chdir(WATCH_SOURCE_ROOT) { Dir.glob("**/*.swift").sort }
watch_resource_paths = ["Assets.xcassets", "Config.plist"]
watch_refs = add_files(watch_group, WATCH_SOURCE_ROOT, watch_swift_paths + watch_resource_paths + ["Info.plist"])

ipad_swift_paths = Dir.chdir(IPAD_SOURCE_ROOT) { Dir.glob("**/*.swift").sort }
ipad_resource_paths = ["Assets.xcassets", "Config.plist"]
ipad_refs = add_files(ipad_group, IPAD_SOURCE_ROOT, ipad_swift_paths + ipad_resource_paths + ["Info.plist"])

ios_swift_paths.each { |path| ios_target.source_build_phase.add_file_reference(ios_refs.fetch(path)) }
ios_resource_paths.each { |path| ios_target.resources_build_phase.add_file_reference(ios_refs.fetch(path)) }

ios_swift_paths.reject { |path| path == "App.swift" }.each do |path|
  ipad_target.source_build_phase.add_file_reference(ios_refs.fetch(path))
end
ipad_swift_paths.each { |path| ipad_target.source_build_phase.add_file_reference(ipad_refs.fetch(path)) }
ipad_resource_paths.each { |path| ipad_target.resources_build_phase.add_file_reference(ipad_refs.fetch(path)) }

watch_swift_paths.each { |path| watch_target.source_build_phase.add_file_reference(watch_refs.fetch(path)) }
["Models/Models.swift", "Services/APIClient.swift"].each do |path|
  watch_target.source_build_phase.add_file_reference(ios_refs.fetch(path))
end
watch_resource_paths.each { |path| watch_target.resources_build_phase.add_file_reference(watch_refs.fetch(path)) }

ios_target.add_dependency(watch_target)
embed_watch = ios_target.new_copy_files_build_phase("Embed Watch Content")
embed_watch.dst_subfolder_spec = "16"
watch_product = embed_watch.add_file_reference(watch_target.product_reference)
watch_product.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

project.root_object.attributes["TargetAttributes"] = {
  ios_target.uuid => { "DevelopmentTeam" => development_team, "ProvisioningStyle" => "Automatic" },
  ipad_target.uuid => { "DevelopmentTeam" => development_team, "ProvisioningStyle" => "Automatic" },
  watch_target.uuid => { "DevelopmentTeam" => development_team, "ProvisioningStyle" => "Automatic" }
}

project.save
puts "Generated #{PROJECT_PATH}"
puts "iOS target: #{bundle_id}"
puts "iPadOS target: #{ipad_bundle_id}"
puts "watchOS target: #{watch_bundle_id}"
