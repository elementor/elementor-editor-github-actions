'use strict';

const fs = require('fs');
const path = require('path');

const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');

const MAX_DISPATCH_ATTEMPTS = 4;
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const HEALER_SKILL_NAMES = ['heal-ci-playwright-test'];

/**
 * The agent's checkout starts from the PR base, which may not carry these
 * skills — or may carry an older version of them. Sending them in the prompt,
 * read from the commit this workflow runs from, keeps the agent's procedure in
 * step with the workflow that will verify its work.
 */
function readHealerSkills(skillsDir = SKILLS_DIR) {
	return HEALER_SKILL_NAMES.map((name) => {
		const skillPath = path.join(skillsDir, name, 'SKILL.md');

		if (!fs.existsSync(skillPath)) {
			throw new Error(`Healer skill not found at ${skillPath}.`);
		}

		return { name, content: fs.readFileSync(skillPath, 'utf8') };
	});
}
const DEFAULT_RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Cursor returns 429 when its GitHub App is rate limited fetching an
 * installation token — a transient condition it flags `isRetryable` with a
 * `retryAfter`. Failing the run on that loses a whole night to a blip.
 *
 * Creating an agent is not idempotent: after a 500, 502 or 504 the agent may
 * already exist, and a second POST starts another one on the same branch.
 * Only statuses that mean the request was not processed are retried.
 */
function isRetryableDispatchStatus(status) {
	return 429 === status || 503 === status;
}

/**
 * Prefers the server's own `retryAfter` (seconds, nested in Cursor's error
 * details) over a fixed backoff, and never waits longer than five minutes.
 */
