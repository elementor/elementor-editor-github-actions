# Ephemeral Environments — Kubernetes-Native Architecture Design

**Status:** design only (no implementation in this change)  
**Audience:** Cloud Platform DevOps  
**Goal:** replace the GitHub Actions–orchestrated ephemeral flow with a cluster-native control plane that is easy to operate and maintain.

---

## 1. Current system (as operated today)

```text
Service wrapper (workflow_dispatch)
        │
        ▼
Shared reusable workflow (devops-global-actions)
        ├── build & push image
        ├── temporary gitops / ApplicationSet registration
        ├── Argo CD sync into ephem-*
        ├── initializer Job (IngressRoute / routing)
        └── print namespace
        │
        ▼ (for multi-service: poll run, pass existing_ephemeral_environment_namespace)
Next service wrapper — sequential only
```

### Why this is hard to maintain

| Problem | Effect |
| --- | --- |
| Lifecycle in Actions, not the cluster | Debug via `gh run` logs; no first-class `kubectl` status |
| Multi-service join is sequential | Race-prone; second repo must wait and scrape namespace |
| Overrides via git commits | Branch noise; hard to reason about desired state |
| Initializer Jobs for routing | Extra moving part for something that should be declarative |
| Shared mega-workflow | High blast radius; poor local testability |
| Split TTL / cleanup | PR hooks + 24h conventions; full re-run to recreate |

Preserved platform requirements (must keep):

- Real staging cluster and shared infra  
- `ephem-*` namespaces  
- Shared vs fresh database modes  
- Core companion apps  
- Helm charts / `elementor-library` values  
- Traefik-style hosts: `<service>-<env>.<domain>`  
- Default 24h TTL  
- On-demand create + multi-repo join (not only PR generators)

---

## 2. Target architecture (one sentence)

**Desired state is a Kubernetes custom resource; an in-cluster controller reconciles namespaces, Argo CD Applications, IngressRoutes, and TTL.**

```text
Developer / thin CI
        │  apply EphemeralEnvironment + EphemeralService
        ▼
┌─────────────────────────────────────────────────────────┐
│ Staging cluster                                          │
│                                                          │
│  EphemeralEnvironment  →  Namespace ephem-<name>         │
│                        →  ResourceQuota / labels         │
│                        →  TTL / finalizer                │
│                                                          │
│  EphemeralService(s)   →  Argo CD Application            │
│                        →  Helm image/value overrides     │
│                           (no gitops commits)            │
│                        →  Traefik IngressRoute           │
└─────────────────────────────────────────────────────────┘
```

CI shrinks to: **build image → apply CR**. Everything else is controller-owned.

---

## 3. API design

### `EphemeralEnvironment` (cluster-scoped)

Owns the temporary namespace and shared policy.

```yaml
apiVersion: ephemeral.elementor.io/v1alpha1
kind: EphemeralEnvironment
metadata:
  name: feat-billing          # → namespace ephem-feat-billing
spec:
  ttl: 24h
  owner: you@elementor.com
  database:
    mode: shared              # shared | fresh
  ingress:
    domain: stg.elementor.cloud
  includeCoreApps: true
  pause: false                # freeze TTL without delete
status:
  phase: Ready                # Pending | Ready | Degraded | Failed | Expiring
  namespace: ephem-feat-billing
  rootURL: https://feat-billing.stg.elementor.cloud
  expiresAt: "..."
  services:
    - name: billing-api
      phase: Ready
      url: https://billing-api-feat-billing.stg.elementor.cloud
```

### `EphemeralService` (cluster-scoped)

One microservice joined into an environment. Many services (any git repo) share one `environmentRef`. Joins are parallel-safe.

```yaml
apiVersion: ephemeral.elementor.io/v1alpha1
kind: EphemeralService
metadata:
  name: feat-billing-billing-api
spec:
  environmentRef: feat-billing
  serviceName: billing-api
  image:
    repository: gcr.io/elementor/billing-api
    tag: sha-abc123
    # defaults match elementor-library:
    # helmRepositoryKey: global.image.repository
    # helmTagKey: global.image.tag
  source:
    repoURL: https://github.com/elementor/<gitops>.git
    path: apps/billing-api
    targetRevision: master    # chart definition branch — not the app feature branch
  valuesYAML: |               # replaces ephemeral-overrides.yaml commits
    global:
      env: ephemeral
status:
  phase: Ready
  url: https://billing-api-feat-billing.stg.elementor.cloud
  argoCDApp: ephem-feat-billing-billing-api
  syncStatus: Synced
  healthStatus: Healthy
```

