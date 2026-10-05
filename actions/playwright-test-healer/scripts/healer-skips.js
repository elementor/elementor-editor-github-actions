'use strict';

/**
 * Reasons the healer must not take a test, gathered from GitHub itself:
 *
 *  - An open PR into the same branch already exists for it, whoever opened it
 *    and however it is labelled. Without this the healer re-heals a test a
 *    person or an on-demand run is already fixing.
 *  - A recent healer run already reached a verdict on it without a PR. Ranking
 *    is deterministic, so without this the same unhealable test is picked
 *    first every night and the rest of the failures never get a turn.
 *
 * Each healer run records its verdict as a `healer-attempt` artifact. That is
 * the whole ledger: no store to provision, and it expires on its own.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHealableBase } = require('./evidence-run');
const { gh } = require('./gh');

const ATTEMPT_ARTIFACT_NAME = 'healer-attempt';
const ATTEMPT_RECORD_FILE = 'healer-attempt.json';
const DEFAULT_OPEN_PRS_PATH = 'healer-open-prs.json';
const DEFAULT_ATTEMPTS_PATH = 'healer-attempts.json';
const HEAL_BRANCH_PREFIX = 'heal/';
const HEAL_BRANCH_SLUG_MAX_LENGTH = 40;
const COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OPEN_PRS = 500;
const HEALER_RUN_EVENTS = new Set(['schedule', 'workflow_dispatch']);

/**
 * Outcomes that are a verdict on the test, or that left a fix branch waiting
 * for a person, so a rerun on the same failure would spend another agent run
 * to reach the same answer. Infrastructure and agent errors are not here: they
 * say nothing about the test.
 */
const COOLDOWN_OUTCOMES = new Set([
	'agent-baseline-drift',
	'agent-escalated',
	'unreproduced-pr-limit',
	'verification-failed',
]);

/**
 * Must stay identical to the branch name the healer gives its agent, or an
 * open healer PR is not recognised by its branch.
 */
