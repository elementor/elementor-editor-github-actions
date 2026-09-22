# Current ephemeral envs vs Kubernetes-native operator

## Sources for the “current” column

This agent could not clone `elementor/elementor-ephemeral-envs-tools` or
`elementor/devops-global-actions` with the credentials available in this
environment (private repos). The current-system description below is grounded in:

- Elementor DevOps Cursor skill `devops-ephemeral-environments` (live platform procedure)
- Elementor Engineers Medium post on shared GitHub Actions + Argo CD ApplicationSets
- Observed onboarding pattern: per-repo `.github/workflows/ephemeral-environment.yaml`
  wrapper → shared reusable workflow, plus `.github/workflows/assets/ephemeral-env-appset/`

When private-repo access is granted, map each bullet to the exact workflow job /
script and update this doc with file paths.

## Complexity map (current)

```text
┌────────────┐   workflow_dispatch    ┌──────────────────────────────┐
│ Service A  │ ─────────────────────► │ Shared ephemeral workflow    │
│ wrapper    │                        │ (devops-global-actions)      │
└────────────┘                        │  • build image               │
                                      │  • mutate gitops / appset    │
                                      │  • wait Argo sync            │
                                      │  • run initializer Job       │
                                      │  • print namespace          │
                                      └──────────────┬───────────────┘
                                                     │ ephem-xxx
┌────────────┐   poll run + pass NS   ┌──────────────▼───────────────┐
│ Service B  │ ─────────────────────► │ Same shared workflow again   │
│ wrapper    │   (must be sequential) │ join existing namespace      │
└────────────┘                        └──────────────────────────────┘
```

### Pain points

| Area | Why it hurts |
| --- | --- |
| **Orchestration** | Lifecycle lives in GitHub Actions, not in the cluster control plane |
| **Multi-service** | Joins require successful completion + log scraping for the namespace |
| **State** | Overrides and temporary gitops entries are git commits / branch mutations |
| **Routing** | Extra initializer Job instead of declarative IngressRoute ownership |
| **Observability** | `gh run view --log`; no first-class `kubectl get` status |
| **TTL** | Split across Actions schedules / PR events; 24h expiry forces full re-run |
| **Onboarding** | Every repo needs a wrapper workflow + appset assets |
| **Blast radius** | Shared workflow changes risk all consumers at once with poor local testability |
| **DX for agents/CI** | Many steps, races, and derived inputs (see skill guardrails) |

## Complexity map (new)

```text
┌────────────┐  build image only   ┌─────────────────────┐
│ Service CI │ ──────────────────► │ registry            │
└─────┬──────┘                     └─────────────────────┘
      │ kubectl/ephem apply CRs
      ▼
┌─────────────────────────────────────────────────────────┐
│ Cluster                                                  │
│  EphemeralEnvironment  ──► Namespace + TTL               │
│  EphemeralService(s)   ──► Argo Application + IngressRoute│
│  Operator reconciles until Ready / Expired               │
└─────────────────────────────────────────────────────────┘
```

### What becomes simple

| Operation | Current | New |
| --- | --- | --- |
| Create env | Dispatch large workflow, wait minutes, parse logs | `ephem create` / apply YAML |
| Join service | Wait for first run, re-dispatch with NS input | `ephem join` (parallel-safe) |
| See status | Actions UI + Argo UI | `kubectl get ee,esvc` / `ephem status` |
| Override values | Commit `ephemeral-overrides.yaml` on branch | `spec.valuesYAML` on the CR |
| Extend TTL | Re-run workflow | Patch `spec.ttl` or `spec.pause` |
| Delete | PR close hook / schedule | `ephem delete` / TTL finalizer |
| Debug | Workflow logs across repos | Controller logs + CR conditions |

## Lines-of-responsibility comparison

| Concern | Current owner | New owner |
| --- | --- | --- |
| Image build | GHA | GHA (unchanged, thin) |
| Namespace create | GHA / Argo sync options | Environment controller |
| Chart deploy | Argo via temporary gitops entry | Argo Application created by controller |
| Image pin | gitops commit or param in workflow | Application helm parameters on CR reconcile |
| Ingress host | Initializer Job | Service controller |
| Multi-service join | Workflow input + sequencing | Multiple `EphemeralService` CRs |
| TTL | Actions + conventions | Controller |
| RBAC / quotas | Ad-hoc | Namespace labels + ResourceQuota |

## Design constraints preserved from Elementor’s platform

- Real staging cluster (not a fake local stack)
- `ephem-*` namespace naming
- Shared vs fresh database modes
- Core companion apps flag
- Argo CD + Helm (`elementor-library` values keys)
- Traefik IngressRoute style hosts
- 24h default TTL

## Non-goals (v1)

- Replacing production/staging GitOps ApplicationSets
- Building images inside the operator (Kaniko/Tekton can be a later opt-in)
- Multi-cluster federation (single staging cluster first)
- Automatic PR discovery (ApplicationSet PR generator) — Elementor’s model is
  **on-demand + multi-repo join**, which CRs express better than PR generators