function dispatchRetryDelayMs(body, attempt) {
	const retryAfter = Number(
		body?.details?.[0]?.debug?.details?.additionalInfo?.retryAfter,
	);

	const delay =
		Number.isFinite(retryAfter) && retryAfter > 0
			? retryAfter * 1000
			: DEFAULT_RETRY_DELAY_MS * attempt;

	return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const {
	CURSOR_API_KEY,
	GITHUB_REPOSITORY,
	HEAL_TEST_NAME,
	HEAL_RUN_URL,
	HEAL_BRANCH_NAME,
	HEAL_SHARD_INDEX,
	HEAL_MATCHED_DIRS,
	HEAL_STARTING_REF,
	HEAL_ATTEMPT,
	HEAL_MAX_ATTEMPTS,
	HEAL_PREVIOUS_BRANCH,
	HEAL_PREVIOUS_RUN_ID,
} = process.env;

/**
 * Takes its input explicitly so the prompt can be unit-tested; defaults to the
 * environment the workflow provides.
 */
function buildPrompt({
	testName = HEAL_TEST_NAME,
	runUrl = HEAL_RUN_URL,
	shardIndex = HEAL_SHARD_INDEX,
	branchName = HEAL_BRANCH_NAME,
	matchedDirs = HEAL_MATCHED_DIRS,
	startingRef = HEAL_STARTING_REF,
	attempt = HEAL_ATTEMPT,
	maxAttempts = HEAL_MAX_ATTEMPTS,
	previousBranch = HEAL_PREVIOUS_BRANCH,
	previousRunId = HEAL_PREVIOUS_RUN_ID,
	skills = readHealerSkills(),
	profile = loadProfile(),
} = {}) {
	const attemptNumber = Number(attempt) || 1;
	const attemptTotal = Number(maxAttempts) || 1;
	const baseRef = startingRef || 'main';

	// A retry is only useful if the agent knows what already failed and why.
	// Without this it re-derives the same fix and burns the remaining budget.
	const retryLines =
		attemptNumber > 1 && previousBranch
			? [
					'',
					`This is attempt ${attemptNumber} of ${attemptTotal}. A previous attempt pushed branch "${previousBranch}" and its fix FAILED verification: the test still failed when re-run against the same build.`,
					`Before writing anything, run \`git fetch origin ${previousBranch} && git diff ${baseRef}...FETCH_HEAD\` and read what was already tried. Do not repeat that approach — if it were right, it would have verified.`,
					...(previousRunId
						? [
								`The failing re-run's output is on healer run ${previousRunId}, artifact "healer-verify-failure-test-results" — download it and read the new error-context.md and trace before deciding.`,
							]
						: []),
					'If the previous attempt looks correct to you and still failed, that is evidence this is not a race: consider the baseline-drift or product-bug handoff instead of a third wait.',
				]
			: [];
	const skillSections = skills.flatMap((skill) => [
		'',
		`===== SKILL: ${skill.name} =====`,
		skill.content.trim(),
		`===== END SKILL: ${skill.name} =====`,
	]);

	return [
		'Follow the heal-ci-playwright-test skill, included in full at the end of this prompt, to investigate and fix exactly one Playwright CI failure. It runs the /fix-playwright-test skill from the Testing plugin unattended; where they disagree heal-ci-playwright-test wins.',
		'If /fix-playwright-test is not in your available skills, do not improvise its method: stop and report "fix-playwright-test skill unavailable" as your only output.',
		'This assignment is complete in exactly one of three ways: you push a fix, you print the baseline-drift line, or you print the product-bug line. An RCA with none of the three is a failure. Most candidates are races and should end in a push — but do not force a candidate into that box to avoid finishing.',
		'',
		`Failing test: "${testName}"`,
		`Evidence run: ${runUrl}`,
		shardIndex
			? `Failed shard: ${shardIndex} — the evidence is in that run's playwright-test-results artifact for this shard ("playwright-test-results-${shardIndex}", named as the Repository notes describe). Download that one; do not guess from the Allure title.`
			: 'Failed shard: unknown — find the failed job in that run and download its playwright-test-results-* artifact.',
		`Matching test-results directories inside that artifact to inspect for error-context.md/trace.zip: ${matchedDirs}`,
		'',
		`Commit and push your fix to a new branch named exactly "${branchName}", starting from git ref "${baseRef}" (the PR base, not the failing CI run). Only commit files under tests/playwright/. Do not commit healer workflow or skill files. Do NOT open a pull request — a separate CI job verifies the fix and opens the PR.`,
		'Decide race vs baseline drift vs product bug before changing anything; the skill has the decision table.',
		'Locator timeout: first confirm the element exists in that DOM state — a locator that never resolved usually means it does not, and a wait will not help. If it exists and its request already returned 200, it is a race: wait in tests/playwright/ for the locator the test already expects, then push. Empty preview or a missing results list after a 200 is a race, not a product bug.',
		'Screenshot diffs: if the actual varies between retries or shows unfinished UI, it is a race — wait for the settled state and push. If every retry is byte-identical and shows fully rendered UI that simply differs from the baseline, that is version baseline drift: do not push a wait, and print exactly "📸 Baseline drift: ... No fix pushed — needs a versioned baseline." Never update, replace, or add snapshot images in either case.',
		'Hand off without a push only if you print exactly "🚨 Possible product bug: ..." AND the trace shows a crash, PHP/JS exception overlay, or HTTP 5xx.',
		"Before pushing, run the test locally as the skill's Local run section describes; a locator you added that never resolves locally must be fixed, not pushed.",
		...retryLines,
		'',
		`Repository notes (${profile.displayName}):`,
		`- Evidence: ${profile.agent.evidence}`,
		`- Local run: ${profile.agent.localRun}`,
		`- Baseline drift: ${profile.agent.baselineDrift}`,
		...skillSections,
	].join('\n');
}

async function main() {
	if (!CURSOR_API_KEY) {
		throw new Error('CURSOR_API_KEY is required.');
	}

	let response;
	let body;

	for (let attempt = 1; attempt <= MAX_DISPATCH_ATTEMPTS; attempt++) {
		response = await fetch('https://api.cursor.com/v1/agents', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${CURSOR_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				prompt: { text: buildPrompt() },
				repos: [
					{
						url: `https://github.com/${GITHUB_REPOSITORY}`,
						startingRef: HEAL_STARTING_REF || 'main',
					},
				],
				autoCreatePR: false,
			}),
		});

		body = await response.json().catch(() => ({}));

		if (response.ok) {
			break;
		}

		if (
			!isRetryableDispatchStatus(response.status) ||
			attempt === MAX_DISPATCH_ATTEMPTS
		) {
			throw new Error(
				`Cloud agent dispatch failed (HTTP ${response.status}): ${JSON.stringify(body)}`,
			);
		}

		const delay = dispatchRetryDelayMs(body, attempt);
		console.log(
			`::warning::Cloud agent dispatch got HTTP ${response.status}; retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_DISPATCH_ATTEMPTS})`,
		);
		await sleep(delay);
	}

	console.log(`Dispatched Cloud agent ${body.agent.id}, run ${body.run.id}`);
	setOutput('agent_id', body.agent.id);
	setOutput('run_id', body.run.id);
}

if (require.main === module) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}

module.exports = {
	buildPrompt,
	dispatchRetryDelayMs,
	isRetryableDispatchStatus,
	readHealerSkills,
};
