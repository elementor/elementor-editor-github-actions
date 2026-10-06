# Check release owner

Fails the job unless the user who triggered the run (`github.triggering_actor`) is a required reviewer of an environment, `release-owners` by default. Core and Pro use it so the same people who approve a release are the only ones who can start one.

Only user reviewers are checked. Team reviewers are skipped with a warning, because the workflow token cannot read team membership.

## Usage

```yaml
permissions:
  actions: read

steps:
  - uses: elementor/elementor-editor-github-actions/actions/check-release-owner@main
```

## Inputs

| Input          | Default               | Description                                     |
| -------------- | --------------------- | ----------------------------------------------- |
| `environment`  | `release-owners`      | Environment whose required reviewers may start. |
| `github-token` | `${{ github.token }}` | Token that can read the environment.            |
