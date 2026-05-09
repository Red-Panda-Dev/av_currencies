.PHONY: test lint build build-chrome package-firefox package-chrome clean run run-chrome run-android run-android-nightly android-log android-enable-debug-emulator format format-check test-coverage

EXT_DIR := .
BUILD_DIR := build
FIREFOX_BUILD_DIR := $(BUILD_DIR)/firefox
CHROME_BUILD_DIR := $(BUILD_DIR)/chrome
EXT_NAME := av-currencies
EXT_ID := av-by-currencies@redpandadev
ANDROID_APK ?= org.mozilla.fenix
ADB_DEVICE ?=
CHROME_BIN ?= chromium
CHROME_PROFILE_DIR ?= /tmp/$(EXT_NAME)-chrome-profile

test:
	npm run test:coverage

test-coverage:
	npm run test:coverage

format:
	npm run format

format-check:
	npm run format:check

lint:
	npx web-ext lint --source-dir $(EXT_DIR) --ignore-files "coverage/**" "node_modules/**" "tests/**" "examples/**" "build/**" "*.zip"

package-firefox:
	rm -rf $(FIREFOX_BUILD_DIR)
	mkdir -p $(FIREFOX_BUILD_DIR)
	cp -r manifest.json background.js lib content popup icons $(FIREFOX_BUILD_DIR)/
	cp examples/nbrb_response.json $(FIREFOX_BUILD_DIR)/
	rm -f $(EXT_NAME)-firefox.zip
	cd $(FIREFOX_BUILD_DIR) && zip -r ../../$(EXT_NAME)-firefox.zip .
	@echo "Built: $(EXT_NAME)-firefox.zip"

build-chrome: format-check lint test package-chrome

package-chrome:
	node scripts/build-chrome.mjs
	rm -f $(EXT_NAME)-chrome.zip
	cd $(CHROME_BUILD_DIR) && zip -r ../../$(EXT_NAME)-chrome.zip . -x "*_metadata*"
	@echo "Built: $(EXT_NAME)-chrome.zip"

build: format-check lint test package-firefox package-chrome

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
