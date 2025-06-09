# Trickle Down Changelog GH Action

> [!WARNING]
> This action should be used only in the context of the elementor plugin.

This action will open PRs in downstream release branches with changes from the changelog.
For example:

- If you update the current GA branch with changes, you will also need to update beta branch and main branches.
- This action will open PRs in beta and main branches with the changes from the changelog.

## Inputs

### `token`

**Required** The GitHub token to use for authentication.

## Usage

```yaml
jobs:
	trickle-down-changelog:
		runs-on: ubuntu-latest
		steps:
			- name: Checkout code
			  uses: actions/checkout@v2
			- name: Run action
			  uses: elementor/elementor-pro/.github/actions/trickle-down-changelog@main
			  with:
				  token: ${{ secrets.GITHUB_TOKEN }}
```

## Build

This action uses `tsup` to build the modules inside the javascript file, so no need to install any dependencies, **make sure to build before merging**.

run `npm run build` to build the action. The build artifacts will be stored in the `dist/` directory.
