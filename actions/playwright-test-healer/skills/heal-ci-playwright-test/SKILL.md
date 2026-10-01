---
name: heal-ci-playwright-test
description: Run the fix-playwright-test skill unattended on exactly one Playwright CI failure handed over by the Playwright test healer GitHub Actions workflow (Elementor Core or Pro). Push a fix to a specific branch or hand off with an exact marker line; never open a PR, never create a Jira ticket, never touch more than the one named test. Use only when dispatched by that workflow's prompt.
---

# Heal CI Playwright Test (unattended)

You run the **`/fix-playwright-test`** skill (Testing plugin, Elementor Cursor marketplace) end to end, with nobody watching. If it is not in your available skills, stop and say so; do not reconstruct it from memory. Its persona, phases, rules, and common-fixes reference all apply. This file lists only where unattended mode differs; **where the two disagree, this file wins.**

## Overrides of fix-playwright-test

| fix-playwright-test                                                         | Unattended                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — create a Jira ticket and a local branch                           | **Skip.** No Jira. Push to the exact branch name the prompt gives, created from the git ref the prompt gives.                                                                                                                                                 |
| Phase 1 — find the failure from a user's link or log                        | The prompt names the evidence run and failed shard. See _Evidence_ below.                                                                                                                                                                                     |
| Any step that asks the user (`AskQuestion`, "ask whether to…", "confirm")   | **Never ask.** Nobody answers. Decide from _Scope_ and this file, and state the decision in your report.                                                                                                                                                      |
| Phase 2 / Phase 3                                                           | As written. Then classify the cause — see _Three causes_.                                                                                                                                                                                                     |
| Phase 3 bug red flag — "confirm before proceeding"                          | Nobody can confirm. Escalate with the exact product-bug line and stop.                                                                                                                                                                                        |
| Phase 4 — fix                                                               | As written, plus: never add or change snapshot images, and never invent a selector — see _Hard constraints_.                                                                                                                                                  |
| Phase 5 — verify                                                            | Run the test locally when the environment allows. It is a pre-push check; CI makes the final call. See _Local run_.                                                                                                                                           |
| Phase 5 / Report — "Could not confirm the fix" escalation after ~3 attempts | **Not an ending here.** Re-classify with _Three causes_. Still a race: push your best fix and say it is unconfirmed; CI verification decides. Drift or product bug: use that marker line. Never claim a product bug only because you could not confirm a fix. |
| Phase 6 — Deliverable Summary                                               | Replaced by _Finish and report_.                                                                                                                                                                                                                              |
| Git — never push                                                            | **Push is required** for a race. Never open a PR.                                                                                                                                                                                                             |

## Scope

Exactly one failing test, from one evidence run. Do not explore or fix other failures from the same run, even if they look related.

## Three causes

After Phase 3, decide which of these it is — before changing anything:

| Cause                      | What it looks like                                                                                                                                                                                                                                                           | What you do                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Race** (the common case) | The test asserted before the UI settled. Output varies between retries; the failure screenshot shows a missing, empty, or half-painted element.                                                                                                                              | **Fix it** — wait for the deterministic state, then push. |
| **Baseline drift**         | The UI genuinely renders differently now, usually because the run tested another Core, Pro, or WordPress version than the baseline was captured on. The diff is _stable and identical across every retry_ and shows real, finished UI that simply differs from the baseline. | **Hand off** — do not push a wait.                        |
| **Product bug**            | The app is broken: uncaught PHP/JS exception overlay, HTTP 5xx for the action under test, editor crash.                                                                                                                                                                      | **Escalate** — do not push.                               |

Most candidates are races, and a race is never fixed by accepting a new screenshot, skipping, or weakening an assertion. But do not force every candidate into that box: a wait-based fix for baseline drift verifies green and hides a real rendering difference, which is worse than doing nothing.

**Locator timeouts.** Apply Phase 2's rule first: a locator that never resolved usually means the element does not exist in that DOM state, and a wait will not help. If the element does exist there and the request behind it already returned 200 — live search, loop template, iframe preview not yet painted — that is the race: wait for the locator the test already expects. An empty preview after a 200 is a race, not a product bug.

**Screenshot failures** (`toHaveScreenshot` / `toMatchSnapshot`, `*-actual.*` / `*-diff.*`): open the `*-diff.*` and compare every retry's `*-actual.*`.

