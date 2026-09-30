'use strict';

/**
 * Derives the single outcome of a healer run from the upstream job outputs.
 *
 * Reporting lives in one job that runs on `always()` and asks this function
 * what happened, rather than in per-step conditions spread across the
 * pipeline. Those conditions are skipped whenever the step before them
 * fails — which is exactly when a report matters most (agent timed out,
 * agent pushed nothing, poller errored).
 */

const VERIFY_INFRA_STAGES = new Set([
	'restore',
	'setup',
	'grep',
	'baseline',
	'verify-run',
]);
const NOT_REPRODUCIBLE_STAGE = 'not-reproducible';
const SCOPE_STAGE = 'scope';
const CRASHED_VERIFY_STAGE = 'verify-job';
const HANDOFF_OUTCOMES = {
	'baseline-drift': 'agent-baseline-drift',
	'product-bug': 'agent-escalated',
};

function isTrue(value) {
	return 'true' === String(value || '').trim();
}

function text(value) {
	return String(value || '').trim();
}

/**
 * @param {Object} state Flattened job outputs.
 * @return {{outcome: string, details: Object}} Outcome name and its details.
 */
function resolveHealerOutcome(state) {
	const {
		mode,
		enabled,
		healerSwitch,
		existingPrUrl,
		hasCandidate,
		noCandidateReason,
		rankedFailures,
		skippedCandidates,
		testName,
		shardIndex,
		sourceRunId,
		repo,
		agentStatus,
		agentBranch,
		agentResult,
		agentHandoff,
		verifyPassed,
		verifyStage,
		verifyJobResult,
		buildDescription,
		prUrl,
		jiraUrl,
		duplicatePrUrl,
		verifyOnly,
	} = state;

	const base = {
		testName: text(testName),
		shardIndex: text(shardIndex),
		sourceRunId: text(sourceRunId),
		repo: text(repo),
		mode: text(mode),
		skippedCandidates: skippedCandidates || [],
	};

	if (undefined !== enabled && !isTrue(enabled)) {
		return {
			outcome: 'disabled',
			details: { ...base, healerSwitch: text(healerSwitch) || 'off' },
		};
	}

	if (!isTrue(hasCandidate)) {
		const reason = text(noCandidateReason) || 'no-hard-failures';
		return {
			outcome: reason,
			details: {
				...base,
				rankedFailures: rankedFailures || [],
				existingPrUrl: text(existingPrUrl),
			},
		};
	}

	const branch = text(agentBranch);
	const status = text(agentStatus);

	if ('FINISHED' !== status) {
		return {
			outcome: 'agent-error',
			details: { ...base, status: status || 'unknown', branch },
		};
	}

	// Only a handoff marker makes a branchless run a verdict on the test. Without
	// one it is an agent that did not finish its job, and must not put the test
	// on cooldown as if it had been judged.
	if (!branch) {
		const outcome = HANDOFF_OUTCOMES[text(agentHandoff)];

		if (!outcome) {
			return {
				outcome: 'agent-error',
				details: {
					...base,
					status,
					branch,
					summary: text(agentResult),
				},
			};
		}

		return { outcome, details: { ...base, summary: text(agentResult) } };
	}

	const stage = text(verifyStage);

	if (SCOPE_STAGE === stage) {
		return {
			outcome: 'verification-scope-violation',
			details: { ...base, branch },
		};
	}

	if (VERIFY_INFRA_STAGES.has(stage)) {
		return {
			outcome: 'verification-infra-failed',
			details: { ...base, branch, stage },
		};
	}

	const jobResult = text(verifyJobResult);

	if (!stage && jobResult && 'success' !== jobResult) {
		return {
			outcome: 'verification-infra-failed',
			details: { ...base, branch, stage: CRASHED_VERIFY_STAGE },
		};
	}

	const build = text(buildDescription);

	if (NOT_REPRODUCIBLE_STAGE === stage) {
		return {
			outcome: 'verification-not-reproducible',
			details: { ...base, branch, buildDescription: build },
		};
	}

	if (!isTrue(verifyPassed)) {
		return {
			outcome: 'verification-failed',
			details: { ...base, branch, buildDescription: build },
		};
	}

	if (isTrue(verifyOnly)) {
		return {
			outcome: 'verified-branch',
			details: { ...base, branch, buildDescription: build },
		};
	}

	if (text(duplicatePrUrl)) {
		return {
			outcome: 'test-has-open-pr',
			details: {
				...base,
				branch,
				buildDescription: build,
				existingPrUrl: text(duplicatePrUrl),
			},
		};
	}

	return {
		outcome: 'healed',
		details: {
			...base,
			branch,
			buildDescription: build,
			prUrl: text(prUrl),
			jiraUrl: text(jiraUrl),
			rca: text(agentResult),
		},
	};
}

module.exports = { VERIFY_INFRA_STAGES, resolveHealerOutcome };
