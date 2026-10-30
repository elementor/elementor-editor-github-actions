'use strict';

/**
 * Re-runs a PR's failed Playwright tests a fixed number of times each, with
 * retries off, and records how many runs of each passed. The PR healer runs
 * it twice: on the PR's own build, to tell a flake from a hard failure, and
 * on main, to tell a failure the PR brought from one main already has.
 *
 * Each test runs on its shard's own command, restricted to its spec file when
 * that is known so a title shared by two specs does not run both.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { setOutput } = require('./github-output');
const {
	buildGrepPattern,
	parsePlaywrightListTotal,
	resolveShardCommand,
} = require('./resolve-shard-command');
const {
	collectSpecs,
	testProcessEnv,
	testStatus,
} = require('./run-healer-attempts');

const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);
const MAX_LISTED_MATCHES = 3;
const MAX_ERROR_LENGTH = 300;

function firstLine(text) {
	return String(text || '')
		.split('\n')[0]
		.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Passes and failures of the named test in a JSON report. Other tests the
 * selector caught are ignored: only this test's verdict is being decided.
 */
function countTargetResults(report, testName) {
	const counts = { passed: 0, failed: 0 };

	for (const spec of collectSpecs(report && report.suites)) {
		if (spec.title !== testName) {
			continue;
		}

		for (const test of spec.tests || []) {
			const status = testStatus(test);

			if ('passed' === status) {
				counts.passed++;
			} else if (FAILED_STATUSES.has(status)) {
				counts.failed++;
			}
		}
	}

	return counts;
}

/**
 * A config error or a crashed global setup reports no test at all and puts
 * the cause under `errors`. That is the healer's environment failing, not
 * the test, and must not read as "failed every run".
 */
function reportError(report, counts) {
	const errors = (report && report.errors) || [];

	if (errors.length) {
		return `Playwright reported an error outside the test: ${firstLine(errors[0].message)}`;
	}

	if (!counts.passed && !counts.failed) {
		return 'The run finished without running the test.';
	}

	return '';
}

function selectorFor(test) {
	return [
		...(test.specFiles || []).filter(Boolean),
		`--grep=${buildGrepPattern(test.testName)}`,
	];
}

function runNpm(script, args, { env = {}, capture = false } = {}) {
	const result = spawnSync('npm', ['run', script, '--', ...args], {
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8',
		env: { ...testProcessEnv(), ...env },
	});

	if (result.error) {
		throw result.error;
	}

	if (capture) {
		process.stdout.write(result.stdout || '');
	}

	return result;
}

function runTest(test, repeat, run = runNpm) {
	const shard = resolveShardCommand(test.shardIndex || '');
	const selector = selectorFor(test);
	const env = shard.proPlan ? { E2E_PRO_PLAN: shard.proPlan } : {};

	const listed = parsePlaywrightListTotal(
		run(shard.npmScript, [...selector, '--list'], { env, capture: true })
			.stdout,
	);

	if (!listed) {
		return { error: 'The test could not be found to re-run it.' };
	}

	if (listed > MAX_LISTED_MATCHES) {
		return {
			error: `The title matches ${listed} tests, so it cannot be re-run on its own.`,
		};
	}

	const reportFile = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), 'pr-healer-rerun-')),
		'report.json',
	);

	run(
		shard.npmScript,
		[
			...selector,
			'--retries=0',
			`--repeat-each=${repeat}`,
			'--reporter=list,json',
		],
		{ env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile } },
	);

	if (!fs.existsSync(reportFile)) {
		return { error: 'Playwright wrote no report for the re-run.' };
	}

	const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
	const counts = countTargetResults(report, test.testName);
	const error = reportError(report, counts);

	return error ? { error } : counts;
}

/**
 * Tests whose shard needs a data import run after the rest, so the import
 * cannot change what the others run against.
 */
function orderForSetup(tests) {
	const needsSetup = (test) =>
		resolveShardCommand(test.shardIndex || '').requiresTestSetup;
	return [
		...tests.filter((test) => !needsSetup(test)),
		...tests.filter(needsSetup),
	];
}

function rerunTests({ tests, repeat, run = runNpm }) {
	const results = [];
	let setupDone = false;
	let setupError = '';

	for (const test of orderForSetup(tests)) {
		const shard = resolveShardCommand(test.shardIndex || '');

		if (shard.requiresTestSetup && !setupDone) {
			setupDone = true;
			const setup = run(shard.testSetupScript, []);
			if (0 !== setup.status) {
				setupError = `The shard's test setup (\`npm run ${shard.testSetupScript}\`) failed.`;
			}
		}

		console.log(`::group::Re-running "${test.testName}" ${repeat}x`);
		let result;
		if (shard.requiresTestSetup && setupError) {
			result = { error: setupError };
		} else {
			try {
				result = runTest(test, repeat, run);
			} catch (error) {
				result = { error: firstLine(error.message) };
			}
		}
		console.log('::endgroup::');

		const record = {
			testName: test.testName,
			runs: Number(repeat),
			passed: result.passed || 0,
			failed: result.failed || 0,
			error: result.error || '',
		};
		console.log(
			record.error
				? `${test.testName}: could not re-run — ${record.error}`
				: `${test.testName}: passed ${record.passed}/${record.runs}, failed ${record.failed}/${record.runs}`,
		);
		results.push(record);
	}

	return results;
}

/**
 * Splits the tests by what their re-runs showed: any pass makes a flake,
 * failing every run sends it on to be checked on main. A test that could
 * not be re-run is in neither and ends as "needs a human look".
 */
function sortRerunResults(tests, results) {
	const byName = new Map(results.map((result) => [result.testName, result]));
	const flaky = [];
	const failedEveryRun = [];

	for (const test of tests) {
		const result = byName.get(test.testName);

		if (!result || result.error) {
			continue;
		}

		if (result.passed > 0) {
			flaky.push({ ...test, passed: result.passed, runs: result.runs });
		} else if (result.failed > 0) {
			failedEveryRun.push(test);
		}
	}

	return { flaky, failedEveryRun };
}

function main() {
	const testsPath = process.env.RERUN_TESTS_PATH;
	const outputPath = process.env.RERUN_RESULTS_PATH;
	const repeat = process.env.RERUN_REPEAT || '3';

	if (!testsPath || !outputPath) {
		throw new Error(
			'RERUN_TESTS_PATH and RERUN_RESULTS_PATH are required.',
		);
	}

	if (!/^[1-9]$/.test(repeat)) {
		throw new Error(`RERUN_REPEAT must be 1-9, got '${repeat}'.`);
	}

	const tests = JSON.parse(fs.readFileSync(testsPath, 'utf8'));
	const results = rerunTests({ tests, repeat });
	fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

	const { flaky, failedEveryRun } = sortRerunResults(tests, results);
	setOutput('flaky_tests', JSON.stringify(flaky));
	setOutput('has_flaky', String(flaky.length > 0));
	setOutput('failed_every_run', JSON.stringify(failedEveryRun));
	setOutput('has_failed_every_run', String(failedEveryRun.length > 0));
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
	countTargetResults,
	orderForSetup,
	reportError,
	rerunTests,
	selectorFor,
	sortRerunResults,
};
