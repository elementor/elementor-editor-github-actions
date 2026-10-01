'use strict';

const { gh } = require('./gh');
const { setOutput } = require('./github-output');

// Agent runs that reproduce, fix and verify have taken 6-22 minutes, so
// checking before the first few minutes is only log noise.
const INITIAL_WAIT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const BRANCH_LAG_INTERVAL_MS = 30 * 1000;
const MAX_WAIT_MS = 45 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const FETCH_ATTEMPTS = 4;
const FETCH_RETRY_DELAY_MS = 15 * 1000;
const TERMINAL_STATUSES = new Set([
	'FINISHED',
	'ERROR',
	'CANCELLED',
	'EXPIRED',
]);
const PRODUCT_BUG_ESCALATION_MARKER = '🚨 Possible product bug';
const BASELINE_DRIFT_MARKER = '📸 Baseline drift';

/**
 * The two ways the agent may legitimately finish without pushing. Anything
 * else that finishes branchless is an RCA-only run, which is a failure.
 */
const HANDOFF_MARKERS = [
	{ marker: PRODUCT_BUG_ESCALATION_MARKER, handoff: 'product-bug' },
	{ marker: BASELINE_DRIFT_MARKER, handoff: 'baseline-drift' },
];

/**
 * The skill puts a marker on the last line only. An RCA that merely mentions
 * one earlier ("not a 📸 Baseline drift, because…") is not a handoff.
 */
function detectHandoff(result) {
	const lines = String(result ?? '')
		.replace(/\*/g, '')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const lastLine = lines[lines.length - 1] || '';
	const match = HANDOFF_MARKERS.find((entry) =>
		lastLine.includes(entry.marker),
	);
	return match ? match.handoff : '';
}

const BRANCH_LAG_REFETCHES = 3;

const NOT_FOUND = /HTTP 404/;

const {
	CURSOR_API_KEY,
	HEAL_AGENT_ID,
	HEAL_AGENT_RUN_ID,
	HEAL_BRANCH_NAME,
	HEAL_BASE_REF,
	GITHUB_REPOSITORY,
} = process.env;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function cursorRunBranch(run) {
	return run.git?.branches?.[0]?.name ?? '';
}

function shouldWaitForCursorBranch(run) {
	return (
		run.status === 'FINISHED' &&
		!cursorRunBranch(run) &&
		!detectHandoff(run.result)
	);
}

/**
 * Only the branch the agent was told to push counts. Any other branch it
 * reports is not the one this run named, dated, and will verify. A Cloud agent
 * can create that branch without committing to it, and an empty branch is no
 * fix, whether or not Cursor reports it.
 */
function resolveHealerBranch({ expectedBranch, commitsAhead }) {
	return expectedBranch && commitsAhead > 0 ? expectedBranch : '';
}

function countCommitsAhead({ repository, baseRef, branch }, run = gh) {
	try {
		return Number(
			run([
				'api',
				`repos/${repository}/compare/${baseRef}...${branch}`,
				'--jq',
				'.ahead_by',
			]).trim(),
		);
	} catch (error) {
		if (NOT_FOUND.test(`${error.stderr || ''}\n${error.message || ''}`)) {
			return 0;
		}
		throw error;
	}
}

function withResolvedBranch(run, branch) {
	return {
		...run,
		git: {
			...run.git,
			branches: branch ? [{ name: branch }] : [],
		},
	};
}

function evaluateHealerAgentRun(run) {
	const status = run.status;
	const branch = cursorRunBranch(run);
	const result = run.result ?? '';
	const handoff = detectHandoff(result);

	if (status !== 'FINISHED') {
		return {
			ok: false,
			status,
			branch,
			result,
			handoff: '',
			error: `Cloud agent run ended with status ${status}.`,
		};
	}

	if (!branch && !handoff) {
		return {
			ok: false,
			status,
			branch,
			result,
			handoff: '',
			error: 'Cloud agent finished without pushing a branch. RCA-only is not a fix. Push a wait-based test change, or hand off with "🚨 Possible product bug" or "📸 Baseline drift".',
		};
	}

	return { ok: true, status, branch, result, handoff };
}

function isRetryableFetchStatus(status) {
	return 429 === status || (status >= 500 && status < 600);
}

/**
 * The agent keeps running whatever happens here, so one 5xx or dropped
 * connection must not throw away a fix it is about to push.
 */
