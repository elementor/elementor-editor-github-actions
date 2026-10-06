#!/bin/bash
set -euo pipefail

REVIEWERS_QUERY='.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[]?'

if ! ENVIRONMENT_JSON=$(gh api "repos/${REPOSITORY}/environments/${ENVIRONMENT}"); then
  echo "::error::Could not read environment '${ENVIRONMENT}' in ${REPOSITORY}. The job needs actions: read."
  exit 1
fi

USER_REVIEWERS=$(jq -r "${REVIEWERS_QUERY} | select(.type == \"User\") | .reviewer.login" <<< "${ENVIRONMENT_JSON}")
TEAM_REVIEWERS=$(jq -r "${REVIEWERS_QUERY} | select(.type == \"Team\") | .reviewer.slug" <<< "${ENVIRONMENT_JSON}")

if [[ -n "${TEAM_REVIEWERS}" ]]; then
  echo "::warning::Team reviewers on '${ENVIRONMENT}' are not checked (the workflow token cannot read team membership): ${TEAM_REVIEWERS//$'\n'/, }"
fi

if [[ -z "${USER_REVIEWERS}" ]]; then
  echo "::error::Environment '${ENVIRONMENT}' has no user reviewers, so nobody can start a release."
  exit 1
fi

if ! grep -Fxiq -- "${ACTOR}" <<< "${USER_REVIEWERS}"; then
  echo "::error::${ACTOR} is not a reviewer of the '${ENVIRONMENT}' environment and cannot start a release."
  exit 1
fi

echo "✅ ${ACTOR} is a reviewer of the '${ENVIRONMENT}' environment."