function buildHealBranchSlug(testName) {
	return String(testName || '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, HEAL_BRANCH_SLUG_MAX_LENGTH)
		.replace(/-$/, '');
}

function buildHealBranchName(testName, runId) {
	return `${HEAL_BRANCH_PREFIX}${buildHealBranchSlug(testName)}-${runId}`;
}

/**
 * Healer PR titles are truncated, so a healer PR is recognised by its branch.
 * A PR someone opened by hand is recognised by naming the test in its title.
 * Bodies are not searched: they mention tests in passing, and the healer's
 * own PR lists example tests that would then never be healed.
 *
 * Only PRs into the branch being healed count: a fix or cherry-pick into
 * another release branch does not fix this one, and a duplicate is cheaper
 * than a failure nobody heals.
 */
function findOpenPrForTest(testName, openPrs, baseRef = '') {
	const name = String(testName || '')
		.trim()
		.toLowerCase();
	const slug = buildHealBranchSlug(testName);

	if (!name) {
		return null;
	}

	const healBranchPattern = new RegExp(`^${HEAL_BRANCH_PREFIX}${slug}-\\d+$`);

	return (
		(openPrs || []).find(
			(pr) =>
				(!baseRef || pr.baseRefName === baseRef) &&
				(healBranchPattern.test(pr.headRefName || '') ||
					String(pr.title || '')
						.toLowerCase()
						.includes(name)),
		) || null
	);
}

function findRecentVerdict(testName, attempts, now = Date.now()) {
	const since = now - COOLDOWN_DAYS * DAY_MS;

	return (
		(attempts || [])
			.filter(
				(attempt) =>
					attempt.testName === testName &&
					COOLDOWN_OUTCOMES.has(attempt.outcome) &&
					Date.parse(attempt.recordedAt) >= since,
			)
			.sort(
				(a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt),
			)[0] || null
	);
}

/**
 * @return {null|{reason: string, prUrl?: string, outcome?: string, runUrl?: string, recordedAt?: string}}
 */
function findSkipReason(testName, { openPrs, attempts, now, baseRef }) {
	const openPr = findOpenPrForTest(testName, openPrs, baseRef);

	if (openPr) {
		return { reason: 'open-pr', prUrl: openPr.url };
	}

	const verdict = findRecentVerdict(testName, attempts, now);

	if (verdict) {
		return {
			reason: 'recent-verdict',
			outcome: verdict.outcome,
			runUrl: verdict.runUrl,
			recordedAt: verdict.recordedAt,
		};
	}

	return null;
}

function readSkipSources(
	openPrsPath = DEFAULT_OPEN_PRS_PATH,
	attemptsPath = DEFAULT_ATTEMPTS_PATH,
) {
	return {
		openPrs: JSON.parse(fs.readFileSync(openPrsPath, 'utf8')),
		attempts: JSON.parse(fs.readFileSync(attemptsPath, 'utf8')),
	};
}

function listOpenPrs(repo) {
	return JSON.parse(
		gh([
			'pr',
			'list',
			'--repo',
			repo,
			'--state',
			'open',
			'--limit',
			String(MAX_OPEN_PRS),
			'--json',
			'number,url,title,headRefName,baseRefName',
		]),
	);
}

/**
 * The artifact list is repo-wide, so it also holds whatever a fork's pull
 * request run uploaded under the same name. Only the healer's own runs, on a
 * branch it heals, may bench a test.
 */
function isTrustedAttemptRun({
	repositoryId,
	headRepositoryId,
	headBranch,
	event,
}) {
	return (
		Boolean(repositoryId) &&
		repositoryId === headRepositoryId &&
		isHealableBase(headBranch) &&
		HEALER_RUN_EVENTS.has(event)
	);
}

function parseAttemptRecord(text) {
	const record = JSON.parse(text);

	if (
		!record ||
		'string' !== typeof record.testName ||
		!record.testName.trim() ||
		'string' !== typeof record.outcome
	) {
		throw new Error('it has no testName or outcome');
	}

	return record;
}

function listRecentAttemptArtifacts(repo, now) {
	const since = now - COOLDOWN_DAYS * DAY_MS;
	const output = gh([
		'api',
		`repos/${repo}/actions/artifacts?name=${ATTEMPT_ARTIFACT_NAME}&per_page=100`,
		'--paginate',
		'--jq',
		'.artifacts[] | select(.expired == false) | {runId: .workflow_run.id, createdAt: .created_at, repositoryId: .workflow_run.repository_id, headRepositoryId: .workflow_run.head_repository_id, headBranch: .workflow_run.head_branch} | tojson',
	]);

	return output
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((artifact) => Date.parse(artifact.createdAt) >= since);
}

function readRunEvent(repo, runId) {
	return gh([
		'api',
		`repos/${repo}/actions/runs/${runId}`,
		'--jq',
		'.event',
	]).trim();
}

function readAttempt(repo, { runId, createdAt }) {
	const downloadDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'healer-attempt-'),
	);

	try {
		execFileSync(
			'gh',
			[
				'run',
				'download',
				runId,
				'--repo',
				repo,
				'-n',
				ATTEMPT_ARTIFACT_NAME,
				'-D',
				downloadDir,
			],
			{ stdio: 'inherit' },
		);
		const record = parseAttemptRecord(
			fs.readFileSync(
				path.join(downloadDir, ATTEMPT_RECORD_FILE),
				'utf8',
			),
		);

		return {
			...record,
			recordedAt: createdAt,
			runUrl: `https://github.com/${repo}/actions/runs/${runId}`,
		};
	} finally {
		fs.rmSync(downloadDir, { recursive: true, force: true });
	}
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const openPrsPath =
		process.env.HEALER_OPEN_PRS_PATH || DEFAULT_OPEN_PRS_PATH;
	const attemptsPath =
		process.env.HEALER_ATTEMPTS_PATH || DEFAULT_ATTEMPTS_PATH;

	if (!repo) {
		throw new Error('GITHUB_REPOSITORY is required.');
	}

	const now = Date.now();
	const openPrs = listOpenPrs(repo);
	const attempts = listRecentAttemptArtifacts(repo, now).flatMap(
		(artifact) => {
			const runUrl = `https://github.com/${repo}/actions/runs/${artifact.runId}`;

			try {
				const event = readRunEvent(repo, artifact.runId);

				if (!isTrustedAttemptRun({ ...artifact, event })) {
					console.log(
						`::warning::Ignoring the ${ATTEMPT_ARTIFACT_NAME} record from ${runUrl}: a ${event} run on ${artifact.headBranch}, not a healer run here.`,
					);
					return [];
				}

				return [readAttempt(repo, artifact)];
			} catch (error) {
				console.log(
					`::warning::Ignoring the ${ATTEMPT_ARTIFACT_NAME} record from ${runUrl}: ${error.message}`,
				);
				return [];
			}
		},
	);

	fs.writeFileSync(openPrsPath, JSON.stringify(openPrs));
	fs.writeFileSync(attemptsPath, JSON.stringify(attempts));

	console.log(
		`${openPrs.length} open PRs; ${attempts.length} healer attempts in the last ${COOLDOWN_DAYS} days:`,
	);
	for (const attempt of attempts) {
		console.log(
			`  ${attempt.recordedAt}  ${attempt.outcome}  ${attempt.testName}  ${attempt.runUrl}`,
		);
	}
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	ATTEMPT_RECORD_FILE,
	COOLDOWN_DAYS,
	COOLDOWN_OUTCOMES,
	buildHealBranchName,
	buildHealBranchSlug,
	findOpenPrForTest,
	findRecentVerdict,
	findSkipReason,
	isTrustedAttemptRun,
	listOpenPrs,
	parseAttemptRecord,
	readSkipSources,
};
