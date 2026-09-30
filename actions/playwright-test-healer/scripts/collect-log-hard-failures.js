'use strict';

/**
 * Lists a run's hard test failures from its job logs.
 *
 * The merged Allure report is kept for 1 day and job logs for 90, so ranking
 * from logs is what lets the healer take an older run. Playwright's end-of-run
 * summary lists every test whose retries were exhausted under `N failed`, and
 * lists recovered tests separately under `N flaky`, so that block alone is
 * the hard-failure list.
 */

const fs = require('fs');
const { fetchJobLog } = require('./fetch-job-log');
const { gh } = require('./gh');

const DEFAULT_HARD_FAILURES_PATH = 'log-hard-failures.json';
const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;
const FAILED_HEADER = /^\s+\d+ failed\s*$/;
const LISTED_TEST = /^\s{4}(?:\[[^\]]+\] › )?\S+:\d+:\d+ › (.+?)\s*$/;
const TITLE_SEPARATOR = ' › ';

/**
 * `    tests/…/search-layout-2.test.ts:92:6 › Search widget layout test - #2 › Search Result Visibility`
 * yields `Search Result Visibility` — the leaf title, which is what Allure
 * names the test and what the rest of the healer matches on.
 */
function parseHardFailureTitles(log) {
	const titles = [];
	let inFailedBlock = false;

	for (const rawLine of String(log || '').split(/\r?\n/)) {
		const line = rawLine.replace(TIMESTAMP_PREFIX, '');

		if (FAILED_HEADER.test(line)) {
			inFailedBlock = true;
			continue;
		}

		if (!inFailedBlock) {
			continue;
		}

		const match = LISTED_TEST.exec(line);

		if (!match) {
			inFailedBlock = false;
			continue;
		}

		titles.push(match[1].split(TITLE_SEPARATOR).pop());
	}

	return [...new Set(titles)];
}

function listFailedJobIds(repo, runId) {
	return gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/jobs`,
		'--paginate',
		'--jq',
		'.jobs[] | select(.conclusion == "failure") | .id',
	])
		.split('\n')
		.map((id) => id.trim())
		.filter(Boolean);
}

function collectHardFailureTitles(repo, runId) {
	const titles = new Set();

	for (const jobId of listFailedJobIds(repo, runId)) {
		const log = fetchJobLog(repo, jobId);

		for (const title of parseHardFailureTitles(log)) {
			titles.add(title);
		}
	}

	return [...titles];
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;
	const outputPath =
		process.env.HARD_FAILURES_PATH || DEFAULT_HARD_FAILURES_PATH;

	if (!repo || !runId) {
		throw new Error('GITHUB_REPOSITORY and SOURCE_RUN_ID are required.');
	}

	const titles = collectHardFailureTitles(repo, runId);

	console.log(
		`Hard failures in run ${runId} job logs: ${titles.length ? titles.join(', ') : '(none)'}`,
	);
	fs.writeFileSync(outputPath, JSON.stringify(titles));
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { DEFAULT_HARD_FAILURES_PATH, parseHardFailureTitles };
