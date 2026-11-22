#!/usr/bin/env bash
set -euo pipefail
app_path="$1"
output_dir="$2"
mkdir -p "$output_dir"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app_path/Info.plist")
devices_file=$(mktemp)
capture_failure() {
  python3 - "$device_id" "$output_dir/$prefix$suffix" <<'PY'
import subprocess,sys
device,prefix=sys.argv[1:]
commands=[['xcrun','simctl','io',device,'screenshot',prefix+'-failure.png'],
          ['xcrun','simctl','spawn',device,'log','show','--style','compact','--last','2m','--predicate','process == "Claritas"']]
with open(prefix+'-failure.log','w') as output:
    for command in commands:
        try: subprocess.run(command,stdout=output,stderr=subprocess.STDOUT,timeout=20,check=False)
        except Exception as error: output.write(str(error)+'\n')
PY
}
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
  cp apps/mobile/ios/Tests/Fixtures/WorldContext.json "$container_path/Documents/WorldContext.json"
  for destination in map briefing country event; do
    for appearance in dark light; do
      rm -f "$container_path/Documents/map-review-ready" "$container_path/Documents/map-review-error"
      launch_args=(-qa-map-snapshot)
      suffix=""
      prefix="$kind"
      if [[ "$destination" == briefing ]]; then launch_args+=(-qa-briefing-snapshot); prefix="$kind-briefing"; fi
      if [[ "$destination" == country ]]; then launch_args+=(-qa-country-snapshot); prefix="$kind-country"; fi
      if [[ "$destination" == event ]]; then launch_args+=(-qa-event-snapshot); prefix="$kind-event"; fi
      if [[ "$kind" == ipad && ( "$destination" == country || "$destination" == event ) ]]; then launch_args+=(-qa-landscape); fi
      if [[ "$appearance" == light ]]; then launch_args+=(-qa-map-light); suffix="-light"; fi
      xcrun simctl launch "$device_id" "$bundle_id" "${launch_args[@]}"
      ready=false
      # Cold hosted simulators can spend tens of seconds starting the scene.
      # This bounded bootstrap wait does not change production read budgets.
      for _attempt in $(seq 1 90); do
        if [[ -f "$container_path/Documents/map-review-error" ]]; then cat "$container_path/Documents/map-review-error"; capture_failure; exit 1; fi
        if [[ -f "$container_path/Documents/map-review-ready" ]]; then ready=true; break; fi
        sleep 1
      done
      [[ "$ready" == true ]] || { echo "Native $kind $destination $appearance review was not ready within 90 seconds"; capture_failure; exit 1; }
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
[[ -f "$output_dir/iphone-country.png" && -f "$output_dir/ipad-country.png" && -f "$output_dir/iphone-country-light.png" && -f "$output_dir/ipad-country-light.png" ]]
[[ -f "$output_dir/iphone-event.png" && -f "$output_dir/ipad-event.png" && -f "$output_dir/iphone-event-light.png" && -f "$output_dir/ipad-event-light.png" ]]
rm -f "$devices_file"
