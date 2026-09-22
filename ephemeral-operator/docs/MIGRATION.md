# Migration plan

## Phase 0 — Review (this PR)

- Agree on CRD shape vs remaining requirements from
  `elementor-ephemeral-envs-tools` / shared workflow (DB provisioning details,
  core-app catalog, Slack notifications, PR-close hooks).
- Extract this tree into a dedicated repo once approved.

## Phase 1 — Shadow

1. Install operator on staging beside the existing system (no traffic shift).
2. Pick one low-risk service; add a **thin** workflow that:
   - builds/pushes the image (reuse existing shared build action)
   - applies `EphemeralEnvironment` + `EphemeralService` YAML
3. Compare URLs, chart rendering, and DB behaviour against the legacy workflow
   for the same branch.

## Phase 2 — Dual-run

- Keep legacy workflow available behind an input flag
  `engine: legacy|operator`.
- Document `ephem` CLI for developers and Cursor agents
  (replace sequential dispatch logic in `devops-ephemeral-environments` skill).

## Phase 3 — Cutover

- Default new envs to the operator.
- Convert multi-repo joins to parallel `EphemeralService` applies.
- Remove temporary gitops commit steps and initializer Jobs from the shared
  workflow.
- Delete unused helpers from `elementor-ephemeral-envs-tools`.

## Phase 4 — Decommission

- Remove shared `ephemeral-environment.yaml` reusable workflow (or reduce it to
  image-build + `kubectl apply`).
- Remove per-repo wrappers’ heavy inputs; keep only image build + CR apply.
- Update DevOps Cursor skill to create/watch CRs instead of Actions runs.

## Rollback

Leave the legacy workflow in place until Phase 3 is stable. Operator deletion
is `helm uninstall ephemeral-operator` plus CRD removal after CRs are gone.
