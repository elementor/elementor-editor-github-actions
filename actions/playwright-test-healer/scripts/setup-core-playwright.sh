#!/bin/bash
# Starts Core's Playwright environment the way playwright-suite.yml does, with
# the plugin already in ./build, so a test re-runs on the stack it failed on.
#
#   PHP_VERSION  PHP the evidence run used; empty keeps the config's default.
#   WP_NIGHTLY   "true" when the evidence run moved WordPress to nightly. That
#                also exports WP_VERSION and WP_MAJOR_VERSION, which some
#                snapshot names depend on.
set -euo pipefail

CONFIG=./tests/playwright/.playwright-wp-lite-env.json
WP_NIGHTLY_ZIP=https://wordpress.org/nightly-builds/wordpress-latest.zip
HELLO_THEME_ZIP=https://downloads.wordpress.org/theme/hello-elementor.zip
PORTS=(8888 8889)
# apt-get inside `playwright install --with-deps` can stall on a runner's
# package mirror with no output; a bounded retry beats a six-hour hang.
BROWSER_INSTALL_TIMEOUT=10m

wp_cli() {
	local port="$1"
	shift
	npx wp-lite-env cli --config="$CONFIG" --port="$port" --command="$*"
}

test -f ./build/elementor.php

npm run install:ci

curl -sSL --output hello-elementor.zip "$HELLO_THEME_ZIP"
unzip -qo hello-elementor.zip

if [ -n "${PHP_VERSION:-}" ]; then
	jq --arg php_version "$PHP_VERSION" '.phpVersion = $php_version' "$CONFIG" > "$RUNNER_TEMP/wp-lite-env.json"
	mv "$RUNNER_TEMP/wp-lite-env.json" "$CONFIG"
fi

npm run start-local-server

if [ "${WP_NIGHTLY:-false}" = "true" ]; then
	for port in "${PORTS[@]}"; do
		wp_cli "$port" wp core update "$WP_NIGHTLY_ZIP"
	done
	echo "WP_VERSION=nightly" >> "$GITHUB_ENV"
	for port in "${PORTS[@]}"; do
		wp_cli "$port" wp core update-db
	done
	WP_MAJOR_VERSION=$(wp_cli "${PORTS[0]}" wp core version 2>&1 | grep -oE '^[0-9]+' | head -1)
	echo "WP_MAJOR_VERSION=${WP_MAJOR_VERSION}" >> "$GITHUB_ENV"
fi

install_browser() {
	timeout "$BROWSER_INSTALL_TIMEOUT" npx playwright install --with-deps chromium
}

npm run test:setup:playwright
if ! install_browser; then
	echo "::warning::Playwright browser install failed or stalled; retrying once."
	install_browser
fi