- **Race** — the diff varies between retries, or the actual shows something unfinished: a missing element, blank area, spinner, half-drawn dropdown, text in a fallback font, an animation mid-flight. Wait for the specific state that differs, reusing existing helpers, then take the screenshot.
- **Baseline drift** — every retry's actual is byte-identical, fully rendered, and simply different from the baseline: a changed icon, a new control, different spacing, a renamed label. Before concluding:

  - What versions did the run use, and when was the baseline last captured (`git log`)?
  - Does the area already version-gate its snapshots? The prompt's _Repository notes_ name this repository's version-gating helpers and variables. **Grep the area for all of them, not one name.**
  - A bare `toMatchSnapshot` / `toHaveScreenshot` in an area where siblings version-gate is the usual tell that drift reached an ungated test.

  The complete fix for drift is a version-gated snapshot plus a new fallback baseline image, and you may not add images. Hand off.

## Evidence

Evidence lives in the **failed shard's GitHub artifact**, not in a folder named after the Allure title. Failed Playwright jobs upload `test-results/` as a `playwright-test-results-*` artifact; the prompt's _Repository notes_ say how this repository names those artifacts and jobs. Download the one the prompt names:

```bash
gh api repos/<org>/<repo>/actions/runs/<run_id>/artifacts --jq '.artifacts[] | {name,id}'
gh api repos/<org>/<repo>/actions/artifacts/<id>/zip > artifact.zip
unzip -q artifact.zip -d extracted
```

A run may have been re-run: artifacts from every attempt stay on the run, but the jobs API shows only the latest attempt. Trust the artifact, not the job list.

Output folders are truncated and hashed (`modules-search-search-infr-364a4-Search-widget-functionality`) and can drop a leading `Test-`, so use the prompt's directory names only as a hint and confirm the test through `error-context.md`. Retries nest as `<dir>-retry1/`, `<dir>-retry2/`; **read every retry's trace** (Phase 3 describes how to parse one), because whether the failure varies between them is what separates a race from drift.

## Local run

Phase 5, unattended. Run the one test locally before pushing whenever the environment allows it. Set up the environment as the prompt's _Repository notes_ describe, then run

```bash
npx playwright test <test file> -g "<exact title>" --retries=0 --repeat-each=3 --config=tests/playwright/playwright.config.ts
```

- **A local failure on something you added is proof the fix is wrong.** A locator you introduced that never resolves, a wait that times out, a new assertion that fails — fix it before pushing. Pushing it only wastes a CI verification run.
- **A local pass is not proof the fix is right.** The local stack is not the CI stack. CI verification against the real build decides.
- **If the environment cannot run the test** — the plugin is not built, the environment will not start within about 10 minutes, or the test needs a licence or service you do not have — do not fight it. Say so in one line of your report and continue. The whole assignment has a 45-minute budget.
- If three local attempts in a row fail on the _original_ error, that is evidence against a race. Reconsider drift or product bug before pushing a fourth wait.

## Hard constraints

- Never change what the test asserts, weaken an assertion, add `test.skip`, or touch snapshot files (`*.png`, `*.jpeg`, `*-linux.*`, …).
- Never touch product/module PHP or JS code. Only files under `tests/playwright/`.
- Never touch the WordPress environment either: `tests/playwright/mu-plugins/`, `tests/playwright/blueprints/`, and any `.wp-env*.json` or `*wp-lite-env.json`. Never add `describeIf` / `testIf`, and never swallow a failure with an empty `.catch( () => {} )`.
- **Never invent a selector.** Every locator you add must be one you saw in the trace's DOM snapshot, in the component source, or in a passing sibling test.
- Use named constants from `config/timeouts.ts`, never magic-number timeouts.
- Do not open a pull request and do not create or modify any Jira ticket. Do not put a Jira key in your commit message.

## Finish and report

A run is complete in exactly one of three ways, and only these three:

1. **You pushed a fix** — a race. Commit only files under `tests/playwright/` and push to the exact branch name you were given. A separate CI job re-runs the test against the real build and opens the PR only if it passes; it hard-fails any diff outside `tests/playwright/` or touching an image.
2. **Baseline drift** — do not push. The last line of your report must be exactly:
   `📸 Baseline drift: [what differs] on [versions]. No fix pushed — needs a versioned baseline.`
3. **Product bug** — only when the trace shows the product itself is broken and a wait cannot help. Do not push. The last line must be exactly:
   `🚨 Possible product bug: [what's wrong]. No fix pushed — escalating.`

Use at most one of those two lines, only as the final line, and only when you did not push — both are read programmatically. **An RCA with none of the three endings is a failure.**

After a push, end with a concise RCA, a one-paragraph summary of the fix, and one line on the local run (passed N/3, failed, or not possible and why). Keep it tight and factual; this text is captured programmatically.
