# Architecture

## API

### `EphemeralEnvironment` (cluster-scoped)

Owns the temporary namespace and shared policy:

- `spec.ttl` (default `24h`)
- `spec.database.mode`: `shared` | `fresh`
- `spec.ingress.domain` (+ optional Traefik entrypoints / TLS secret)
- `spec.includeCoreApps`
- `spec.owner`, optional `spec.resources`, `spec.pause`

Status surfaces `namespace`, `phase`, `rootURL`, `expiresAt`, and child service
summaries.

### `EphemeralService` (cluster-scoped)

Deploys one microservice into an environment:

- `spec.environmentRef`
- `spec.serviceName`
- `spec.image.{repository,tag}` (+ Helm value key overrides)
- `spec.source.{repoURL,path,targetRevision}`
- `spec.valuesYAML` — replaces branch-committed ephemeral overrides

Many services may reference the same environment. They can be applied in any
order once the environment exists (the service reconciler requeues until the
namespace is ready).

## Controllers

### Environment reconciler

1. Add finalizer
2. Ensure `Namespace/ephem-<name>` with labels
3. Optionally ensure `ResourceQuota`
4. Compute / preserve `status.expiresAt`
5. Aggregate child service status → environment phase
6. On TTL expiry → delete self
7. On delete → delete children, then namespace, then remove finalizer

### Service reconciler

1. Resolve referenced environment / namespace
2. Create or update Argo CD `Application` with Helm parameters for image repo/tag
   and optional `valuesYAML`
3. Create or update Traefik `IngressRoute` for
   `<service>-<env>.<domain>`
4. Mirror Argo sync/health into CR status
5. On delete → delete Application (Argo prune) and IngressRoute

Argo CD and Traefik objects are manipulated as `unstructured` so the operator
does not hard-pin argoproj / traefik Go module versions.

## Trust boundaries

| Actor | Can do |
| --- | --- |
| Developers (via CI SA / ephem CLI) | Create/delete Environment + Service CRs |
| Operator SA | Manage namespaces, quotas, Argo Applications, IngressRoutes |
| Argo CD | Deploy chart resources into `ephem-*` only (project scoping) |

Recommended: an Argo CD AppProject named `ephemeral` that allows destinations
only to namespaces matching `ephem-*` and sources only from approved gitops
repos.

## Failure handling

- Missing environment → service status `Failed` / `EnvironmentMissing`
- Argo not Synced+Healthy → service `Deploying` or `Failed`, requeue 15s
- TTL pause → `spec.pause: true` freezes expiry without teardown
- Partial multi-service failure → environment phase `Degraded`

## Extension points

- **Fresh DB**: environment controller can later create a DB claim / Job when
  `database.mode=fresh` (v1 records the mode on the namespace label for
  chart/init consumers)
- **Core apps**: a ConfigMap catalog of core `EphemeralService` templates can be
  expanded by the environment reconciler when `includeCoreApps=true`
- **Notifications**: watch Ready condition → Slack webhook
- **GitHub App**: optional controller that deletes environments when the linked
  PR closes (label/annotation driven)