async function fetchRun({
	request = fetch,
	wait = sleep,
	attempts = FETCH_ATTEMPTS,
} = {}) {
	for (let attempt = 1; ; attempt++) {
		let response;
		try {
			response = await request(
				`https://api.cursor.com/v1/agents/${HEAL_AGENT_ID}/runs/${HEAL_AGENT_RUN_ID}`,
				{
					headers: { Authorization: `Bearer ${CURSOR_API_KEY}` },
				},
			);
		} catch (error) {
			if (attempt >= attempts) {
				throw error;
			}
			console.log(
				`::warning::Cloud agent status check failed (${error.message}); retrying (${attempt}/${attempts})`,
			);
			await wait(FETCH_RETRY_DELAY_MS * attempt);
			continue;
		}

		if (response.ok) {
			return response.json();
		}

		if (!isRetryableFetchStatus(response.status) || attempt >= attempts) {
			throw new Error(
				`Failed to fetch Cloud agent run status (HTTP ${response.status})`,
			);
		}

		console.log(
			`::warning::Cloud agent status check got HTTP ${response.status}; retrying (${attempt}/${attempts})`,
		);
		await wait(FETCH_RETRY_DELAY_MS * attempt);
	}
}

async function waitForCursorBranch(run) {
	let current = run;

	for (
		let attempt = 0;
		attempt < BRANCH_LAG_REFETCHES && shouldWaitForCursorBranch(current);
		attempt++
	) {
		console.log(
			`Cloud agent FINISHED with empty git.branches — waiting ${BRANCH_LAG_INTERVAL_MS / 1000}s for Cursor to attach the push (${attempt + 1}/${BRANCH_LAG_REFETCHES})`,
		);
		await sleep(BRANCH_LAG_INTERVAL_MS);
		current = await fetchRun();
	}

	return current;
}

async function main() {
	if (
		!CURSOR_API_KEY ||
		!HEAL_AGENT_ID ||
		!HEAL_AGENT_RUN_ID ||
		!HEAL_BASE_REF
	) {
		throw new Error(
			'CURSOR_API_KEY, HEAL_AGENT_ID, HEAL_AGENT_RUN_ID, and HEAL_BASE_REF are required.',
		);
	}

	const startedAt = Date.now();
	const deadline = startedAt + MAX_WAIT_MS;
	const elapsedMinutes = () =>
		Math.floor((Date.now() - startedAt) / MS_PER_MINUTE);

	console.log(
		`Waiting ${INITIAL_WAIT_MS / MS_PER_MINUTE} minutes before the first status check, then every ${POLL_INTERVAL_MS / 1000}s (limit ${MAX_WAIT_MS / MS_PER_MINUTE} minutes).`,
	);
	await sleep(INITIAL_WAIT_MS);
	let run = await fetchRun();

	while (!TERMINAL_STATUSES.has(run.status) && Date.now() < deadline) {
		console.log(
			`Cloud agent run status after ${elapsedMinutes()}m: ${run.status}`,
		);
		await sleep(POLL_INTERVAL_MS);
		run = await fetchRun();
	}

	if (!TERMINAL_STATUSES.has(run.status)) {
		throw new Error(
			`Cloud agent run did not finish within ${MAX_WAIT_MS / 60000} minutes (last status: ${run.status})`,
		);
	}

	run = await waitForCursorBranch(run);

	const commitsAhead = countCommitsAhead({
		repository: GITHUB_REPOSITORY,
		baseRef: HEAL_BASE_REF,
		branch: HEAL_BRANCH_NAME,
	});
	const branch = resolveHealerBranch({
		expectedBranch: HEAL_BRANCH_NAME,
		commitsAhead,
	});

	const reportedBranch = cursorRunBranch(run);

	if (reportedBranch && reportedBranch !== HEAL_BRANCH_NAME) {
		console.log(
			`::warning::Cloud agent reported branch ${reportedBranch}, not the ${HEAL_BRANCH_NAME} it was given. It is ignored.`,
		);
	} else if (!branch) {
		console.log(
			`${HEAL_BRANCH_NAME} has no commits ahead of ${HEAL_BASE_REF}, so the agent pushed no fix.`,
		);
	} else if (!reportedBranch) {
		console.log(
			`Cursor git.branches empty; using GitHub branch ${branch} (${commitsAhead} commit(s) ahead of ${HEAL_BASE_REF})`,
		);
	}

	const outcome = evaluateHealerAgentRun(withResolvedBranch(run, branch));

	console.log(
		`Cloud agent run finished with status ${outcome.status}; branch: ${outcome.branch || '(none pushed)'}`,
	);
	setOutput('status', outcome.status);
	setOutput('branch', outcome.branch);
	setOutput('result_text', outcome.result.replace(/\n/g, ' ').slice(0, 500));
	setOutput('handoff', outcome.handoff || '');

	if (!outcome.ok) {
		throw new Error(outcome.error);
	}
}

module.exports = {
	BASELINE_DRIFT_MARKER,
	PRODUCT_BUG_ESCALATION_MARKER,
	countCommitsAhead,
	detectHandoff,
	evaluateHealerAgentRun,
	fetchRun,
	isRetryableFetchStatus,
	resolveHealerBranch,
	shouldWaitForCursorBranch,
	withResolvedBranch,
};

if (require.main === module) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
