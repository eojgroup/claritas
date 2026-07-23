#!/usr/bin/env ruby

require "xcodeproj"

ROOT = File.expand_path(__dir__)
PROJECT_PATH = File.join(ROOT, "Claritas", "Claritas.xcodeproj")
PROJECT_DIR = File.dirname(PROJECT_PATH)
BUNDLE_ANCHOR = "$(CLARITAS_BUNDLE_IDENTIFIER)"

errors = []
check = lambda do |condition, message|
  errors << message unless condition
end

project = Xcodeproj::Project.open(PROJECT_PATH)
targets = project.targets.to_h { |target| [target.name, target] }
target_attributes = project.root_object.attributes.fetch("TargetAttributes", {})

specifications = {
  "Claritas" => {
    product_type: "com.apple.product-type.application",
    sdk: "iphoneos",
    bundle_id: BUNDLE_ANCHOR,
    plist: File.join(ROOT, "Claritas", "Info.plist"),
    package_type: "APPL"
  },
  "Claritas Widgets" => {
    product_type: "com.apple.product-type.app-extension",
    sdk: "iphoneos",
    bundle_id: "#{BUNDLE_ANCHOR}.widgets",
    plist: File.join(ROOT, "ClaritasWidgets", "Info.plist"),
    package_type: "XPC!"
  },
  "Claritas Watch App" => {
    product_type: "com.apple.product-type.application",
    sdk: "watchos",
    bundle_id: "#{BUNDLE_ANCHOR}.watchkitapp",
    plist: File.join(ROOT, "ClaritasWatch", "Info.plist"),
    package_type: "APPL"
  },
  "Claritas Watch Widgets" => {
    product_type: "com.apple.product-type.app-extension",
    sdk: "watchos",
    bundle_id: "#{BUNDLE_ANCHOR}.watchkitapp.widgets",
    plist: File.join(ROOT, "ClaritasWatchWidgets", "Info.plist"),
    package_type: "XPC!"
  }
}

app_group_specifications = {
  "Claritas" => ["CLARITAS_WIDGET_APP_GROUP", "group.#{BUNDLE_ANCHOR}"],
  "Claritas Widgets" => ["CLARITAS_WIDGET_APP_GROUP", "group.#{BUNDLE_ANCHOR}"],
  "Claritas Watch App" => ["CLARITAS_WATCH_WIDGET_APP_GROUP", "group.#{BUNDLE_ANCHOR}.watch"],
  "Claritas Watch Widgets" => ["CLARITAS_WATCH_WIDGET_APP_GROUP", "group.#{BUNDLE_ANCHOR}.watch"]
}

project_bundle_ids = project.build_configurations.map do |configuration|
  value = configuration.build_settings["CLARITAS_BUNDLE_IDENTIFIER"].to_s
  check.call(!value.empty?, "Project #{configuration.name} must define CLARITAS_BUNDLE_IDENTIFIER")
  check.call(
    configuration.build_settings["REGISTER_APP_GROUPS"] == "YES",
    "Project #{configuration.name} must register App Groups for automatic signing"
  )
  value
