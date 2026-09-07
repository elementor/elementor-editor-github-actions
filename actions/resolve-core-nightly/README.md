# Resolve Core Nightly

Resolves the Elementor Core nightly release for a given Core branch, and optionally downloads its zip. Replaces per-repo logic that paged through the releases API and parsed tag names.

Uses the tag rule defined in [`publish-nightly-release/nightly-tag.sh`](../publish-nightly-release/nightly-tag.sh): `main` resolves to `nightly`, any other branch resolves to `<version>-nightly` using the `version` field of that branch's `package.json`.

The action fails with a clear error when the branch has no `package.json`, when no nightly release exists for the resolved tag, or when that release carries no zip asset.

## Usage

```yaml
steps:
  - uses: elementor/elementor-editor-github-actions/actions/resolve-core-nightly@main
    id: core
    with:
      core-branch: main
      token: ${{ secrets.GITHUB_TOKEN }}
      zip-path: ./elementor.zip
```

Omit `zip-path` to resolve the tag and URL without downloading.

## Inputs

| Input               | Required | Default               | Description                                         |
| ------------------- | -------- | --------------------- | --------------------------------------------------- |
| `core-branch`       | yes      | —                     | Core branch to resolve                              |
| `token`             | yes      | —                     | Token used to read Core and download the asset      |
| `zip-path`          | no       | `''`                  | Download target; empty resolves without downloading |
| `core-repo`         | no       | `elementor/elementor` | Repository to resolve against                       |
| `beta-branch-alias` | no       | `4.03`                | Alias accepted for the beta branch                  |
| `beta-branch`       | no       | `release/beta`        | Branch the alias maps to                            |
| `main-branch`       | no       | `main`                | Branch carrying the unsuffixed nightly tag          |
| `main-nightly-tag`  | no       | `nightly`             | Tag name used for the main branch                   |

## Outputs

`tag`, `version`, `zip-url`. The same values are also exported to `GITHUB_ENV` as `CORE_RELEASE_TAG`, `CORE_PACKAGE_VERSION` and `CORE_ZIP_URL`.
