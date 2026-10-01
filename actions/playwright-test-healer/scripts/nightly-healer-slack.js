'use strict';

function section(text) {
	return { type: 'section', text: { type: 'mrkdwn', text } };
}

/**
 * Slack reads `<...>` as a link or a mention, so an agent summary that says
 * `<!channel>` would ping everyone. Links the healer builds itself stay raw.
 */
function escapeMrkdwn(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

const OUTCOME_BUILDERS = {
	disabled: ({ healerSwitch }) => ({
		text: 'Test Healer: switched off',
		blocks: [
			section(
				`⏸️ *Test Healer: switched off*\n\`vars.TEST_HEALER_ENABLED\` is \`${escapeMrkdwn(healerSwitch || 'off')}\` — nothing ran.`,
			),
		],
	}),
	'test-has-open-pr': ({ testName, existingPrUrl }) => ({
		text: 'Test Healer: skipped — this test already has an open PR',
		blocks: [
			section(
				`⏭️ *Test Healer: skipped*\nTest: *${escapeMrkdwn(testName)}*\nIt already has an open PR: <${existingPrUrl}|View PR>. No duplicate was opened.`,
			),
		],
	}),
	'all-candidates-skipped': ({ skippedCandidates }) => ({
		text: 'Nightly Test Healer: every candidate was skipped',
		blocks: [
			section(
				`⏭️ *Nightly Test Healer: nothing ran*\nEvery failure with evidence has an open PR or a recent healer verdict:\n${skippedCandidates.map((skip) => `• ${escapeMrkdwn(skip.testName)} (${escapeMrkdwn(skip.reason)})`).join('\n')}`,
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
				`⚠️ *Nightly Test Healer: no PR opened*\nHard failures were found, but none had a matching trace/log artifact to investigate from:\n${rankedFailures.map((name) => `• ${escapeMrkdwn(name)}`).join('\n')}`,
			),
		],
	}),
	'no-manual-evidence': ({ testName }) => ({
		text: 'Test Healer: no failure artifact for the requested test',
		blocks: [
			section(
				`⚠️ *Test Healer: no PR opened*\nNo recent CI failure artifact found for *${escapeMrkdwn(testName)}*, so there was nothing to investigate from.`,
			),
		],
	}),
	'verification-infra-failed': ({ testName, stage, branch }) => ({
		text: 'Test Healer: verification environment failed',
		blocks: [
			section(
				`🧰 *Test Healer: could not verify*\nTest: *${escapeMrkdwn(testName)}*\nThe verification environment failed at \`${escapeMrkdwn(stage)}\`, so the fix on \`${escapeMrkdwn(branch)}\` is untested — this is not a verdict on the fix.`,
			),
		],
	}),
	'verified-branch': ({ testName, branch }) => ({
		text: 'Test Healer: branch verified',
		blocks: [
			section(
				`✅ *Test Healer: branch verified (verify-only, no PR opened)*\nTest: *${escapeMrkdwn(testName)}*\nBranch: \`${escapeMrkdwn(branch)}\``,
			),
		],
	}),
	'verification-baseline-neighbour-failed': ({ testName, branch }) => ({
		text: 'Test Healer: another test failed first, fix not run',
		blocks: [
			section(
				`🧰 *Test Healer: could not verify, no PR opened*\nTest: *${escapeMrkdwn(testName)}*\nAnother test in the file failed before the target during the baseline run, so the fix on \`${escapeMrkdwn(branch)}\` was not run. This is not a verdict on the test or the fix.`,
			),
		],
	}),
	'verification-scope-violation': ({ testName, branch }) => ({
		text: 'Test Healer: fix rejected for touching files out of scope',
		blocks: [
			section(
				`⛔ *Test Healer: fix rejected, no PR opened*\nTest: *${escapeMrkdwn(testName)}*\nThe fix on \`${escapeMrkdwn(branch)}\` changes files the healer may not touch — outside \`tests/playwright/\`, snapshot baselines, or environment config — so it was not run.`,
			),
		],
	}),
	'agent-escalated': ({ testName, summary }) => ({
		text: 'Nightly Test Healer: agent escalated a possible product bug',
		blocks: [
			section(
				`🚨 *Nightly Test Healer: escalated, no PR opened*\nTest: *${escapeMrkdwn(testName)}*\n${escapeMrkdwn(summary)}`,
			),
		],
	}),
	'agent-baseline-drift': ({ testName, shardIndex, summary }) => ({
		text: 'Test Healer: baseline drift, no PR opened',
		blocks: [
			section(
				`📸 *Test Healer: baseline drift, no PR opened*\nTest: *${escapeMrkdwn(testName)}*${shardIndex ? `\nShard: \`${escapeMrkdwn(shardIndex)}\`` : ''}\n${escapeMrkdwn(summary)}\nThe UI renders differently rather than racing — this needs a version-gated snapshot and a new fallback baseline, which the healer may not add.`,
			),
		],
	}),
	'agent-error': ({ testName, status }) => ({
		text: 'Nightly Test Healer: Cloud agent run failed',
		blocks: [
			section(
				`❌ *Nightly Test Healer: agent failed*\nTest: *${escapeMrkdwn(testName)}*\nAgent run ended with status: ${escapeMrkdwn(status)}`,
			),
		],
	}),
	'verification-failed': ({ testName, branch }) => ({
		text: 'Nightly Test Healer: fix did not verify',
		blocks: [
			section(
				`❌ *Nightly Test Healer: fix did not verify*\nTest: *${escapeMrkdwn(testName)}*\nThe re-run against the nightly build still failed. Branch left for manual pickup: \`${escapeMrkdwn(branch)}\`.`,
			),
		],
	}),
	'pr-open-failed': ({ testName, branch }) => ({
		text: 'Test Healer: fix verified, but the PR could not be opened',
		blocks: [
			section(
				`⚠️ *Test Healer: fix verified, no PR opened*\nTest: *${escapeMrkdwn(testName)}*\nThe fix verified, but the PR could not be opened; branch \`${escapeMrkdwn(branch)}\` is left for manual pickup, see the run.`,
			),
		],
	}),
	'unreproduced-pr-limit': ({ testName, branch }) => ({
		text: 'Test Healer: too many open unreproduced drafts, no PR opened',
		blocks: [
			section(
				`⏸️ *Test Healer: unreproduced draft limit reached, no PR opened*\nTest: *${escapeMrkdwn(testName)}*\nThe failure did not reproduce and enough unreproduced healer drafts are already open, so no draft or Jira task was created. Branch \`${escapeMrkdwn(branch)}\` is left for manual pickup.`,
			),
		],
	}),
	healed: ({ prUrl, testName, shardIndex, jiraUrl, rca, reproduced }) => {
		const links = [`<${prUrl}|View PR>`];

		if (jiraUrl) {
			links.push(`<${jiraUrl}|Jira ticket>`);
		}

		const headline =
			false === reproduced
				? '⚠️ *Test Healer: opened a draft PR — the failure did not reproduce, so the fix is unproven*'
				: '✅ *Test Healer: opened a PR*';
		const blocks = [
			section(
				`${headline}\nTest: *${escapeMrkdwn(testName)}*${shardIndex ? `\nShard: \`${escapeMrkdwn(shardIndex)}\`` : ''}\n${links.join(' · ')}`,
			),
		];

		if (rca) {
			blocks.push(section(`*RCA:* ${escapeMrkdwn(rca)}`));
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
