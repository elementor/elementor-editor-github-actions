'use strict';

/**
 * Runs the healed test for the verify job and reads the JSON report, so the
 * workflow can tell the target test failing apart from a neighbour failing.
 *
 * Two scopes:
 *  - `test` runs the one test by grep.
 *  - `file` runs its whole spec file. A failure that depends on what ran
 *    before it in the file (the nightly runs files in order) rarely shows up
 *    when the test runs alone, and a fix checked alone proves nothing there.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePlaywrightListTotal } = require('./resolve-shard-command');

const SCOPE_TEST = 'test';
const SCOPE_FILE = 'file';

// Failing on the Nth run means a failure rate of about 1/N. A fix that does
// nothing then passes 3N runs in a row with probability (1 - 1/N)^3N, which
// is about e^-3, 5%, whatever N is.
const FIX_RUNS_PER_BASELINE_RUN = 3;
const MAX_FIX_REPEAT = { [SCOPE_TEST]: 30, [SCOPE_FILE]: 10 };
// Kept low enough that 3N never reaches the file cap: a whole file is slow.
const MAX_BASELINE_FILE_REPEAT = 3;

const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);
const TEST_FILE_IN_LIST = /(\S+\.(?:test|spec)\.[cm]?[jt]sx?):\d+:\d+\s+›/;
const MAX_FAILURES_NOTICE =
	/^Testing stopped early after \d+ maximum allowed failures?\.?$/;

function parseTestFile(listOutput) {
	const match = TEST_FILE_IN_LIST.exec(String(listOutput || ''));
	return match ? match[1] : '';
}

function collectSpecs(suites, specs = []) {
	for (const suite of suites || []) {
		specs.push(...(suite.specs || []));
		collectSpecs(suite.suites, specs);
	}
	return specs;
}

/**
 * A test that failed and then passed on a retry is a failure here, not a pass:
 * `--retries=0` is not the last word, because `test.describe.configure({ retries })`
 * in the spec overrides it, and the spec is the agent's to edit.
 */
function testStatus(test) {
	const results = test.results || [];

	if (!results.length) {
		return 'skipped';
	}

	const failed = results.find((result) => FAILED_STATUSES.has(result.status));

	return failed ? failed.status : results[results.length - 1].status;
}

/**
 * @param {Object} report   Playwright JSON report.
 * @param {string} testName Exact title of the healed test.
 * @return {{targetPasses: number, targetFailed: boolean, otherFailed: boolean}} What happened to the target and to everything else.
 */
function summarizeReport(report, testName) {
	const summary = {
		targetPasses: 0,
		targetFailed: false,
		otherFailed: false,
	};

	for (const spec of collectSpecs(report && report.suites)) {
		const isTarget = spec.title === testName;

		for (const test of spec.tests || []) {
			const status = testStatus(test);

			if (isTarget && 'passed' === status) {
				summary.targetPasses++;
			} else if (FAILED_STATUSES.has(status)) {
				summary[isTarget ? 'targetFailed' : 'otherFailed'] = true;
			}
		}
	}

	return summary;
}

/**
 * A global-setup crash or a config error leaves a report with no test results
 * and the reason under `errors`. Read as a summary, that is a test that never
 * failed — which would turn a broken environment into "did not reproduce".
 */
function assertTestsRan(report, summary, scope) {
	const errors = ((report && report.errors) || []).filter(
		(error) =>
			!MAX_FAILURES_NOTICE.test(
				String(error.message || '').split('\n')[0],
			),
	);

	if (errors.length) {
		const first = String(errors[0].message || '').split('\n')[0];
		throw new Error(
			`Playwright reported ${errors.length} error(s) outside any test in the ${scope} run: ${first}`,
		);
	}

	if (
		!summary.targetPasses &&
		!summary.targetFailed &&
		!summary.otherFailed
	) {
		throw new Error(
			`The ${scope} run finished without running the target test.`,
		);
	}
}

function requiredFixRepeat({ runsToFailure, floor, scope }) {
	const wanted = Math.max(
		Number(floor) || 1,
		FIX_RUNS_PER_BASELINE_RUN * runsToFailure,
	);
	return Math.min(wanted, MAX_FIX_REPEAT[scope]);
}

function runPlaywright({
	npmScript,
	selector,
	extraArgs,
	reportFile,
	capture = false,
}) {
	const result = spawnSync(
		'npm',
		['run', npmScript, '--', ...selector, ...extraArgs],
		{
			stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
			encoding: 'utf8',
			env: {
				...process.env,
				...(reportFile
					? { PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile }
					: {}),
			},
		},
	);

	if (result.error) {
		throw result.error;
	}

	if (capture) {
		process.stdout.write(result.stdout || '');
	}
	return result.stdout || '';
}

