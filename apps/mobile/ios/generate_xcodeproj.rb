#!/usr/bin/env ruby

require 'fileutils'
require 'xcodeproj'

ROOT = File.expand_path(File.join(__dir__, 'Claritas'))
APP_NAME = 'Claritas'
APP_ROOT = File.join(ROOT, APP_NAME)
BUNDLE_ID = ENV['BUNDLE_ID'] || 'com.eojgroup.claritas'
IOS_DEPLOYMENT = ENV['IOS_DEPLOYMENT_TARGET'] || '16.0'

def abort_with(msg)
  warn("[xcodeproj] #{msg}")
  exit(1)
end

abort_with('Swift sources not found') unless Dir.exist?(APP_ROOT)

def relative_to_app_root(path)
  path.delete_prefix("#{APP_ROOT}/")
end

def ignored_relative_path?(relative_path)
  parts = relative_path.split('/')
  return true if parts.empty?
  return true if parts.any? { |part| part.start_with?('.') }
  return true if parts.first == APP_NAME
  return true if parts.any? { |part| part.end_with?('Tests') || part.end_with?('UITests') }

  false
end

def collect_swift_sources
  Dir.glob(File.join(APP_ROOT, '**', '*.swift'))
    .map { |full| relative_to_app_root(full) }
    .reject { |rel| ignored_relative_path?(rel) }
    .uniq
    .sort
end

def collect_resources
  patterns = ['*.plist', '*.xcassets']
  files = patterns.flat_map { |pattern| Dir.glob(File.join(APP_ROOT, '**', pattern)) }

  files
    .map { |full| relative_to_app_root(full) }
    .reject { |rel| ignored_relative_path?(rel) }
    .uniq
    .sort
end

def warn_if_nested_project_exists
  nested_path = File.join(APP_ROOT, APP_NAME, "#{APP_NAME}.xcodeproj")
  return unless File.exist?(nested_path)

  warn("[xcodeproj] Found nested project at #{nested_path}.")
  warn("[xcodeproj] Use #{File.join(ROOT, "#{APP_NAME}.xcodeproj")} as the canonical app project.")
end

swift_sources = collect_swift_sources
abort_with('No Swift sources discovered under app root') if swift_sources.empty?

resources = collect_resources
%w[Info.plist Config.plist Assets.xcassets].each do |required|
  abort_with("Missing resource #{required}") unless resources.include?(required)
end

warn_if_nested_project_exists

proj_path = File.join(ROOT, "#{APP_NAME}.xcodeproj")
FileUtils.rm_rf(proj_path)
project = Xcodeproj::Project.new(proj_path)

main_group = project.main_group
app_group = main_group.new_group(APP_NAME)

target = project.new_target(:application, APP_NAME, :ios, IOS_DEPLOYMENT, nil, :swift)
target.frameworks_build_phase
target.resources_build_phase

swift_sources.each do |rel|
  full = File.join(APP_ROOT, rel)
  abort_with("Missing file #{rel}") unless File.exist?(full)
  file_ref = app_group.new_file(rel)
  target.add_file_references([file_ref])
end

# Resources
resources.each do |rel|
  full = File.join(APP_ROOT, rel)
  abort_with("Missing resource #{rel}") unless File.exist?(full)
  file_ref = app_group.new_file(rel)
  # Info.plist is processed via INFOPLIST_FILE and must not be copied as a resource.
  target.add_resources([file_ref]) unless rel == 'Info.plist'
end

# xcodeproj may still auto-insert Info.plist into Resources for application targets.
# Remove it explicitly so build settings own plist processing.
target.resources_build_phase.files
  .select { |build_file| build_file.file_ref&.path == "#{APP_NAME}/Info.plist" }
  .each { |build_file| target.resources_build_phase.remove_build_file(build_file) }

target.build_configuration_list.build_configurations.each do |config|
  settings = config.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  settings['INFOPLIST_FILE'] = "#{APP_NAME}/Info.plist"
  settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  settings['MARKETING_VERSION'] = '1.0'
  settings['CURRENT_PROJECT_VERSION'] = '1'
  settings['SWIFT_VERSION'] = '5.0'
  settings['IPHONEOS_DEPLOYMENT_TARGET'] = IOS_DEPLOYMENT
  settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  settings['CODE_SIGN_STYLE'] = 'Automatic'
  settings['DEVELOPMENT_TEAM'] = ENV['DEVELOPMENT_TEAM'] || ''
  # SwiftUI lifecycle does not need storyboard
  settings['UIApplicationSceneManifest'] = ''
end

# Keep UUIDs stable across regenerations to make CI diff checks reliable.
project.predictabilize_uuids if project.respond_to?(:predictabilize_uuids)
project.save
puts "Generated: #{proj_path}"
