# Fetch CDN Scenario

Shared GitHub Actions composite action that provides CDN campaign promotion test infrastructure for both Elementor Core and Elementor Pro.

## Overview

This action consolidates the CDN test infrastructure previously duplicated in [elementor/elementor#38251](https://github.com/elementor/elementor/pull/38251) and [elementor/elementor-pro#7989](https://github.com/elementor/elementor-pro/pull/7989). It provides:

1. **Fetch script** (`fetch-cdn-scenario.mjs`) - Downloads the current CDN JSON files into a `live` scenario, with retries, a request timeout and optional failure tolerance
2. **Mock mu-plugin** (`mock-editor-assets-cdn.php`) - Answers WordPress requests to `assets.elementor.com` from local fixtures instead of the live CDN
3. **Shared fixtures** - The `no-promotion` scenario (the default, current CDN content) and the `active-campaign` scenario (a campaign with `e2e-` texts and links that differ from every Core default)

## Mocked CDN files

| CDN path                                        | Used by                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `editor-promotions/v1/*.json`                   | Plugins page, admin menu, conversion banner, pointer, editor |
| `notifications/v1/notifications.json`           | What's New                                                   |
| `home-screen/v1/home-screen.json`               | Home screen, including the sidebar banner for each tier      |
| `packages/v1/promotions.json`                   | V4 (atomic) promotions, `elementor.config.v4Promotions`      |
| `free-to-pro-upsell/v1/free-to-pro-upsell.json` | Widget upsell images, `elementorPromotionsData`              |

A CDN file without a fixture is not mocked and reaches the live CDN, so a new CDN file needs a fixture here, a path in `CDN_PATHS` and its cache option in `ELEMENTOR_E2E_CDN_CACHE_OPTIONS`.

The `active-campaign` scenario gives every case a value that the live CDN and the defaults do not have, so a test that finds it proves the mock answered:

- What's New: a Free-only card, a Pro-only card and a card for everyone
- Home screen sidebar: a different `e2e-campaign-home-sidebar-*` link and `e2e-campaign-*.svg` image URL for the `free`, `essential`, `essential-oct2023` and `expired` tiers

The fixtures hold JSON only. The browser loads images from the CDN itself, not through the mock, and the `e2e-campaign-*.svg` images do not exist there: the tests check the image URL, not the picture.

## Features

- **Retries**: Up to 3 attempts per file, waiting 2s and then 4s
- **Timeout**: 15s per request
- **Graceful failure**: `allow-failure` lets WordPress start even if the CDN is down. The previous `live` scenario is kept.
- **Atomic updates**: Files are fetched into a staging directory, which replaces `live` only when every file succeeded
- **Flexible source**: The live CDN (`assets.elementor.com`), staging CDN (`assets.stg.elementor.red`), or a local directory

## Inputs

| Input            | Description                                                                                  | Required | Default                        |
| ---------------- | -------------------------------------------------------------------------------------------- | -------- | ------------------------------ |
| `output-dir`     | Directory of the `live` scenario. The shared scenarios are copied next to it.                | **Yes**  | -                              |
| `fetch-live`     | Fetch the live CDN into `output-dir`. Set to `false` on PR CI to stay offline.               | No       | `true`                         |
| `cdn-source`     | CDN source URL or local directory, empty means the production CDN                            | No       | `https://assets.elementor.com` |
| `allow-failure`  | Allow WordPress to start if the fetch fails                                                  | No       | `false`                        |
| `mu-plugins-dir` | Directory to copy the mock mu-plugin into                                                    | No       | `''`                           |
| `copy-fixtures`  | Copy the shared `no-promotion` and `active-campaign` scenarios to the parent of `output-dir` | No       | `true`                         |

## Usage

PR CI runs offline against the shared fixtures. A scheduled job fetches the live CDN and runs the promotion tests against it with `E2E_CDN_SCENARIO=live`, so a broken live campaign is reported within a day.

### PR CI

```yaml
- name: Setup CDN promotion fixtures
  uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@<sha>
  with:
    output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
    mu-plugins-dir: tests/playwright/mu-plugins
    fetch-live: false
```

### Nightly live CDN check

```yaml
- name: Fetch live CDN scenario
  uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@<sha>
  with:
    output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
    mu-plugins-dir: tests/playwright/mu-plugins

- name: Run promotion tests against the live CDN
  env:
    E2E_CDN_SCENARIO: live
  run: npx playwright test --grep @promotions
```

`fetch-live` keeps `allow-failure: false` here on purpose: a CDN that cannot be fetched fails the job.

## Advanced Usage

### Testing a campaign before it goes live

**Core example**:

```yaml
- name: Fetch CDN from local editor-assets build
  uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
  with:
    cdn-source: ../editor-assets/out
    output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
    mu-plugins-dir: tests/playwright/mu-plugins
```

**Staging example**: every editor-assets pull request to `master` is deployed to `https://assets.stg.elementor.red`.

```yaml
- name: Fetch CDN from staging
  uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
  with:
    cdn-source: https://assets.stg.elementor.red
    output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
    mu-plugins-dir: tests/playwright/mu-plugins
    allow-failure: true
```

### Skip copying fixtures (if you have custom ones)

```yaml
- uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
  with:
    output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
    mu-plugins-dir: tests/playwright/mu-plugins
    copy-fixtures: false
```

## How It Works

1. **Fetch**: Downloads the mocked CDN files from the source into a staging directory
2. **Atomic swap**: The staging directory replaces `output-dir` only when every file succeeded
3. **Missing files**: A file that the source does not have is skipped with a warning, and the default scenario answers for it
4. **Mock plugin**: The mu-plugin answers `assets.elementor.com` requests from the fixtures of the selected scenario, or of the default scenario
5. **Scenarios**: Tests select a scenario with the `e2e_cdn_scenario` cookie. A non-default scenario skips the CDN cache options, so its data never reaches requests of the default scenario.

## Related

- Core PR: [elementor/elementor#38251](https://github.com/elementor/elementor/pull/38251)
- Pro PR: [elementor/elementor-pro#7989](https://github.com/elementor/elementor-pro/pull/7989)
- Jira: [ED-26391](https://elementor.atlassian.net/browse/ED-26391)