function selectorFor(scope, { grepPattern, testFile }) {
	return SCOPE_FILE === scope ? [testFile] : [`--grep=${grepPattern}`];
}

function countTestsInFile(npmScript, testFile) {
	return parsePlaywrightListTotal(
		runPlaywright({
			npmScript,
			selector: [testFile],
			extraArgs: ['--list'],
			capture: true,
		}),
	);
}

function runAttempts({
	npmScript,
	scope,
	grepPattern,
	testFile,
	testName,
	repeat,
}) {
	const reportFile = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), 'healer-run-')),
		'report.json',
	);

	runPlaywright({
		npmScript,
		selector: selectorFor(scope, { grepPattern, testFile }),
		extraArgs: [
			'--retries=0',
			`--repeat-each=${repeat}`,
			'--max-failures=1',
			'--reporter=list,json',
		],
		reportFile,
	});

	if (!fs.existsSync(reportFile)) {
		throw new Error(
			`Playwright wrote no JSON report for the ${scope} run.`,
		);
	}

	const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
	const summary = summarizeReport(report, testName);
	assertTestsRan(report, summary, scope);

	return summary;
}

function setOutput(name, value) {
	console.log(`${name}=${value}`);
	if (process.env.GITHUB_OUTPUT) {
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
	}
}

function baseline(env) {
	const common = {
		npmScript: env.NPM_SCRIPT,
		grepPattern: env.GREP_PATTERN,
		testFile: parseTestFile(fs.readFileSync(env.LIST_OUTPUT, 'utf8')),
		testName: env.HEAL_TEST_NAME,
		repeat: env.BASELINE_MAX_REPEAT,
	};

	let scope = SCOPE_TEST;
	let summary = runAttempts({ ...common, scope });

	if (
		!summary.targetFailed &&
		common.testFile &&
		countTestsInFile(common.npmScript, common.testFile) > 1
	) {
		console.log(
			`The test passed ${summary.targetPasses}x on its own. Re-running its whole file, ${common.testFile}, in case the failure depends on the tests before it.`,
		);
		scope = SCOPE_FILE;
		summary = runAttempts({
			...common,
			scope,
			repeat: MAX_BASELINE_FILE_REPEAT,
		});
	}

	const reproduced = summary.targetFailed;
	const runsToFailure = summary.targetPasses + 1;

	setOutput('reproduced', String(reproduced));
	setOutput('scope', scope);
	setOutput('test_file', common.testFile);
	setOutput('runs_to_failure', reproduced ? String(runsToFailure) : '');
	setOutput(
		'fix_repeat',
		reproduced
			? String(
					requiredFixRepeat({
						runsToFailure,
						floor: env.VERIFY_REPEAT,
						scope,
					}),
				)
			: '',
	);

	if (!reproduced) {
		const why = summary.otherFailed
			? 'another test in the file failed first'
			: `it passed ${summary.targetPasses}x`;
		console.log(
			`::warning::The failure does not reproduce without the fix: ${why}.`,
		);
	}
}

function verify(env) {
	let summary;

	try {
		summary = runAttempts({
			npmScript: env.NPM_SCRIPT,
			scope: env.SCOPE,
			grepPattern: env.GREP_PATTERN,
			testFile: env.TEST_FILE,
			testName: env.HEAL_TEST_NAME,
			repeat: env.FIX_REPEAT,
		});
	} catch (error) {
		setOutput('infra_error', 'true');
		throw error;
	}

	const passed =
		!summary.targetFailed &&
		!summary.otherFailed &&
		summary.targetPasses === Number(env.FIX_REPEAT);
	setOutput('passed', String(passed));
	console.log(
		`With the fix (${env.SCOPE} scope): target passed ${summary.targetPasses}/${env.FIX_REPEAT}${summary.targetFailed ? ', target failed' : ''}${summary.otherFailed ? ', another test failed' : ''}.`,
	);

	if (!passed) {
		process.exit(1);
	}
}

if (require.main === module) {
	try {
		('verify' === process.argv[2] ? verify : baseline)(process.env);
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	MAX_FIX_REPEAT,
	SCOPE_FILE,
	SCOPE_TEST,
	assertTestsRan,
	parseTestFile,
	requiredFixRepeat,
	summarizeReport,
};
