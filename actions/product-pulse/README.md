# Product Pulse Action

Uses Cursor Agent to decide whether a merged PR is product-facing, and if so, posts a
user-friendly pulse update to Slack. Ported from the `elementor` and `elementor-pro`
repos so both can share one implementation.

The full prompt (goal, decision criteria, writing style, output format, examples) lives
here in `prompt-template.md` and is shared by every caller. Each consuming repo just
passes its `product-name` (e.g. `"Elementor"` or `"Elementor Pro"`) plus a thin wrapper
workflow that triggers on `pull_request: closed` and calls this action.

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
          product-name: 'Elementor'
          cursor-api-key: ${{ secrets.CURSOR_APIKEY }}
          slack-token: ${{ secrets.SLACK_TOKEN }}
          slack-channel-id: ${{ secrets.SLACK_PULSE_CHANNEL_ID }}
```

## Inputs

| Input              | Required | Default        | Description                                      |
| ------------------ | -------- | -------------- | ------------------------------------------------ |
| `pr-number`        | yes      | –              | Merged PR number to generate the pulse for       |
| `product-name`     | yes      | –              | Product name used in the prompt and Slack header |
| `model`            | no       | `composer-2.5` | Cursor Agent model used for generation           |
| `cursor-api-key`   | yes      | –              | Cursor Agent API key                             |
| `slack-token`      | yes      | –              | Slack bot token with `chat:write`                |
| `slack-channel-id` | yes      | –              | Slack channel ID for pulse notifications         |

The full generic prompt lives in this action's `prompt-template.md` and is rendered
with the caller's `product-name` substituted in before being sent to Cursor Agent.
