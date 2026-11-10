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

test:
    npm run test

test-worker:
    cd worker && npm run test

deploy-worker:
    cd worker && ./deploy.sh

format:
    npm run format

lint:
    npm run format:check

package-firefox:
    npm run package:firefox

build-chrome: format lint test package-chrome

package-chrome:
    npm run package:chrome

build: format lint test package-firefox package-chrome

clean:
    rm -rf {{build_dir}} coverage
    rm -f {{ext_name}}-firefox.zip {{ext_name}}-chrome.zip

run: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-desktop

run-chrome: package-chrome
    {{chrome_bin}} --user-data-dir="{{chrome_profile_dir}}" --no-first-run --no-default-browser-check --disable-extensions-except="{{absolute_path(chrome_build_dir)}}" --load-extension="{{absolute_path(chrome_build_dir)}}"

run-android: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-android --adb-remove-old-artifacts {{adb_device_flag}}

run-android-nightly: lint
    npx web-ext run --source-dir {{ext_dir}} --target firefox-android --firefox-apk {{android_apk}} --adb-remove-old-artifacts {{adb_device_flag}}

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

android-log:
    adb logcat | grep --line-buffered {{ext_id}}
