# Publish Nightly Release

Prepares a rolling nightly build for a plugin repository: copies the built zip to a stable filename, force-moves the nightly tag to the merge commit, and writes release notes. The calling workflow attaches the result with `softprops/action-gh-release`.

The tag has to be moved by this action because the release action never repoints an existing tag.

## Tag rule

| Merged into      | Tag                 |
| ---------------- | ------------------- |
| `main`           | `nightly`           |
| any other branch | `<version>-nightly` |

The rule lives in `nightly-tag.sh` and is shared with [`resolve-core-nightly`](../resolve-core-nightly), so producer and consumer cannot drift.

## Usage

The calling workflow must check out the repository with write access and build the plugin zip first.

```yaml
permissions:
  contents: write

steps:
  - uses: elementor/elementor-editor-github-actions/actions/publish-nightly-release@main
    id: nightly
    with:
      plugin-slug: elementor
      plugin-zip: ${{ env.PLUGIN_ZIP_FILENAME }}
      package-version: ${{ env.PACKAGE_VERSION }}
      clean-package-version: ${{ env.CLEAN_PACKAGE_VERSION }}
      base-ref: ${{ github.event.pull_request.base.ref }}
      pr-number: ${{ github.event.pull_request.number }}
      pr-title: ${{ github.event.pull_request.title }}
      pr-url: ${{ github.event.pull_request.html_url }}
      merge-commit-sha: ${{ github.event.pull_request.merge_commit_sha }}

  - uses: softprops/action-gh-release@v1
    with:
      tag_name: ${{ steps.nightly.outputs.tag }}
      target_commitish: ${{ github.event.pull_request.base.ref }}
      name: ${{ steps.nightly.outputs.release-name }}
      files: ${{ steps.nightly.outputs.zip }}
      body_path: ${{ steps.nightly.outputs.notes }}
      prerelease: true
      token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input                   | Required | Default                    | Description                                             |
| ----------------------- | -------- | -------------------------- | ------------------------------------------------------- |
| `plugin-slug`           | yes      | —                          | Slug used for the nightly zip filename                  |
| `plugin-zip`            | yes      | —                          | Path to the built plugin zip                            |
| `package-version`       | yes      | —                          | Full build version, shown in the release notes          |
| `clean-package-version` | yes      | —                          | Version without build suffixes, used for the branch tag |
| `base-ref`              | yes      | —                          | Branch the PR was merged into                           |
| `pr-number`             | no       | `''`                       | Merged PR number, shown in the release notes            |
| `pr-title`              | no       | `''`                       | Merged PR title, shown in the release notes             |
| `pr-url`                | no       | `''`                       | Merged PR URL, shown in the release notes               |
| `merge-commit-sha`      | no       | `''`                       | Commit to tag; defaults to `HEAD`                       |
| `notes-filename`        | no       | `nightly-release-notes.md` | File the release notes are written to                   |
| `main-branch`           | no       | `main`                     | Branch that receives the unsuffixed tag                 |
| `main-nightly-tag`      | no       | `nightly`                  | Tag name used for the main branch                       |

## Outputs

`tag`, `release-name`, `zip`, `notes`, `commit`. The same values are also exported to `GITHUB_ENV` as `NIGHTLY_TAG`, `NIGHTLY_RELEASE_NAME`, `NIGHTLY_ZIP_FILENAME` and `NIGHTLY_NOTES_FILENAME`.
