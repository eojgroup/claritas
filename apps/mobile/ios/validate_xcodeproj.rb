#!/usr/bin/env ruby

require "json"
require "xcodeproj"

ROOT = File.expand_path(__dir__)
PROJECT_PATH = File.join(ROOT, "Claritas", "Claritas.xcodeproj")
PROJECT_DIR = File.dirname(PROJECT_PATH)

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
    bundle_suffix: nil,
    plist: File.join(ROOT, "Claritas", "Info.plist"),
    package_type: "APPL"
  },
  "Claritas Widgets" => {
    product_type: "com.apple.product-type.app-extension",
    sdk: "iphoneos",
    bundle_suffix: "widgets",
    plist: File.join(ROOT, "ClaritasWidgets", "Info.plist"),
    package_type: "XPC!"
  },
  "Claritas Watch App" => {
    product_type: "com.apple.product-type.application",
    sdk: "watchos",
    bundle_suffix: "watchkitapp",
    plist: File.join(ROOT, "ClaritasWatch", "Info.plist"),
    package_type: "APPL"
  },
  "Claritas Watch Widgets" => {
    product_type: "com.apple.product-type.app-extension",
    sdk: "watchos",
    bundle_suffix: "watchkitapp.widgets",
    plist: File.join(ROOT, "ClaritasWatchWidgets", "Info.plist"),
    package_type: "XPC!"
  }
}

