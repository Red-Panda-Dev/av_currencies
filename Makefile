.PHONY: test lint build clean run format format-check test-coverage

EXT_DIR := .
BUILD_DIR := build
EXT_NAME := av-currencies

test:
	npm run test:coverage

test-coverage:
	npm run test:coverage

format:
	npm run format

format-check:
	npm run format:check

lint:
	npx web-ext lint --source-dir $(EXT_DIR) --ignore-files "coverage/**" "node_modules/**" "tests/**" "examples/**"

build: format-check lint test
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)
	cp -r manifest.json background.js lib content popup icons $(BUILD_DIR)/
	cp examples/nbrb_response.json $(BUILD_DIR)/
	cd $(BUILD_DIR) && zip -r ../$(EXT_NAME).zip .
	@echo "Built: $(EXT_NAME).zip"

clean:
	rm -rf $(BUILD_DIR) coverage
	rm -f $(EXT_NAME).zip

run: lint
	npx web-ext run --source-dir $(EXT_DIR) --target firefox-desktop
