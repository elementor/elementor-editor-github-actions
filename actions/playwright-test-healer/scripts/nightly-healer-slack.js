'use strict';

function section(text) {
	return { type: 'section', text: { type: 'mrkdwn', text } };
}

const OUTCOME_BUILDERS = {
	disabled: ({ healerSwitch }) => ({
		text: 'Test Healer: switched off',
		blocks: [
			section(
				`⏸️ *Test Healer: switched off*\n\`vars.TEST_HEALER_ENABLED\` is \`${healerSwitch || 'off'}\` — nothing ran.`,
			),
		],
	}),
	'test-has-open-pr': ({ testName, existingPrUrl }) => ({
		text: 'Test Healer: skipped — this test already has an open PR',
		blocks: [
			section(
				`⏭️ *Test Healer: skipped*\nTest: *${testName}*\nIt already has an open PR: <${existingPrUrl}|View PR>. No duplicate was opened.`,
			),
		],
	}),
	'all-candidates-skipped': ({ skippedCandidates }) => ({
		text: 'Nightly Test Healer: every candidate was skipped',
		blocks: [
			section(
				`⏭️ *Nightly Test Healer: nothing ran*\nEvery failure with evidence has an open PR or a recent healer verdict:\n${skippedCandidates.map((skip) => `• ${skip.testName} (${skip.reason})`).join('\n')}`,
			),
		],
	}),
	'no-hard-failures': () => ({
		text: 'Nightly Test Healer: no hard failures — green night',
		blocks: [
			section(
				'✅ *Nightly Test Healer*\nNo hard test failures found in the evidence run. Nothing to heal.',
			),
		],
	}),
	'no-artifact-evidence': ({ rankedFailures }) => ({
		text: 'Nightly Test Healer: no candidate had artifact evidence',
		blocks: [
			section(
				`⚠️ *Nightly Test Healer: no PR opened*\nHard failures were found, but none had a matching trace/log artifact to investigate from:\n${rankedFailures.map((name) => `• ${name}`).join('\n')}`,
			),
		],
	}),
	'no-manual-evidence': ({ testName }) => ({
		text: 'Test Healer: no failure artifact for the requested test',
		blocks: [
			section(
				`⚠️ *Test Healer: no PR opened*\nNo recent CI failure artifact found for *${testName}*, so there was nothing to investigate from.`,
			),
		],
	}),
	'verification-infra-failed': ({ testName, stage, branch }) => ({
		text: 'Test Healer: verification environment failed',
		blocks: [
			section(
				`🧰 *Test Healer: could not verify*\nTest: *${testName}*\nThe verification environment failed at \`${stage}\`, so the fix on \`${branch}\` is untested — this is not a verdict on the fix.`,
			),
		],
	}),
	'verified-branch': ({ testName, branch }) => ({
		text: 'Test Healer: branch verified',
		blocks: [
			section(
				`✅ *Test Healer: branch verified (verify-only, no PR opened)*\nTest: *${testName}*\nBranch: \`${branch}\``,
			),
		],
	}),
	'verification-not-reproducible': ({ testName, branch }) => ({
		text: 'Test Healer: failure did not reproduce',
		blocks: [
			section(
				`🤷 *Test Healer: failure did not reproduce, no PR opened*\nTest: *${testName}*\nThe test passed without the fix on the same builds, so the fix on \`${branch}\` proves nothing.`,
			),
		],
	}),
	'verification-scope-violation': ({ testName, branch }) => ({
		text: 'Test Healer: fix rejected for touching files out of scope',
		blocks: [
			section(
				`⛔ *Test Healer: fix rejected, no PR opened*\nTest: *${testName}*\nThe fix on \`${branch}\` changes files outside \`tests/playwright/\` or snapshot baselines, so it was not run.`,
			),
		],
	}),
	'agent-escalated': ({ testName, summary }) => ({
		text: 'Nightly Test Healer: agent escalated a possible product bug',
		blocks: [
			section(
				`🚨 *Nightly Test Healer: escalated, no PR opened*\nTest: *${testName}*\n${summary}`,
			),
		],
	}),
	'agent-baseline-drift': ({ testName, shardIndex, summary }) => ({
		text: 'Test Healer: baseline drift, no PR opened',
		blocks: [
			section(
				`📸 *Test Healer: baseline drift, no PR opened*\nTest: *${testName}*${shardIndex ? `\nShard: \`${shardIndex}\`` : ''}\n${summary || ''}\nThe UI renders differently rather than racing — this needs a version-gated snapshot and a new fallback baseline, which the healer may not add.`,
			),
		],
	}),
	'agent-error': ({ testName, status }) => ({
		text: 'Nightly Test Healer: Cloud agent run failed',
		blocks: [
			section(
				`❌ *Nightly Test Healer: agent failed*\nTest: *${testName}*\nAgent run ended with status: ${status}`,
			),
		],
	}),
	'verification-failed': ({ testName, branch }) => ({
		text: 'Nightly Test Healer: fix did not verify',
		blocks: [
			section(
				`❌ *Nightly Test Healer: fix did not verify*\nTest: *${testName}*\nThe re-run against the nightly build still failed. Branch left for manual pickup: \`${branch}\`.`,
			),
		],
	}),
	healed: ({ prUrl, testName, shardIndex, jiraUrl, rca }) => {
		const links = [`<${prUrl}|View PR>`];

		if (jiraUrl) {
			links.push(`<${jiraUrl}|Jira ticket>`);
		}

		const blocks = [
			section(
				`✅ *Test Healer: opened a PR*\nTest: *${testName}*${shardIndex ? `\nShard: \`${shardIndex}\`` : ''}\n${links.join(' · ')}`,
			),
		];

		if (rca) {
			blocks.push(section(`*RCA:* ${rca}`));
		}

		return { text: 'Test Healer: opened a PR', blocks };
	},
};

function buildNightlyHealerSlackPayload({ outcome, details }) {
	const builder = OUTCOME_BUILDERS[outcome];
	if (!builder) {
		throw new Error(`Unknown nightly healer Slack outcome: "${outcome}"`);
	}
	return builder(details);
}

module.exports = { buildNightlyHealerSlackPayload };
