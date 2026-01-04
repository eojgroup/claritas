#!/usr/bin/env ruby

require 'fileutils'
require 'xcodeproj'

ROOT = File.expand_path(File.join(__dir__, 'Claritas'))
APP_NAME = 'Claritas'
BUNDLE_ID = ENV['BUNDLE_ID'] || 'com.eojgroup.claritas'
IOS_DEPLOYMENT = ENV['IOS_DEPLOYMENT_TARGET'] || '16.0'

def abort_with(msg)
  warn("[xcodeproj] #{msg}")
  exit(1)
end

abort_with('Swift sources not found') unless Dir.exist?(File.join(ROOT, APP_NAME))

proj_path = File.join(ROOT, "#{APP_NAME}.xcodeproj")
FileUtils.rm_rf(proj_path)
project = Xcodeproj::Project.new(proj_path)

main_group = project.main_group
app_group = main_group.new_group(APP_NAME, APP_NAME)

target = project.new_target(:application, APP_NAME, :ios, IOS_DEPLOYMENT, nil, :swift)
target.frameworks_build_phase
target.resources_build_phase

%w[
  App.swift
  AppModel.swift
  Models/Models.swift
  Services/APIClient.swift
  Views/RootView.swift
  Views/DashboardView.swift
  Views/NewsListView.swift
  Views/WeatherListView.swift
  Views/CountryProfileView.swift
].each do |rel|
  full = File.join(ROOT, APP_NAME, rel)
  abort_with("Missing file #{rel}") unless File.exist?(full)
  file_ref = app_group.new_file(File.join(APP_NAME, rel))
  target.add_file_references([file_ref])
end

# Resources
%w[
  Info.plist
  Config.plist
  Assets.xcassets
].each do |rel|
  full = File.join(ROOT, APP_NAME, rel)
  abort_with("Missing resource #{rel}") unless File.exist?(full)
  file_ref = app_group.new_file(File.join(APP_NAME, rel))
  target.add_resources([file_ref])
end

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

project.save
puts "Generated: #{proj_path}"

