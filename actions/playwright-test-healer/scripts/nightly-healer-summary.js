'use strict';

/**
 * Builds the GitHub Actions job summary for a healer run.
 *
 * Every outcome writes a summary, including the ones that open no PR. The
 * job summary is the one reporting surface that always exists: it needs no
 * secrets, no channel configuration, and it is where someone who dispatched
 * the healer by hand looks for the resulting PR link.
 */

const { COOLDOWN_DAYS } = require('./healer-skips');

const TITLE = '## 🩺 Test Healer';

function runLink(repo, runId) {
	if (!repo || !runId) {
		return '';
	}
	return `https://github.com/${repo}/actions/runs/${runId}`;
}

function contextLines({ testName, shardIndex, repo, sourceRunId, branch }) {
	const lines = [];

	if (testName) {
		lines.push(`- **Test:** \`${testName}\``);
	}
	if (shardIndex) {
		lines.push(`- **Shard:** \`${shardIndex}\``);
	}

	const source = runLink(repo, sourceRunId);
	if (source) {
		lines.push(`- **Evidence run:** ${source}`);
	}
	if (branch) {
		lines.push(`- **Branch:** \`${branch}\``);
	}

	return lines;
}

const OUTCOME_BUILDERS = {
	healed: (details) => [
		'### ✅ Fix verified — PR opened',
		'',
		`### 👉 ${details.prUrl}`,
		'',
		...(details.jiraUrl ? [`Jira: ${details.jiraUrl}`, ''] : []),
		...contextLines(details),
		...(details.buildDescription
			? [
					'',
					`The fix was re-run against ${details.buildDescription} before the PR was opened.`,
				]
			: []),
		...(details.rca ? ['', '**Agent RCA**', '', `> ${details.rca}`] : []),
	],
	'verified-branch': (details) => [
		'### ✅ Branch verified — verify-only run, no PR opened',
		'',
		...contextLines(details),
		'',
		`The test failed without \`${details.branch}\`'s changes and passed with them.`,
		...(details.buildDescription
			? ['', `Both runs used ${details.buildDescription}.`]
			: []),
	],
	'verification-failed': (details) => [
		'### ❌ Fix did not verify — no PR opened',
		'',
		...contextLines(details),
		'',
		'The agent pushed a fix but the re-run against the build still failed. The branch is left in place for manual pickup.',
		...(details.buildDescription
			? ['', `It was re-run against ${details.buildDescription}.`]
			: []),
	],
	'verification-not-reproducible': (details) => [
		'### 🤷 Failure did not reproduce — no PR opened',
		'',
		...contextLines(details),
		'',
		"The test passed on every run without the agent's fix, so a pass with it would not show the fix does anything. Either something else already fixed it, or it only fails on code other than what was rebuilt. The branch is left in place.",
		...(details.buildDescription
			? ['', `Both runs used ${details.buildDescription}.`]
			: []),
	],
	'verification-infra-failed': (details) => [
		'### 🧰 Could not verify — healer infrastructure failed',
		'',
		...contextLines(details),
		'',
		`Failed stage: \`${details.stage || 'unknown'}\`. This is not a verdict on the agent's fix — the verification environment never came up, so the branch is untested.`,
	],
	'verification-scope-violation': (details) => [
		'### ⛔ Fix rejected — it changes files the healer may not touch',
		'',
		...contextLines(details),
		'',
		"The agent's branch changes files outside `tests/playwright/` or snapshot baselines, so none of it was run. The verify job log lists the files. The branch is left in place for review.",
	],
	'agent-escalated': (details) => [
		'### 🚨 Escalated as a possible product bug — no PR opened',
		'',
		...contextLines(details),
		...(details.summary ? ['', `> ${details.summary}`] : []),
	],
	'agent-baseline-drift': (details) => [
		'### 📸 Baseline drift — no PR opened',
		'',
		...contextLines(details),
		...(details.summary ? ['', `> ${details.summary}`] : []),
		'',
		'The UI renders differently now rather than racing, so no wait would have fixed it. Completing this needs a version-gated snapshot — one of the `expectScreenshot*`/`expectMatchSnapshot*` helpers in `tests/playwright/assets/test-helper.ts` — plus a new fallback baseline image, and the healer is not allowed to add baseline images.',
	],
	'agent-error': (details) => [
		'### ❌ Cloud agent run failed',
		'',
		...contextLines(details),
		'',
		`Agent run ended with status \`${details.status || 'unknown'}\`${'FINISHED' === details.status ? ' without pushing a fix or handing off with a marker line' : ''}.`,
		...(details.summary ? ['', `> ${details.summary}`] : []),
	],
	disabled: (details) => [
		'### ⏸️ Healer is switched off — nothing ran',
		'',
		`\`vars.TEST_HEALER_ENABLED\` is \`${details.healerSwitch || 'off'}\`${'manual' === details.healerSwitch ? ', which refuses runs the cron marks as scheduled' : ''}.`,
		'',
		'Set it to `manual` to allow anything a person dispatches — including a ranked dry run against a real nightly run id — or `all` to also let the cron through.',
	],
	'test-has-open-pr': (details) => [
		'### ⏭️ Skipped — this test already has an open PR',
		'',
		`${details.existingPrUrl}`,
		'',
		...contextLines(details),
		'',
		details.branch
			? `The fix on \`${details.branch}\` verified, but the PR above appeared while the agent was working, so no second PR was opened. The branch is left in place.`
			: 'A second PR for the same test would be a duplicate. Merge or close the one above, or dispatch with `allow_duplicate_pr` enabled.',
	],
	'all-candidates-skipped': () => [
		'### ⏭️ Every candidate was skipped — nothing ran',
		'',
		'Each failure with evidence either has an open PR or had a verdict from a recent healer run, listed below.',
	],
	'no-hard-failures': () => [
		'### ✅ Nothing to heal',
		'',
		'No hard test failures in the evidence run. Green night.',
	],
	'no-artifact-evidence': (details) => [
		'### ⚠️ No candidate had artifact evidence — no PR opened',
		'',
		'Hard failures were found, but none had a matching trace/log artifact to investigate from:',
		'',
		...(details.rankedFailures || []).map((name) => `- \`${name}\``),
	],
	'no-manual-evidence': (details) => [
		'### ⚠️ No failure artifact found for the requested test',
		'',
		...contextLines(details),
		'',
		'Nothing was healed. `test-results` artifacts are kept for 3 days and only uploaded for shards that actually failed, so either the test has not failed in CI recently or the title does not match.',
		'',
		'Check the title against the Allure report, or pass `source_run_id` for a run you know failed this test.',
	],
};

function describeSkip(skip) {
	if ('open-pr' === skip.reason) {
		return `open PR ${skip.prUrl}`;
	}

	return `\`${skip.outcome}\` on ${skip.recordedAt} (${skip.runUrl}), retried after ${COOLDOWN_DAYS} days`;
}

function skippedCandidateLines(skippedCandidates) {
	if (!skippedCandidates || skippedCandidates.length === 0) {
		return [];
	}

	return [
		'',
		'**Passed over**',
		'',
		...skippedCandidates.map(
			(skip) => `- \`${skip.testName}\` — ${describeSkip(skip)}`,
		),
	];
}

function buildNightlyHealerSummary({ outcome, details = {} }) {
	const builder = OUTCOME_BUILDERS[outcome];

	if (!builder) {
		throw new Error(`Unknown nightly healer summary outcome: "${outcome}"`);
	}

	return (
		[
			TITLE,
			'',
			...builder(details),
			...skippedCandidateLines(details.skippedCandidates),
		].join('\n') + '\n'
	);
}

module.exports = { buildNightlyHealerSummary };
