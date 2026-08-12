#!/usr/bin/env ruby

require "base64"
require "cgi"
require "fileutils"
require "json"
require "net/http"
require "openssl"
require "open3"
require "time"
require "uri"

API_ROOT = "https://api.appstoreconnect.apple.com"

def required_environment(name)
  value = ENV[name].to_s.strip
  abort "Missing #{name}" if value.empty?
  value
end

def base64url(value)
  Base64.urlsafe_encode64(value, padding: false)
end

def raw_es256_signature(der_signature)
  sequence = OpenSSL::ASN1.decode(der_signature)
  sequence.value.map { |part| part.value.to_s(2).rjust(32, "\0")[-32, 32] }.join
end

def jwt(key_id:, issuer_id:, private_key_path:)
  header = base64url(JSON.generate({ alg: "ES256", kid: key_id, typ: "JWT" }))
  now = Time.now.to_i
  payload = base64url(JSON.generate({ iss: issuer_id, iat: now, exp: now + 1_000, aud: "appstoreconnect-v1" }))
  signing_input = "#{header}.#{payload}"
  key = OpenSSL::PKey::EC.new(File.read(private_key_path))
  signature = raw_es256_signature(key.dsa_sign_asn1(OpenSSL::Digest::SHA256.digest(signing_input)))
  "#{signing_input}.#{base64url(signature)}"
end

def request_json(method, path, token, body: nil)
  uri = URI.join(API_ROOT, path)
  request_class = { get: Net::HTTP::Get, post: Net::HTTP::Post }.fetch(method)
  request = request_class.new(uri)
  request["Authorization"] = "Bearer #{token}"
  request["Content-Type"] = "application/json"
  request.body = JSON.generate(body) if body
  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(request) }
  parsed = JSON.parse(response.body.empty? ? "{}" : response.body)
  return parsed if response.code.to_i.between?(200, 299)
  abort "App Store Connect #{method.to_s.upcase} #{path} failed (HTTP #{response.code}): #{parsed.fetch("errors", parsed).to_json}"
end

def normalized_serial(value)
  value.to_s.upcase.gsub(/[^0-9A-F]/, "").sub(/\A0+/, "")
end

def profile_certificate_ids(profile_id, token)
  request_json(:get, "/v1/profiles/#{profile_id}/relationships/certificates", token)
    .fetch("data", [])
    .map { |item| item.fetch("id") }
end

def active_profile?(profile)
  attributes = profile.fetch("attributes", {})
  return false unless attributes.fetch("profileState", "ACTIVE") == "ACTIVE"
  expiration = attributes["expirationDate"]
  expiration.nil? || Time.iso8601(expiration) > Time.now + 86_400
rescue ArgumentError
  false
end

def install_profile(profile, directory)
  profile_id = profile.fetch("id")
  attributes = profile.fetch("attributes")
  content = attributes["profileContent"]
  abort "Profile #{profile_id} did not include downloadable content" if content.to_s.empty?
  path = File.join(directory, "#{profile_id}.mobileprovision")
  File.binwrite(path, Base64.strict_decode64(content))
  decoded = "#{path}.plist"
  stdout, stderr, status = Open3.capture3("security", "cms", "-D", "-i", path, "-o", decoded)
  unless status.success?
    diagnostic = stderr.to_s.strip.empty? ? stdout.to_s.strip : stderr.to_s.strip
    abort "Could not decode profile #{profile_id}: #{diagnostic}"
  end
  name, name_error, name_status = Open3.capture3("/usr/libexec/PlistBuddy", "-c", "Print:Name", decoded)
  abort "Could not read profile name #{profile_id}: #{name_error}" unless name_status.success?
  File.delete(decoded)
  name.strip
end

key_id = required_environment("APP_STORE_CONNECT_KEY_ID")
issuer_id = required_environment("APP_STORE_CONNECT_ISSUER_ID")
private_key_path = required_environment("APP_STORE_CONNECT_PRIVATE_KEY_PATH")
certificate_path = required_environment("DISTRIBUTION_CERTIFICATE_PATH")
team_id = required_environment("DEVELOPMENT_TEAM")
bundle_id = required_environment("APP_BUNDLE_ID")
github_env = required_environment("GITHUB_ENV")
runner_temp = required_environment("RUNNER_TEMP")

