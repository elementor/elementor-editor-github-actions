# Build Allure report

Composite action for Elementor Playwright CI: download merged `allure-results` shard artifacts, optionally preprocess them, generate an Allure HTML report, upload it as a short-lived workflow artifact, and publish to the shared GCS bucket.

The calling job checks out the repository first and sets `permissions` (`contents: read`, `id-token: write`, `actions: read`). Pass `gcs-upload: false` on fork pull requests (same guard Core and Pro use today).

## Usage

```yaml
permissions:
  contents: read
  id-token: write
  actions: read

steps:
  - uses: actions/checkout@v6

  - uses: elementor/elementor-editor-github-actions/actions/build-allure-report@main
    with:
      results-pattern: allure-results-*
      preprocess-command: node .github/scripts/retag-playwright-traces.js ./allure-results
      categories-file: tests/playwright/allure-categories.json
      gcs-bucket: ${{ vars.ALLURE_REPORTS_GCP_BUCKET }}
      gcs-dest: ${{ env.REPORT_PATH }}
      gcp-project-number: ${{ vars.ALLURE_REPORTS_GCP_PROJECT_NUMBER }}
      gcp-project-id: ${{ vars.ALLURE_REPORTS_GCP_PROJECT_ID }}
      report-url-base: https://elementor-allure-tests.prod.builder.elementor.red
      fail-on-upload-error: 'true'
```

Elementor Pro typically sets `preprocess-command` to `node .github/scripts/strip-non-trace-attachments.js ./allure-results` and keeps flaky-sheet steps in the caller job.

Report generation uses `npx --yes allure-commandline@<version>` only; no `npm ci` or repo dependency install is required for the preprocess scripts (Node built-ins).

## Inputs

| Input                  | Required | Default          | Description                                                         |
| ---------------------- | -------- | ---------------- | ------------------------------------------------------------------- |
| `results-pattern`      | yes      | —                | Artifact glob for `download-artifact`                               |
| `results-path`         | no       | `allure-results` | Merge/download directory for result JSON                            |
| `preprocess-command`   | no       | `''`             | Shell command after download (Core/Pro trace or attachment scripts) |
| `categories-file`      | no       | `''`             | Copied to `categories.json` under results when set                  |
| `gcs-upload`           | no       | `true`           | Set `false` to skip GCP auth and upload                             |
| `gcs-bucket`           | no       | `''`             | Bucket name without `gs://`                                         |
| `gcs-dest`             | no       | `''`             | Destination prefix; `main` restores `main/history` before generate  |
| `gcp-project-number`   | no       | `''`             | GCP project number for OIDC                                         |
| `gcp-project-id`       | no       | `''`             | GCP project ID for the GitHub Actions service account               |
| `report-url-base`      | no       | `''`             | Public report base URL for the job summary link                     |
| `artifact-name`        | no       | `allure-report`  | Workflow artifact name for the HTML report                          |
| `allure-version`       | no       | `2.41.0`         | `allure-commandline` version for `npx generate`                     |
| `fail-on-upload-error` | no       | `false`          | Fail the job when GCS upload fails (Core uses `true`)               |

## Outputs

| Output       | Description                                  |
| ------------ | -------------------------------------------- |
| `report-dir` | Generated report directory (`allure-report`) |
| `uploaded`   | `true` when GCS upload succeeded             |

Pin consumers to a commit SHA on `main` after merge instead of a floating `@main` ref in production workflows.
