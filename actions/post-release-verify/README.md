# Post-release verify

Checks a published Elementor Core (and optionally Pro) release. This is the API/zip half of the post-release checklist — it does not scrape wordpress.org HTML.

## What it checks

1. GitHub release API for `elementor/elementor` (`/releases/tags/{version}`) and, if requested, `elementor/elementor-pro`.
2. Non-empty changelog section for that version on `main` (`changelog.txt`; Core also `readme.txt`).
3. wordpress.org SVN tag `readme.txt`: `Stable tag` and changelog (Core GA only). A 404 is **skipped**, not failed — `.org` can lag GitHub by up to a day.
4. Downloaded zip headers: Core `Version` / `ELEMENTOR_VERSION` / `Stable tag`; Pro `Version`, required Core, recommended Core.

Changelog prose is dumped on the job summary for a quick human read. The action does not judge wording.

## Inputs

| Input                | Required | Notes                                                                                                                                                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-version`       | yes      | e.g. `4.2.2`                                                                                                                                                  |
| `pro-version`        | no       | Empty = Core-only                                                                                                                                             |
| `github-token`       | yes      | `github.token` is enough for public Core. **Pro needs a PAT** with `repo` on `elementor/elementor-pro` (same token used for releases, e.g. `MAINTAIN_TOKEN`). |
| `skip-wordpress-org` | no       | Force-skip SVN/download even if the tag exists                                                                                                                |
| `dry-run`            | no       | Write failures to the summary without failing the step                                                                                                        |

## Outputs

- `core-zip-path` / `pro-zip-path` — downloaded zips for the smoke job
- `failed` — `true` if any hard check failed

Prefer the `Post-Release Check` workflow in this repo over calling the action from Core/Pro until a couple of real GAs have run green.
