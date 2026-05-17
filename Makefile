.PHONY: test lint build build-chrome package-firefox package-chrome clean run run-chrome run-android run-android-nightly android-log android-enable-debug-emulator format format-check

EXT_DIR := .
BUILD_DIR := build
CHROME_BUILD_DIR := $(BUILD_DIR)/chrome
EXT_NAME := av-currencies
EXT_ID := av-by-currencies@redpandadev
ANDROID_APK ?= org.mozilla.fenix
ADB_DEVICE ?=
CHROME_BIN ?= chromium
CHROME_PROFILE_DIR ?= /tmp/$(EXT_NAME)-chrome-profile

test:
	npm run test

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
	rm -rf $(BUILD_DIR) coverage
	rm -f $(EXT_NAME)-firefox.zip $(EXT_NAME)-chrome.zip

run: lint
	npx web-ext run --source-dir $(EXT_DIR) --target firefox-desktop

run-chrome: package-chrome
	$(CHROME_BIN) --user-data-dir="$(CHROME_PROFILE_DIR)" --no-first-run --no-default-browser-check --disable-extensions-except="$(abspath $(CHROME_BUILD_DIR))" --load-extension="$(abspath $(CHROME_BUILD_DIR))"

run-android: lint
	npx web-ext run --source-dir $(EXT_DIR) --target firefox-android --adb-remove-old-artifacts $(if $(ADB_DEVICE),--adb-device $(ADB_DEVICE),)

run-android-nightly: lint
	npx web-ext run --source-dir $(EXT_DIR) --target firefox-android --firefox-apk $(ANDROID_APK) --adb-remove-old-artifacts $(if $(ADB_DEVICE),--adb-device $(ADB_DEVICE),)

android-enable-debug-emulator:
	@set -e; \
	ADB_ARGS="$(if $(ADB_DEVICE),-s $(ADB_DEVICE),)"; \
	adb $$ADB_ARGS wait-for-device; \
	adb $$ADB_ARGS root >/dev/null 2>&1 || true; \
	adb $$ADB_ARGS wait-for-device; \
	PROFILE=$$(adb $$ADB_ARGS shell "for d in /data/data/$(ANDROID_APK)/files/mozilla/*.default; do [ -d \"\$$d\" ] && { echo \"\$$d\"; break; }; done" | tr -d '\r'); \
	if [ -z "$$PROFILE" ]; then \
		echo "Profile not found for $(ANDROID_APK)."; \
		echo "Open Firefox once and enable 'Remote Debugging via USB' in Settings -> Developer tools."; \
		exit 1; \
	fi; \
	TMP_FILE="/tmp/$(EXT_NAME)-android-user.js"; \
	printf '%s\n' \
		'user_pref("devtools.debugger.remote-enabled", true);' \
		'user_pref("devtools.debugger.prompt-connection", false);' \
		'user_pref("devtools.chrome.enabled", true);' \
		> "$$TMP_FILE"; \
	adb $$ADB_ARGS shell am force-stop $(ANDROID_APK) || true; \
	adb $$ADB_ARGS push "$$TMP_FILE" "$$PROFILE/user.js" >/dev/null; \
	OWNER=$$(adb $$ADB_ARGS shell "stat -c '%u:%g' \"$$PROFILE/prefs.js\"" | tr -d '\r'); \
	adb $$ADB_ARGS shell "chmod 600 \"$$PROFILE/user.js\" && chown $$OWNER \"$$PROFILE/user.js\""; \
	echo "Remote debugging prefs written: $$PROFILE/user.js"

android-log:
	adb logcat | grep --line-buffered $(EXT_ID)