token = jwt(key_id: key_id, issuer_id: issuer_id, private_key_path: private_key_path)
certificate = OpenSSL::X509::Certificate.new(File.read(certificate_path))
certificate_serial = normalized_serial(certificate.serial.to_s(16))
certificates = request_json(:get, "/v1/certificates?filter%5BcertificateType%5D=DISTRIBUTION&limit=200", token).fetch("data", [])
certificate_resource = certificates.find do |item|
  normalized_serial(item.dig("attributes", "serialNumber")) == certificate_serial
end
abort "The imported Apple Distribution certificate is not active in App Store Connect for this API key's team" unless certificate_resource
certificate_id = certificate_resource.fetch("id")

identifiers = [
  bundle_id,
  "#{bundle_id}.widgets",
  "#{bundle_id}.watchkitapp",
  "#{bundle_id}.watchkitapp.widgets"
]
profile_directory = File.join(Dir.home, "Library", "MobileDevice", "Provisioning Profiles")
xcode_profile_directory = File.join(Dir.home, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles")
FileUtils.mkdir_p(profile_directory)
FileUtils.mkdir_p(xcode_profile_directory)
profile_names = {}

identifiers.each do |identifier|
  encoded_identifier = URI.encode_www_form_component(identifier)
  bundle_ids = request_json(:get, "/v1/bundleIds?filter%5Bidentifier%5D=#{encoded_identifier}&limit=2", token).fetch("data", [])
  abort "Expected one registered bundle ID for #{identifier}, found #{bundle_ids.length}" unless bundle_ids.length == 1
  bundle_resource_id = bundle_ids.first.fetch("id")
  profiles = request_json(
    :get,
    "/v1/profiles?filter%5BbundleId%5D=#{bundle_resource_id}&filter%5BprofileType%5D=IOS_APP_STORE&limit=200",
    token
  ).fetch("data", [])
  profile = profiles.find do |candidate|
    active_profile?(candidate) && profile_certificate_ids(candidate.fetch("id"), token).include?(certificate_id)
  end

  unless profile
    profile_name = "Claritas CI #{identifier} #{certificate_serial[-8, 8]}"
    profile = request_json(
      :post,
      "/v1/profiles",
      token,
      body: {
        data: {
          type: "profiles",
          attributes: { name: profile_name, profileType: "IOS_APP_STORE" },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundle_resource_id } },
            certificates: { data: [{ type: "certificates", id: certificate_id }] }
          }
        }
      }
    ).fetch("data")
    puts "Created App Store provisioning profile for #{identifier}."
  end

  # List responses can omit the binary profile content; read the selected
  # profile explicitly before installing it.
  profile = request_json(:get, "/v1/profiles/#{profile.fetch("id")}", token).fetch("data")
  installed_name = install_profile(profile, profile_directory)
  installed_path = File.join(profile_directory, "#{profile.fetch("id")}.mobileprovision")
  FileUtils.cp(installed_path, File.join(xcode_profile_directory, File.basename(installed_path)))
  profile_names[identifier] = installed_name
  puts "Installed App Store profile for #{identifier}."
end

export_options_path = File.join(runner_temp, "Claritas-ExportOptions.plist")
profile_xml = profile_names.map do |identifier, profile_name|
  "        <key>#{CGI.escapeHTML(identifier)}</key>\n        <string>#{CGI.escapeHTML(profile_name)}</string>"
end.join("\n")
File.write(export_options_path, <<~PLIST)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
      <key>destination</key><string>export</string>
      <key>manageAppVersionAndBuildNumber</key><false/>
      <key>method</key><string>app-store-connect</string>
      <key>signingCertificate</key><string>Apple Distribution</string>
      <key>signingStyle</key><string>manual</string>
      <key>stripSwiftSymbols</key><true/>
      <key>teamID</key><string>#{CGI.escapeHTML(team_id)}</string>
      <key>uploadSymbols</key><true/>
      <key>provisioningProfiles</key>
      <dict>
#{profile_xml}
      </dict>
  </dict>
  </plist>
PLIST

File.open(github_env, "a") do |file|
  file.puts "RELEASE_PROVISIONING_PROFILES_JSON=#{JSON.generate(profile_names)}"
  file.puts "EXPORT_OPTIONS_PLIST=#{export_options_path}"
end
puts "Prepared deterministic App Store signing for #{profile_names.length} targets."
