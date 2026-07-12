# Product Pulse Action

Uses Cursor Agent to decide whether a merged PR is product-facing, and if so, posts a
user-friendly pulse update to Slack. Ported from the `elementor` and `elementor-pro`
repos so both can share one implementation.

The full prompt (goal, decision criteria, writing style, output format, examples) lives
here in `prompt-template.md` and is shared by every caller. Each consuming repo only
keeps a small `product-areas.md` file with the three things that genuinely differ per
repo — `PRODUCT_NAME`, the `PRODUCT_AREAS` file-path mapping, and the `PRODUCT_ENUM`
list — plus a thin wrapper workflow that triggers on `pull_request: closed` and calls
this action. See `product-areas.example.md` for the expected format.

## Usage

```yaml
name: Product Pulse

on:
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  pull-requests: read

concurrency:
  group: product-pulse-${{ github.repository }}
  cancel-in-progress: false

jobs:
  product-pulse:
    if: github.event.pull_request.merged == true && startsWith(github.repository, 'elementor/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: elementor/elementor-editor-github-actions/actions/product-pulse@main
        with:
          pr-number: ${{ github.event.pull_request.number }}
          product-areas-file: .github/product-pulse-areas.md
          cursor-api-key: ${{ secrets.CURSOR_APIKEY }}
          slack-token: ${{ secrets.SLACK_TOKEN }}
          slack-channel-id: ${{ secrets.SLACK_PULSE_CHANNEL_ID }}
```

`.github/product-pulse-areas.md` in the caller repo:

```
PRODUCT_NAME: Elementor

PRODUCT_AREAS:
- `modules/editor-one/` → **"Editor"**
- `modules/ai/` → **"Elementor AI"**
- `core/`, `includes/`, and other paths not listed above → **"Elementor"**

PRODUCT_ENUM: "Elementor", "Editor", "Elementor AI"
```

## Inputs

| Input                 | Required | Default        | Description                                                              |
| --------------------- | -------- | -------------- | -------------------------------------------------------------------------- |
| `pr-number`           | yes      | –              | Merged PR number to generate the pulse for                               |
| `product-areas-file`  | yes      | –              | Path to the caller repo's `PRODUCT_NAME`/`PRODUCT_AREAS`/`PRODUCT_ENUM` file |
| `model`               | no       | `composer-2.5` | Cursor Agent model used for generation                                   |
| `cursor-api-key`      | yes      | –              | Cursor Agent API key                                                     |
| `slack-token`         | yes      | –              | Slack bot token with `chat:write`                                        |
| `slack-channel-id`    | yes      | –              | Slack channel ID for pulse notifications                                 |

The full generic prompt lives in this action's `prompt-template.md` and is rendered
together with the caller's `product-areas-file` before being sent to Cursor Agent.