end
check.call(project_bundle_ids.uniq.length == 1, "Project configurations must use the same CLARITAS_BUNDLE_IDENTIFIER")
resolved_bundle_anchor = project_bundle_ids.first.to_s
check.call(
  resolved_bundle_anchor.match?(/\A[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\z/),
  "CLARITAS_BUNDLE_IDENTIFIER must be a concrete reverse-DNS identifier"
)

identity_values = {
  "CFBundleExecutable" => "$(EXECUTABLE_NAME)",
  "CFBundleIdentifier" => "$(PRODUCT_BUNDLE_IDENTIFIER)",
  "CFBundleInfoDictionaryVersion" => "6.0",
  "CFBundleName" => "$(PRODUCT_NAME)",
  "CFBundleShortVersionString" => "$(MARKETING_VERSION)",
  "CFBundleVersion" => "$(CURRENT_PROJECT_VERSION)"
}

specifications.each do |target_name, specification|
  target = targets[target_name]
  unless target
    errors << "Missing target #{target_name}"
    next
  end

  check.call(target.product_type == specification[:product_type], "#{target_name} has the wrong product type")

  attributes = target_attributes.fetch(target.uuid, {})
  check.call(attributes["ProvisioningStyle"] == "Automatic", "#{target_name} must use automatic provisioning")
  check.call(!attributes["DevelopmentTeam"].to_s.empty?, "#{target_name} must define a development team")

  target.build_configurations.each do |configuration|
    settings = configuration.build_settings
    prefix = "#{target_name} #{configuration.name}"
    check.call(settings["SDKROOT"] == specification[:sdk], "#{prefix} has the wrong SDK")
    check.call(settings["PRODUCT_BUNDLE_IDENTIFIER"] == specification[:bundle_id], "#{prefix} has the wrong bundle identifier")
    app_group_setting, expected_app_group = app_group_specifications.fetch(target_name)
    check.call(settings[app_group_setting] == expected_app_group, "#{prefix} has the wrong App Group")
    check.call(settings["CODE_SIGN_STYLE"] == "Automatic", "#{prefix} must use automatic signing")
    check.call(!settings["DEVELOPMENT_TEAM"].to_s.empty?, "#{prefix} must define a development team")

    resolved_product_identifier = settings["PRODUCT_BUNDLE_IDENTIFIER"].to_s.sub(BUNDLE_ANCHOR, resolved_bundle_anchor)
    check.call(
      resolved_product_identifier.match?(/\A[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\z/),
      "#{prefix} resolves to an invalid bundle identifier"
    )
    check.call(
      !resolved_product_identifier.include?("CLARITAS-BUNDLE-IDENTIFIER"),
      "#{prefix} contains a sanitized, unresolved bundle identifier"
    )

    configured_plist = File.expand_path(settings.fetch("INFOPLIST_FILE"), PROJECT_DIR)
    check.call(configured_plist == specification[:plist], "#{prefix} points to the wrong Info.plist")
  end

  plist = Xcodeproj::Plist.read_from_path(specification[:plist])
  identity_values.each do |key, value|
    check.call(plist[key] == value, "#{target_name} Info.plist must set #{key} to #{value}")
  end
  check.call(plist["CFBundlePackageType"] == specification[:package_type], "#{target_name} has the wrong package type")

  next unless target_name.end_with?("Widgets")

  extension = plist.fetch("NSExtension", {})
  check.call(
    extension["NSExtensionPointIdentifier"] == "com.apple.widgetkit-extension",
    "#{target_name} must use the WidgetKit extension point"
  )
  check.call(
    !extension.key?("NSExtensionPrincipalClass"),
    "#{target_name} uses an @main WidgetBundle and must not define NSExtensionPrincipalClass"
  )
end

embedding_pairs = [
  ["Claritas", "Claritas Widgets", "13"],
  ["Claritas", "Claritas Watch App", "16"],
  ["Claritas Watch App", "Claritas Watch Widgets", "13"]
]

embedding_pairs.each do |parent_name, child_name, destination|
  parent = targets[parent_name]
  child = targets[child_name]
  next unless parent && child

  check.call(
    parent.dependencies.any? { |dependency| dependency.target == child },
    "#{parent_name} must depend on #{child_name}"
  )
  check.call(
    parent.copy_files_build_phases.any? do |phase|
      phase.dst_subfolder_spec == destination && phase.files_references.include?(child.product_reference)
    end,
    "#{parent_name} must embed #{child_name} in destination #{destination}"
  )

  parent_id = specifications.fetch(parent_name).fetch(:bundle_id)
  child_id = specifications.fetch(child_name).fetch(:bundle_id)
  check.call(child_id.start_with?("#{parent_id}."), "#{child_name} bundle identifier must be prefixed by #{parent_name}")
end

watch_plist = Xcodeproj::Plist.read_from_path(specifications.fetch("Claritas Watch App").fetch(:plist))
check.call(
  watch_plist["WKCompanionAppBundleIdentifier"] == "$(CLARITAS_IOS_BUNDLE_IDENTIFIER)",
  "Watch app must identify its companion iOS app"
)

if errors.any?
  warn errors.map { |error| "ERROR: #{error}" }.join("\n")
  exit 1
end

puts "Validated Apple targets, widget metadata, embedding, signing, and bundle identifier relationships."
