# Fetch CDN Scenario

Shared GitHub Actions composite action that provides CDN campaign promotion test infrastructure for both Elementor Core and Elementor Pro.

## Overview

This action consolidates the CDN test infrastructure previously duplicated in [elementor/elementor#38251](https://github.com/elementor/elementor/pull/38251) and [elementor/elementor-pro#7989](https://github.com/elementor/elementor-pro/pull/7989). It provides:

1. **Fetch script** (`fetch-cdn-scenario.mjs`) - Downloads current CDN JSON files with retry logic, timeout handling, and optional failure tolerance
2. **Mock mu-plugin** (`mock-editor-assets-cdn.php`) - Intercepts WordPress HTTP requests to serve local fixtures instead of live CDN
3. **Shared fixtures** - No-promotion scenario fixtures shared between Core and Pro

## Features

- **Retry logic**: Up to 3 attempts with exponential backoff (2s, 4s, 6s)
- **Timeout handling**: 15s request timeout per file
- **Graceful failure**: Optional `--allow-failure` to allow WordPress to start even if CDN is down
- **Atomic updates**: Fetches to staging directory and swaps in only on complete success
- **Flexible source**: Fetch from live CDN, custom URL, or local directory

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `cdn-source` | CDN source URL or local directory | No | `https://assets.elementor.com` |
| `allow-failure` | Allow WordPress to start if fetch fails | No | `false` |
| `output-dir` | Target directory for fetched CDN files | **Yes** | - |
| `mu-plugins-dir` | Target directory for mock mu-plugin | No | `''` |
| `copy-fixtures` | Copy shared no-promotion fixtures | No | `true` |

## Usage

### Elementor Core

**In your workflow** (e.g., `.github/workflows/playwright-suite.yml`):

```yaml
steps:
  - uses: actions/checkout@v6

  - name: Fetch live CDN scenario
    uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
    with:
      output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
      mu-plugins-dir: tests/playwright/mu-plugins
      copy-fixtures: true

  - name: Install WordPress environment
    run: npm run start-local-server
```

**Files you can delete from Core**:
- `scripts/fetch-live-cdn-scenario.mjs` ✓
- `tests/playwright/mu-plugins/mock-editor-assets-cdn.php` (replace with shared version)
- `tests/playwright/mu-plugins/editor-assets-cdn/no-promotion/**/*` (use shared fixtures)

**Keep in Core**:
- `tests/playwright/sanity/modules/promotions/campaign/campaign-promotions.test.ts`
- `tests/playwright/sanity/modules/promotions/campaign/cdn-scenario.ts`
- `tests/playwright/mu-plugins/editor-assets-cdn/live/` (git-ignored, populated by action)

**Update in Core**:
- Remove `npm run test:playwright:fetch-cdn` from `package.json` scripts
- Update workflows to use this action instead of the local script

### Elementor Pro

**In your workflow** (e.g., `start-local-server` script or workflow):

```yaml
steps:
  - uses: actions/checkout@v6

  - name: Fetch live CDN scenario with failure tolerance
    uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
    with:
      output-dir: tests/playwright/mu-plugins/editor-assets-cdn/live
      mu-plugins-dir: tests/playwright/mu-plugins
      allow-failure: true
      copy-fixtures: true

  - name: Start wp-env
    run: bash ./.github/scripts/start-wp-env.sh
```

**Files you can delete from Pro**:
- `scripts/fetch-live-cdn-scenario.mjs` ✓
- `tests/playwright/mu-plugins/mock-editor-assets-cdn.php` (replace with shared version)
- `tests/playwright/mu-plugins/editor-assets-cdn/no-promotion/**/*` (use shared fixtures)
- `tests/playwright/mu-plugins/editor-assets-cdn/active-campaign/**/*` (Pro-specific, keep if needed for Pro tests)

**Keep in Pro**:
- `tests/playwright/sanity/modules/promotions/cdn-free-promotions-hidden.test.ts`
- `tests/playwright/sanity/modules/promotions/cdn-scenario.ts`
- `tests/playwright/mu-plugins/editor-assets-cdn/live/` (git-ignored, populated by action)

**Update in Pro**:
- Remove `npm run test:playwright:fetch-cdn` from `package.json` scripts
- Update `start-local-server` to use this action instead of the local script

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

**Pro example**:
```yaml
- name: Fetch CDN from custom URL
  uses: elementor/elementor-editor-github-actions/actions/fetch-cdn-scenario@main
  with:
    cdn-source: https://staging.assets.elementor.com
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

1. **Fetch**: Downloads 10 CDN JSON files from the specified source
2. **Atomic swap**: Fetches to a temporary staging directory, then renames to target only on success
3. **Fallback**: If a file is missing from source, logs a warning and uses default scenario
4. **Mock plugin**: PHP mu-plugin intercepts `assets.elementor.com` requests and serves local fixtures
5. **Cookie-based scenarios**: Tests set `e2e_cdn_scenario` cookie to switch between scenarios

## Key Differences from Original PRs

| Feature | Core PR #38251 | Pro PR #7989 | Shared Action |
|---------|---------------|--------------|---------------|
| Timeout | ❌ None | ✅ 15s | ✅ 15s |
| Retry | ❌ None | ✅ 3 attempts | ✅ 3 attempts |
| `--allow-failure` | ❌ | ✅ | ✅ |
| Atomic staging | ❌ | ✅ | ✅ |
| Backoff | ❌ | ✅ Exponential | ✅ Exponential |

The shared action uses Pro's more robust implementation as the baseline.

## Migration Path

Both Core and Pro can migrate incrementally:

1. Keep existing `fetch-live-cdn-scenario.mjs` initially
2. Add this action to workflows alongside the local script
3. Verify tests pass with the action
4. Remove local script and update workflows to use only the action
5. Clean up fixture directories

## Related

- Core PR: [elementor/elementor#38251](https://github.com/elementor/elementor/pull/38251)
- Pro PR: [elementor/elementor-pro#7989](https://github.com/elementor/elementor-pro/pull/7989)
- Jira: [ED-26391](https://elementor.atlassian.net/browse/ED-26391)
