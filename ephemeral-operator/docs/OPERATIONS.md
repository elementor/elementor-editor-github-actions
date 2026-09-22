# Operations

## Install

```bash
kubectl create namespace ephemeral-system
helm upgrade --install ephemeral-operator ./deploy/helm/ephemeral-operator \
  -n ephemeral-system
```

Verify:

```bash
kubectl get crd | grep ephemeral.elementor.io
kubectl -n ephemeral-system rollout status deploy/ephemeral-operator
```

## Day-2 commands

```bash
# List
kubectl get ephemeralenvironments
kubectl get ephemeralservices

# Or
ephem list
ephem status feat-billing

# Extend life (recomputed from creationTimestamp + ttl)
kubectl patch ee feat-billing --type merge -p '{"spec":{"ttl":"48h"}}'
# Freeze countdown without deleting:
kubectl patch ee feat-billing --type merge -p '{"spec":{"pause":true}}'

# Tear down
ephem delete feat-billing
```

## Metrics & logs

- Manager serves metrics on `:8080` and health on `:8081`
- Logs: `kubectl -n ephemeral-system logs deploy/ephemeral-operator -f`

Useful field selectors / labels:

```bash
kubectl get ns -l app.kubernetes.io/managed-by=ephemeral-operator
kubectl get applications -n argocd -l ephemeral.elementor.io/owner=true
```

## Alerts (suggested)

- Environments in `Failed` > 15m
- Environments without `ExpiresAt`
- Operator reconciliation errors
- Count of `ephem-*` namespaces (cost guardrail)

## Security checklist

- [ ] Argo CD project `ephemeral` destination limited to `ephem-*`
- [ ] CI service account can only create/delete ephemeral CRs (not cluster-admin)
- [ ] Image pull secrets available in ephemeral namespaces if registry is private
- [ ] NetworkPolicies if staging requires east-west restrictions