app_group_specifications = {
  "Claritas" => ["CLARITAS_WIDGET_APP_GROUP", nil],
  "Claritas Widgets" => ["CLARITAS_WIDGET_APP_GROUP", nil],
  "Claritas Watch App" => ["CLARITAS_WATCH_WIDGET_APP_GROUP", "watch"],
  "Claritas Watch Widgets" => ["CLARITAS_WATCH_WIDGET_APP_GROUP", "watch"]
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
  release_settings = target.build_configurations.find { |configuration| configuration.name == "Release" }&.build_settings || {}
  expected_provisioning_style = release_settings["CODE_SIGN_STYLE"] == "Manual" ? "Manual" : "Automatic"
  check.call(
    attributes["ProvisioningStyle"] == expected_provisioning_style,
    "#{target_name} target provisioning style must match its Release configuration"
  )
  check.call(!attributes["DevelopmentTeam"].to_s.empty?, "#{target_name} must define a development team")

  target.build_configurations.each do |configuration|
    settings = configuration.build_settings
    prefix = "#{target_name} #{configuration.name}"
    expected_bundle_id = [resolved_bundle_anchor, specification[:bundle_suffix]].compact.join(".")
    check.call(settings["SDKROOT"] == specification[:sdk], "#{prefix} has the wrong SDK")
    check.call(settings["PRODUCT_BUNDLE_IDENTIFIER"] == expected_bundle_id, "#{prefix} has the wrong bundle identifier")
    check.call(
      !settings["PRODUCT_BUNDLE_IDENTIFIER"].to_s.include?("$("),
      "#{prefix} PRODUCT_BUNDLE_IDENTIFIER must be concrete"
    )
    app_group_setting, app_group_suffix = app_group_specifications.fetch(target_name)
    expected_app_group = ["group.#{resolved_bundle_anchor}", app_group_suffix].compact.join(".")
    check.call(settings[app_group_setting] == expected_app_group, "#{prefix} has the wrong App Group")
    check.call(!settings[app_group_setting].to_s.include?("$("), "#{prefix} App Group must be concrete")
    if configuration.name == "Release" && settings["CODE_SIGN_STYLE"] == "Manual"
      check.call(settings["CODE_SIGN_IDENTITY"] == "Apple Distribution", "#{prefix} manual signing must use Apple Distribution")
      check.call(!settings["PROVISIONING_PROFILE_SPECIFIER"].to_s.empty?, "#{prefix} manual signing must name a provisioning profile")
    else
      check.call(settings["CODE_SIGN_STYLE"] == "Automatic", "#{prefix} must use automatic signing")
    end
    check.call(!settings["DEVELOPMENT_TEAM"].to_s.empty?, "#{prefix} must define a development team")

    resolved_product_identifier = settings["PRODUCT_BUNDLE_IDENTIFIER"].to_s
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

  parent_suffix = specifications.fetch(parent_name).fetch(:bundle_suffix)
  child_suffix = specifications.fetch(child_name).fetch(:bundle_suffix)
  parent_id = [resolved_bundle_anchor, parent_suffix].compact.join(".")
  child_id = [resolved_bundle_anchor, child_suffix].compact.join(".")
  check.call(child_id.start_with?("#{parent_id}."), "#{child_name} bundle identifier must be prefixed by #{parent_name}")
end

watch_plist = Xcodeproj::Plist.read_from_path(specifications.fetch("Claritas Watch App").fetch(:plist))
check.call(
  watch_plist["WKCompanionAppBundleIdentifier"] == "$(CLARITAS_IOS_BUNDLE_IDENTIFIER)",
  "Watch app must identify its companion iOS app"
)
targets.fetch("Claritas Watch App").build_configurations.each do |configuration|
  check.call(
    configuration.build_settings["CLARITAS_IOS_BUNDLE_IDENTIFIER"] == resolved_bundle_anchor,
    "Claritas Watch App #{configuration.name} companion identifier must be concrete"
  )
end

accent_color_path = File.join(ROOT, "Claritas", "Assets.xcassets", "AccentColor.colorset", "Contents.json")
check.call(File.file?(accent_color_path), "Claritas must define the configured AccentColor asset")
if File.file?(accent_color_path)
  accent_color = JSON.parse(File.read(accent_color_path))
  check.call(!accent_color.fetch("colors", []).empty?, "Claritas AccentColor asset must contain a color")
end

world_countries_path = File.join(ROOT, "Claritas", "Resources", "WorldCountries.geojson")
check.call(File.file?(world_countries_path), "Claritas must bundle the Natural Earth country geometry")
if File.file?(world_countries_path)
  begin
    world_countries = JSON.parse(File.read(world_countries_path))
    features = world_countries.fetch("features", [])
    iso_codes = features.filter_map { |feature| feature.dig("properties", "iso2") }
    check.call(world_countries["type"] == "FeatureCollection", "WorldCountries.geojson must be a feature collection")
    check.call(features.length >= 170, "WorldCountries.geojson must retain global country coverage")
    check.call(iso_codes.length == iso_codes.uniq.length, "WorldCountries.geojson must contain unique ISO-2 features")
    dateline_jumps = features.flat_map do |feature|
      geometry = feature["geometry"] || {}
      polygons = geometry["type"] == "Polygon" ? [geometry["coordinates"]] : geometry["coordinates"] || []
      polygons.flat_map do |polygon|
        polygon.flat_map do |ring|
          ring.each_cons(2).filter_map do |left, right|
            [feature.dig("properties", "iso2"), (left[0].to_f - right[0].to_f).abs] if (left[0].to_f - right[0].to_f).abs > 180
          end
        end
      end
    end
    check.call(dateline_jumps.empty?, "WorldCountries.geojson must split rings at the antimeridian: #{dateline_jumps.inspect}")
  rescue JSON::ParserError => error
    errors << "WorldCountries.geojson is invalid JSON: #{error.message}"
  end

  ios_resources = targets.fetch("Claritas").resources_build_phase.files_references
  check.call(
    ios_resources.any? { |reference| File.expand_path(reference.real_path.to_s) == world_countries_path },
    "Claritas target must copy WorldCountries.geojson into the app bundle"
  )
end

if errors.any?
  warn errors.map { |error| "ERROR: #{error}" }.join("\n")
  exit 1
end

puts "Validated Apple targets, widget metadata, embedding, signing, and bundle identifier relationships."
