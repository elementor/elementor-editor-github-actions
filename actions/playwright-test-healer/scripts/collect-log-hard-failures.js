'use strict';

/**
 * Lists a run's hard test failures from its job logs, and, on a run with
 * none, the flaky tests that passed only on a retry.
 *
 * The merged Allure report is kept for 1 day and job logs for 90, so ranking
 * from logs is what lets the healer take an older run. Playwright's end-of-run
 * summary lists every test whose retries were exhausted under `N failed`, and
 * lists recovered tests separately under `N flaky`, so each block alone is
 * its own list.
 *
 * Every attempt of a re-run evidence run is read: a test that failed hard in
 * attempt 1 and passed on the re-run is still a hard failure worth healing.
 */

const fs = require('fs');
const { fetchJobLog } = require('./fetch-job-log');
const { listJobsAcrossAttempts } = require('./run-attempts');

const DEFAULT_HARD_FAILURES_PATH = 'log-hard-failures.json';
const DEFAULT_FLAKY_TESTS_PATH = 'log-flaky-tests.json';
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;
const FAILED_HEADER = /^\s+\d+ failed\s*$/;
const FLAKY_HEADER = /^\s+\d+ flaky\s*$/;
const LISTED_TEST = /^\s{4}(?:\[[^\]]+\] › )?\S+:\d+:\d+ › (.+?)\s*$/;
const TITLE_SEPARATOR = ' › ';

/**
 * `    tests/…/search-layout-2.test.ts:92:6 › Search widget layout test - #2 › Search Result Visibility`
 * yields `Search Result Visibility` — the leaf title, which is what Allure
 * names the test and what the rest of the healer matches on.
 */
function parseListedTitles(log, header) {
	const titles = [];
	let inBlock = false;

	for (const rawLine of String(log || '').split(/\r?\n/)) {
		const line = rawLine.replace(TIMESTAMP_PREFIX, '');

		if (header.test(line)) {
			inBlock = true;
			continue;
		}

		if (!inBlock) {
			continue;
		}

		const match = LISTED_TEST.exec(line);

		if (!match) {
			inBlock = false;
			continue;
		}

		titles.push(match[1].split(TITLE_SEPARATOR).pop());
	}

	return [...new Set(titles)];
}

function parseHardFailureTitles(log) {
	return parseListedTitles(log, FAILED_HEADER);
}

function parseFlakyTitles(log) {
	return parseListedTitles(log, FLAKY_HEADER);
}

function describeJobs(jobs) {
	const attempts = Math.max(1, ...jobs.map((job) => job.attempt));
	return `${jobs.length} job(s) across ${attempts} attempt(s)`;
}

function collectHardFailureTitles(repo, runId, deps = {}) {
	const { listJobs = listJobsAcrossAttempts, fetchLog = fetchJobLog } = deps;
	const failedJobs = listJobs(repo, runId, ['failure']);
	const titles = new Set();

	console.log(`Reading hard failures from ${describeJobs(failedJobs)}`);

	for (const { jobId } of failedJobs) {
		for (const title of parseHardFailureTitles(fetchLog(repo, jobId))) {
			titles.add(title);
		}
	}

	return [...titles];
}

/**
 * A flaky test makes no job fail, so on a green run every finished job's log
 * is read. Each entry counts how many jobs (shards, attempts) the test was
 * flaky in, which is how often it flaked that night.
 */
function collectFlakyTests(repo, runId, deps = {}) {
	const { listJobs = listJobsAcrossAttempts, fetchLog = fetchJobLog } = deps;
	const jobs = listJobs(repo, runId, ['success', 'failure']);
	const occurrences = new Map();

	console.log(`Reading flaky tests from ${describeJobs(jobs)}`);

	for (const { jobId } of jobs) {
		for (const title of parseFlakyTitles(fetchLog(repo, jobId))) {
			occurrences.set(title, (occurrences.get(title) || 0) + 1);
		}
	}

	return [...occurrences].map(([name, count]) => ({
		name,
		flakyCount: count,
	}));
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;
	const outputPath =
		process.env.HARD_FAILURES_PATH || DEFAULT_HARD_FAILURES_PATH;
	const flakyPath = process.env.FLAKY_TESTS_PATH || DEFAULT_FLAKY_TESTS_PATH;
	const healFlaky = 'false' !== process.env.HEAL_FLAKY;

	if (!repo || !runId) {
		throw new Error('GITHUB_REPOSITORY and SOURCE_RUN_ID are required.');
	}

	const titles = collectHardFailureTitles(repo, runId);

	console.log(
		`Hard failures in run ${runId} job logs: ${titles.length ? titles.join(', ') : '(none)'}`,
	);
	fs.writeFileSync(outputPath, JSON.stringify(titles));

	// Flaky tests are only a fallback, so a night with hard failures does
	// not pay for reading every passing job's log.
	if (titles.length > 0 || !healFlaky) {
		return;
	}

	const flaky = collectFlakyTests(repo, runId);

	console.log(
		`Flaky tests in run ${runId} job logs: ${flaky.length ? flaky.map((test) => test.name).join(', ') : '(none)'}`,
	);
	fs.writeFileSync(flakyPath, JSON.stringify(flaky));
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
	DEFAULT_FLAKY_TESTS_PATH,
	DEFAULT_HARD_FAILURES_PATH,
	collectFlakyTests,
	collectHardFailureTitles,
	parseFlakyTitles,
	parseHardFailureTitles,
};
