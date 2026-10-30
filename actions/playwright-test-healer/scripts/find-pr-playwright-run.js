'use strict';

/**
 * Finds the pull request run whose Playwright failures the PR healer reads:
 * the newest run of the product's PR workflow on the PR's branch that started
 * before the healer did and actually ran Playwright.
 *
 * The run may be on an earlier commit than the head. Bots merge main into PR
 * branches, which moves the head to a commit whose run has not finished, or
 * never ran Playwright; the failures the person saw are on the commit before.
 *
 * Runs that start with or after the healer are left out. Adding the label is
 * itself a `labeled` event the PR workflow listens to, so it starts a fresh
 * run in the same second as the healer; that run re-runs only the previous
 * failures, and is not the one the person asking for a heal was looking at.
 */

const { gh } = require('./gh');
const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');

const PLAYWRIGHT_JOB = /playwright/i;
const RAN_CONCLUSIONS = new Set(['success', 'failure']);
const WAIT_INTERVAL_MS = 60 * 1000;
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;
// How long before the healer's own run a run from the same label event can be
// created. A run the person was looking at is minutes older.
const LABEL_EVENT_MARGIN_MS = 60 * 1000;

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listPrRuns({ repo, workflow, headRef }) {
	return JSON.parse(
		gh([
			'api',
			`repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(headRef)}&per_page=50`,
		]),
	).workflow_runs;
}

function getRun(repo, runId) {
	return JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
}

function listJobs(repo, runId) {
	return gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
		'--paginate',
		'--jq',
		'.jobs[] | tojson',
	])
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Pull request runs of this workflow on the PR's branch, from the PR's own
 * head repository, created more than a margin before the healer, newest first.
 */
function candidateRuns(runs, { healerCreatedAt, headRepository }) {
	const cutoff = healerCreatedAt
		? Date.parse(healerCreatedAt) - LABEL_EVENT_MARGIN_MS
		: Infinity;

	return (runs || [])
		.filter(
			(run) =>
				['pull_request', 'pull_request_target'].includes(run.event) &&
				(!headRepository ||
					run.head_repository?.full_name === headRepository) &&
				Date.parse(run.created_at) < cutoff,
		)
		.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * A run counts only if a Playwright job in it ran to a pass or a failure.
 * Docs-only PRs, drafts and cancelled runs skip or stop Playwright.
 */
function ranPlaywright(jobs) {
	return (jobs || []).some(
		(job) =>
			PLAYWRIGHT_JOB.test(job.name) &&
			RAN_CONCLUSIONS.has(job.conclusion),
	);
}

function waitForRun(repo, run, wait = sleep, fetch = getRun) {
	const deadline = Date.now() + MAX_WAIT_MS;
	let current = run;

	while ('completed' !== current.status) {
		if (Date.now() > deadline) {
			throw new Error(
				`PR run ${run.id} did not complete within ${MAX_WAIT_MS / 60000} minutes.`,
			);
		}
		console.log(`PR run ${run.id} is '${current.status}' — waiting 60s.`);
		wait(WAIT_INTERVAL_MS);
		current = fetch(repo, run.id);
	}

	return current;
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const headSha = process.env.PR_HEAD_SHA;
	const headRef = process.env.PR_HEAD_REF;
	const headRepository = process.env.PR_HEAD_REPOSITORY;
	const healerRunId = process.env.HEALER_RUN_ID;
	const workflow = loadProfile().prWorkflow;

	if (!repo || !headSha || !headRef || !healerRunId) {
		throw new Error(
			'GITHUB_REPOSITORY, PR_HEAD_SHA, PR_HEAD_REF and HEALER_RUN_ID are required.',
		);
	}

	const healerCreatedAt = getRun(repo, healerRunId).created_at;
	const runs = candidateRuns(listPrRuns({ repo, workflow, headRef }), {
		healerCreatedAt,
		headRepository,
	});

	// Only the newest run on the head commit is waited for: the person who
	// added the label most likely added it while looking at that run. One on
	// an older commit is being cancelled as superseded.
	if (
		runs.length &&
		'completed' !== runs[0].status &&
		headSha === runs[0].head_sha
	) {
		runs[0] = waitForRun(repo, runs[0]);
	}

	const run = runs.find(
		(candidate) =>
			'completed' === candidate.status &&
			ranPlaywright(listJobs(repo, candidate.id)),
	);

	if (!run) {
		console.log(
			`::notice::No finished ${workflow} run on ${headRef} ran Playwright.`,
		);
		setOutput('found', 'false');
		return;
	}

	console.log(
		`Reading failures from ${workflow} run ${run.id} (${run.conclusion}) on ${run.head_sha.slice(0, 12)}: ${run.html_url}`,
	);
	if (run.head_sha !== headSha) {
		console.log(
			`::notice::The PR head ${headSha.slice(0, 12)} has no finished run that ran Playwright; using the one on ${run.head_sha.slice(0, 12)}.`,
		);
	}
	setOutput('found', 'true');
	setOutput('source_run_id', String(run.id));
	setOutput('source_run_url', run.html_url);
	setOutput('source_sha', run.head_sha);
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { candidateRuns, ranPlaywright, waitForRun };
