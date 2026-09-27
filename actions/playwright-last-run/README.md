# Playwright last-run (failed-only on re-run)

Lean composite actions for Elementor Playwright CI: **full shard on the first attempt**, **`--last-failed` only on GitHub Actions re-runs** when the prior attempt left failures in `.last-run.json`.

Uploads and downloads **only** `.last-run.json` (`retention-days: 1`). No test-results trees, traces, videos, or shared bootstrap state.

## Restore (before `playwright test`)

```yaml
- name: Restore Playwright last-run
  uses: elementor/elementor-editor-github-actions/actions/playwright-last-run/restore@main
  id: pw_last_run
  with:
    artifact-name: playwright-last-run-${{ matrix.shardIndex }}-${{ matrix.browser }}
    last-run-paths: |
      tests/playwright/test-results/.last-run.json

- name: Run Playwright
  run: npx playwright test --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }} ${{ steps.pw_last_run.outputs.extra_args }}
  env:
    PLAYWRIGHT_EXTRA_ARGS: ${{ steps.pw_last_run.outputs.extra_args }}
```

### Elementor Core (elements regression path)

```yaml
with:
  artifact-name: playwright-last-run-${{ matrix.shardIndex }}-${{ matrix.browser }}
  last-run-paths: |
    tests/elements-regression/test-results/.last-run.json
```

### Elementor Pro (single staged dir)

```yaml
with:
  artifact-name: playwright-last-run-${{ matrix.shardIndex }}
  last-run-paths: |
    playwright-last-run-ci/.last-run.json
```

Copy `.last-run.json` into `playwright-last-run-ci/` after the test step if your config writes elsewhere, or point `last-run-paths` at the real `test-results/.last-run.json` path.

## Save (after `playwright test`, typically `if: always()`)

```yaml
- name: Save Playwright last-run
  if: always()
  uses: elementor/elementor-editor-github-actions/actions/playwright-last-run/save@main
  with:
    artifact-name: playwright-last-run-${{ matrix.shardIndex }}-${{ matrix.browser }}
    last-run-paths: |
      tests/playwright/test-results/.last-run.json
```

Pro example:

```yaml
with:
  artifact-name: playwright-last-run-${{ matrix.shardIndex }}
  last-run-paths: |
    tests/playwright/test-results/.last-run.json
  staging-dir: playwright-last-run-ci
```

## Inputs

### `restore`

| Input            | Required | Default                         | Description                                      |
| ---------------- | -------- | ------------------------------- | ------------------------------------------------ |
| `artifact-name`  | yes      | —                               | Prior attempt artifact name                      |
| `last-run-paths` | yes      | —                               | Newline-separated `.last-run.json` or parent dir |
| `github-token`   | no       | `${{ github.token }}`           | Artifact download token                          |
| `download-path`  | no       | `.playwright-last-run-artifact` | Download directory                               |

### `save`

| Input            | Required | Default                       | Description                                  |
| ---------------- | -------- | ----------------------------- | -------------------------------------------- |
| `artifact-name`  | yes      | —                             | Artifact name for re-run restore             |
| `last-run-paths` | yes      | —                             | First path with non-empty `failedTests` wins |
| `staging-dir`    | no       | `playwright-last-run-staging` | Directory containing only `.last-run.json`   |

## Outputs

| Action  | Output       | Description                                                 |
| ------- | ------------ | ----------------------------------------------------------- |
| restore | `extra_args` | `""` or `--last-failed` (also sets `PLAYWRIGHT_EXTRA_ARGS`) |
| save    | `uploaded`   | `true` if an artifact was uploaded                          |

## Behavior

- `github.run_attempt == 1`: restore is a no-op; save still uploads when failures exist (for a later **Re-run failed jobs** / re-run).
- `github.run_attempt > 1`: restore downloads the artifact (missing artifact → full shard), restores files, sets `--last-failed` only when `failedTests` is a non-empty array (`jq`).
- `save` uploads with `include-hidden-files: true` so `.last-run.json` is not dropped by upload-artifact defaults.
- Requires `jq` on the runner (preinstalled on `ubuntu-latest`).

Pin consumers to a commit SHA on `main` after merge, e.g. `...@<sha>`, instead of a floating `@main` ref in production workflows.