**Why two CRDs (not one embedded list):** each service repo’s thin CI only applies its own `EphemeralService`. No cross-repo Actions orchestration.

---

## 4. Controller responsibilities

### Environment reconciler

1. Ensure finalizer  
2. Ensure `Namespace/ephem-<name>` (+ labels: owner, database mode, managed-by)  
3. Optional `ResourceQuota`  
4. `expiresAt = creationTimestamp + spec.ttl` (patching `ttl` extends/shortens; `pause` freezes)  
5. Aggregate child service status → environment phase  
6. On TTL expiry → delete self  
7. On delete → delete child services → delete namespace → remove finalizer  

### Service reconciler

1. Resolve environment; requeue until namespace ready  
2. Create/update Argo CD `Application` with Helm parameters for image + `valuesYAML`  
3. Create/update Traefik `IngressRoute` for `<service>-<env>.<domain>`  
4. Mirror Argo sync/health into status  
5. On delete → delete Application (Argo prune) + IngressRoute  

Use unstructured clients for Argo/Traefik so the operator is not pinned to their Go API versions.

---

## 5. What stays / what goes

| Concern | Current | Target |
| --- | --- | --- |
| Image build | GHA | GHA (unchanged, thin) |
| Namespace | Workflow / Argo options | Environment controller |
| Chart deploy | Argo via temporary gitops entry | Argo Application created by controller |
| Image pin | gitops commit / workflow params | Application Helm parameters |
| Ingress | Initializer Job | Service controller |
| Multi-service join | Sequential workflow input | Multiple `EphemeralService` CRs |
| Overrides | Commit on branch | `spec.valuesYAML` |
| TTL | Actions + conventions | Controller |
| Status UX | Actions UI | `kubectl get` / small CLI |

**Non-goals (v1):** replace prod/staging GitOps ApplicationSets; build images inside the operator; multi-cluster; automatic PR discovery (PR generators fit single-repo previews poorly for Elementor’s multi-repo join model).

---

## 6. Security & tenancy

- Argo CD AppProject `ephemeral`: destinations only `ephem-*`; sources only approved gitops repos  
- CI / developer SA: create/delete ephemeral CRs only (not cluster-admin)  
- Private registry: imagePullSecrets projected into ephemeral namespaces  
- Optional NetworkPolicies if staging requires east-west limits  

---

## 7. Operator UX (illustrative)

```bash
# Create env + first service
kubectl apply -f environment.yaml
kubectl apply -f service-a.yaml

# Join another repo’s service (no waiting on Actions)
kubectl apply -f service-b.yaml

kubectl get ephemeralenvironments
kubectl get ephemeralservices -l ephemeral.elementor.io/environment=feat-billing

# Hold / tear down
kubectl patch ee feat-billing --type merge -p '{"spec":{"pause":true}}'
kubectl delete ee feat-billing   # cascades services + namespace
```

Optional thin CLI (`ephem create|join|status|delete`) is sugar over the same CRs — not required for the architecture.

---

## 8. Migration outline

1. **Shadow** — install operator beside legacy; one low-risk service dual-runs  
2. **Flag** — wrapper input `engine: legacy|operator`  
3. **Cutover** — default to operator; parallel joins; remove gitops commit + initializer steps  
4. **Decommission** — shrink shared ephemeral workflow to build + apply CR; update DevOps Cursor skill to watch CRs instead of Actions runs  

Rollback: leave legacy workflow until cutover is stable; uninstall operator + delete CRs.

---

## 9. Open decisions (need DevOps input)

1. **Fresh DB** — exact provisioner today (Job, Helm chart, Cloud SQL clone)? Controller should own the same contract.  
2. **Core apps catalog** — where is the source of truth (appset assets today)? ConfigMap vs git path for the operator.  
3. **PR-close cleanup** — GitHub App webhook into controller vs keep a tiny Actions delete step?  
4. **Slack notifications** — controller vs existing post-job action?  
5. **Home repo** — new repo replacing `elementor-ephemeral-envs-tools`, or live under an existing platform repo?

---

## 10. Success criteria

- Create + multi-service join without sequential Actions orchestration  
- No ephemeral commits to gitops / feature branches for overrides  
- `kubectl` (or equivalent) shows phase, URLs, expiry  
- TTL and delete are reliable without re-running a mega-workflow  
- Onboarding a service = chart path + thin “build + apply CR” workflow
