#!/bin/bash
# Starts Pro's Playwright environment the way its playwright-test-setup action
# does with skip_cache_restore, against the builds already in the workspace.
# That action is not used here because it saves the dependency, Docker image
# and browser caches, and this job runs the agent's test code first: whatever
# that code leaves on disk would be served to every later run on the branch.
# Keep the steps in line with .github/actions/playwright-setup in Pro.
#
#   E2E_PRO_LICENSE  The licence to activate. A non-production one: the
#                    agent's code runs in this job and can read it.
#   PHP_VERSION      Defaults to 8.2, the action's default.
set -euo pipefail

test -d elementor-pro
test -f elementor.zip
test -d elementor

npm run install:ci
npm run composer:no-dev

bash ./.github/scripts/patch-wp-env.sh

PHP_VERSION="${PHP_VERSION:-8.2}" WP_CORE_VERSION=latest node ./.github/scripts/build-wp-env.js

npm run start-local-server

npm run import-sample-data
npm run import-taxonomy-sample-data

node ./.github/scripts/playwright-license-setup.js
npx wp-env run cli wp db query < query.sql

npx wp-env run cli bash -c 'bash elementor-config/setup-experiments.sh'
npx wp-env run cli bash -c 'bash elementor-config/reset-db-props.sh'
npm run deactivate-plugins

npx playwright install chromium
