# Task runner recipes (replaces the former Makefile). Run `just --list`.
# Environment overrides mirror the old Makefile's `VAR ?= default`:
#   ANDROID_APK, ADB_DEVICE, CHROME_BIN, CHROME_PROFILE_DIR

ext_dir := "."
build_dir := "build"
chrome_build_dir := build_dir / "chrome"
ext_name := "av-currencies"
ext_id := "av-by-currencies@redpandadev"
android_apk := env_var_or_default("ANDROID_APK", "org.mozilla.fenix")
adb_device := env_var_or_default("ADB_DEVICE", "")
chrome_bin := env_var_or_default("CHROME_BIN", "chromium")
chrome_profile_dir := env_var_or_default("CHROME_PROFILE_DIR", "/tmp/" + ext_name + "-chrome-profile")

adb_device_flag := if adb_device != "" { "--adb-device " + adb_device } else { "" }
adb_serial_flag := if adb_device != "" { "-s " + adb_device } else { "" }

# Run the extension Vitest suite with coverage
test:
    npm run test

# Run the Cloudflare Worker tests from worker/
test-worker:
    cd worker && npm run test

# Build and deploy the Worker via worker/deploy.sh
deploy-worker:
    cd worker && ./deploy.sh

# Apply Prettier to the configured files
format:
    npm run format

# Check formatting without writing (npm run format:check)
lint:
    npm run format:check

# Build the Firefox package (build/firefox + av-currencies-firefox.zip)
package-firefox:
    npm run package:firefox

# Format, lint, test, then build the Chrome package
build-chrome: format lint test package-chrome

# Build the Chrome package (build/chrome + av-currencies-chrome.zip)
package-chrome:
    npm run package:chrome

# Format, lint, test, then build both browser packages
build: format lint test package-firefox package-chrome

# Remove build output, coverage, and package zips
clean:
    rm -rf {{build_dir}} coverage
    rm -f {{ext_name}}-firefox.zip {{ext_name}}-chrome.zip

# Run the extension in Firefox desktop via web-ext
run: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-desktop

# Run the extension in Chrome/Chromium with a throwaway profile
run-chrome: package-chrome
    {{chrome_bin}} --user-data-dir="{{chrome_profile_dir}}" --no-first-run --no-default-browser-check --disable-extensions-except="{{absolute_path(chrome_build_dir)}}" --load-extension="{{absolute_path(chrome_build_dir)}}"

# Run the extension in Firefox for Android via web-ext
run-android: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-android --adb-remove-old-artifacts {{adb_device_flag}}

# Run the extension in Firefox for Android Nightly (ANDROID_APK) via web-ext
run-android-nightly: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-android --firefox-apk {{android_apk}} --adb-remove-old-artifacts {{adb_device_flag}}

# Enable remote debugging on a connected Android Firefox (ADB_DEVICE to pick a device)
android-enable-debug-emulator:
    #!/usr/bin/env bash
    set -e
    adb {{adb_serial_flag}} wait-for-device
    adb {{adb_serial_flag}} root >/dev/null 2>&1 || true
    adb {{adb_serial_flag}} wait-for-device
    PROFILE=$(adb {{adb_serial_flag}} shell "for d in /data/data/{{android_apk}}/files/mozilla/*.default; do [ -d \"$d\" ] && { echo \"$d\"; break; }; done" | tr -d '\r')
    if [ -z "$PROFILE" ]; then
        echo "Profile not found for {{android_apk}}."
        echo "Open Firefox once and enable 'Remote Debugging via USB' in Settings -> Developer tools."
        exit 1
    fi
    TMP_FILE="/tmp/{{ext_name}}-android-user.js"
    printf '%s\n' \
        'user_pref("devtools.debugger.remote-enabled", true);' \
        'user_pref("devtools.debugger.prompt-connection", false);' \
        'user_pref("devtools.chrome.enabled", true);' \
        > "$TMP_FILE"
    adb {{adb_serial_flag}} shell am force-stop {{android_apk}} || true
    adb {{adb_serial_flag}} push "$TMP_FILE" "$PROFILE/user.js" >/dev/null
    OWNER=$(adb {{adb_serial_flag}} shell "stat -c '%u:%g' \"$PROFILE/prefs.js\"" | tr -d '\r')
    adb {{adb_serial_flag}} shell "chmod 600 \"$PROFILE/user.js\" && chown $OWNER \"$PROFILE/user.js\""
    echo "Remote debugging prefs written: $PROFILE/user.js"

# Stream adb logcat filtered to the extension ID
android-log:
    adb logcat | grep --line-buffered {{ext_id}}
