# ephemeral-operator

Kubernetes-native ephemeral (preview) environments for Elementor staging.

This project is a **replacement design and implementation** for the current
GitHub Actions–orchestrated ephemeral flow (shared workflow in
`devops-global-actions`, helpers historically associated with
`elementor-ephemeral-envs-tools`, per-repo wrappers, temporary gitops commits,
and initializer jobs).

> **Note on this PR location:** the Cloud Agent workspace for this run is
> `elementor-editor-github-actions`. The operator lives under
> `ephemeral-operator/` so it can be reviewed here and later extracted into its
> own repository (recommended: replace / supersede
> `elementor/elementor-ephemeral-envs-tools`).

## Why replace the current system?

Today, creating an ephemeral environment requires a long cross-system dance:

1. Developer `workflow_dispatch` on a service repo wrapper
2. Wrapper calls a large shared reusable workflow
3. Image build on a GitHub runner
4. Temporary gitops / ApplicationSet registration
5. Argo CD sync into `ephem-*`
6. Initializer Job rewrites Traefik IngressRoutes
7. Optional second/third services join only after polling the first run and
   passing `existing_ephemeral_environment_namespace`
8. TTL / PR-close cleanup wired through more Actions

That spreads lifecycle logic across Actions YAML, git history, Argo CD, and
Jobs. Operators debug with `gh run view --log`. Multi-service joins are
sequential and race-prone. Overrides are committed onto branches.

See [docs/CURRENT_VS_NEW.md](docs/CURRENT_VS_NEW.md) for a full complexity
comparison.

## New model (one sentence)

**Desired state is a Kubernetes CR. A controller makes the cluster match it.**

```text
Developer / thin CI
        │  apply EphemeralEnvironment + EphemeralService
        ▼
ephemeral-operator (in-cluster)
        ├── Namespace ephem-<name> (+ quota)
        ├── Argo CD Application(s) with image/value overrides (no git commits)
        ├── Traefik IngressRoute(s)
        └── TTL finalizer / auto-delete
```

## Quick start

```bash
# Install CRDs + controller
helm upgrade --install ephemeral-operator ./deploy/helm/ephemeral-operator \
  -n ephemeral-system --create-namespace

# Create an environment + first service
ephem create \
  --name feat-billing \
  --domain stg.elementor.cloud \
  --owner you@elementor.com \
  --database shared \
  --service billing-api \
  --image-repo gcr.io/elementor/billing-api \
  --image-tag sha-abc123 \
  --chart-repo https://github.com/elementor/<gitops>.git \
  --chart-path apps/billing-api

# Join another service from a different repo (no waiting on Actions)
ephem join \
  --environment feat-billing \
  --service payments-api \
  --image-repo gcr.io/elementor/payments-api \
  --image-tag sha-def456 \
  --chart-repo https://github.com/elementor/<gitops>.git \
  --chart-path apps/payments-api

ephem status feat-billing
```

Equivalent YAML samples live in `config/samples/`.

## Components

| Piece | Role |
| --- | --- |
| `EphemeralEnvironment` CRD | Owns namespace, TTL, DB mode, ingress domain |
| `EphemeralService` CRD | One service join (many per env, any repo) |
| Controller | Reconciles CRs → Namespace / Argo App / IngressRoute |
| `ephem` CLI | Ergonomic create / join / status / delete |
| Thin GitHub Action example | Build image → apply CR only |

## What stays the same

- Staging cluster and real shared infra remain the test target
- Services still deploy via their existing Helm charts (`elementor-library`)
- Argo CD remains the deployer for chart content
- Hostnames stay predictable: `<service>-<env>.<domain>`
- Default lifetime remains 24h

## What goes away

- Multi-hundred-line shared ephemeral reusable workflow as the orchestrator
- Committing `ephemeral-overrides.yaml` / temporary gitops entries per run
- Sequential “dispatch → watch → capture namespace → dispatch next” joins
- Initializer Jobs whose only job is routing setup
- Debugging lifecycle exclusively through GitHub Actions logs

## Docs

- [Current vs new complexity](docs/CURRENT_VS_NEW.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Migration plan](docs/MIGRATION.md)

## Development

```bash
make test
make build
```

Requires Go 1.22+.
