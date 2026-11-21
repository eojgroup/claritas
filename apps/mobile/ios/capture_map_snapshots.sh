#!/usr/bin/env bash
set -euo pipefail
app_path="$1"
output_dir="$2"
mkdir -p "$output_dir"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")
devices_file=$(mktemp)
xcrun simctl list devices available --json > "$devices_file"
while IFS=' ' read -r kind device_id; do
  xcrun simctl boot "$device_id" || true
  xcrun simctl bootstatus "$device_id" -b
  xcrun simctl status_bar "$device_id" override --time '9:41' --batteryState charged --batteryLevel 100
  xcrun simctl install "$device_id" "$app_path"
  container_path=$(xcrun simctl get_app_container "$device_id" "$bundle_id" data)
  mkdir -p "$container_path/Documents"
  cp apps/mobile/ios/Tests/Fixtures/MapOverview.json "$container_path/Documents/MapOverview.json"
  cp apps/mobile/ios/Tests/Fixtures/DailyBriefing.json "$container_path/Documents/DailyBriefing.json"
  for destination in map briefing; do
    for appearance in dark light; do
      rm -f "$container_path/Documents/map-review-ready" "$container_path/Documents/map-review-error"
      launch_args=(-qa-map-snapshot)
      suffix=""
      prefix="$kind"
      if [[ "$destination" == briefing ]]; then launch_args+=(-qa-briefing-snapshot); prefix="$kind-briefing"; fi
      if [[ "$appearance" == light ]]; then launch_args+=(-qa-map-light); suffix="-light"; fi
      xcrun simctl launch "$device_id" "$bundle_id" "${launch_args[@]}"
      ready=false
      for _attempt in $(seq 1 30); do
        if [[ -f "$container_path/Documents/map-review-error" ]]; then cat "$container_path/Documents/map-review-error"; exit 1; fi
        if [[ -f "$container_path/Documents/map-review-ready" ]]; then ready=true; break; fi
        sleep 1
      done
      [[ "$ready" == true ]] || { echo 'Native map review did not load'; exit 1; }
      sleep 3
      xcrun simctl io "$device_id" screenshot "$output_dir/$prefix$suffix.png"
      xcrun simctl terminate "$device_id" "$bundle_id"
    done
  done
  xcrun simctl shutdown "$device_id"
done < <(python3 - "$devices_file" <<'PY'
import json,sys
inventory=json.load(open(sys.argv[1]))['devices']
for kind,prefix in [('iphone','iPhone'),('ipad','iPad')]:
    candidates=[d for runtime,devices in sorted(inventory.items(),reverse=True) if '.iOS-' in runtime for d in devices if d['name'].startswith(prefix)]
    if not candidates: raise SystemExit('Missing '+kind+' simulator')
    print(kind,candidates[0]['udid'])
PY
)
[[ -f "$output_dir/iphone.png" && -f "$output_dir/ipad.png" && -f "$output_dir/iphone-light.png" && -f "$output_dir/ipad-light.png" ]]
[[ -f "$output_dir/iphone-briefing.png" && -f "$output_dir/ipad-briefing.png" && -f "$output_dir/iphone-briefing-light.png" && -f "$output_dir/ipad-briefing-light.png" ]]
rm -f "$devices_file"
