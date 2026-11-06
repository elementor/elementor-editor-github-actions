const fs = require('fs');

const {
	countTargetResults,
	orderForSetup,
	reportError,
	rerunTests,
	selectorFor,
	sortRerunResults,
} = require('../scripts/rerun-pr-failures');

function report(statusesByTitle, errors = []) {
	return {
		errors,
		suites: [
			{
				specs: [],
				suites: [
					{
						specs: Object.entries(statusesByTitle).map(
							([title, statuses]) => ({
								title,
								tests: statuses.map((status) => ({
									results: [{ status }],
								})),
							}),
						),
					},
				],
			},
		],
	};
}

/**
 * Stands in for `npm run`: answers `--list` with the given total and writes
 * the given report wherever the real run would.
 */
function fakeRun({ listed = 1, reports = {}, setupStatus = 0 } = {}) {
	const calls = [];

	const run = (script, args, { env = {} } = {}) => {
		calls.push({ script, args, env });

		if (!args.length) {
			return { status: setupStatus, stdout: '' };
		}

		if (args.includes('--list')) {
			return { status: 0, stdout: `Total: ${listed} test in 1 file` };
		}

		const grep = args.find((arg) => arg.startsWith('--grep='));
		const reportFor = reports[grep.slice('--grep='.length)];
		if (reportFor) {
			fs.writeFileSync(
				env.PLAYWRIGHT_JSON_OUTPUT_FILE,
				JSON.stringify(reportFor),
			);
		}
		return { status: 0, stdout: '' };
	};

	return { run, calls };
}

describe('countTargetResults', () => {
	it('counts only the target test, and a failure followed by a pass as a failure', () => {
		// Arrange
		const json = report({
			Target: ['passed', 'failed', 'timedOut'],
			Neighbour: ['failed'],
		});
		json.suites[0].suites[0].specs[0].tests.push({
			results: [{ status: 'failed' }, { status: 'passed' }],
		});

		// Act
		const counts = countTargetResults(json, 'Target');

		// Assert
		expect(counts).toEqual({ passed: 1, failed: 3 });
	});
});

describe('reportError', () => {
	it('reports an error outside any test, and a run that never ran the test', () => {
		// Assert
		expect(
			reportError(
				{ errors: [{ message: 'Global setup failed\nstack' }] },
				{},
			),
		).toBe(
			'Playwright reported an error outside the test: Global setup failed',
		);
		expect(reportError({ errors: [] }, { passed: 0, failed: 0 })).toBe(
			'The run finished without running the test.',
		);
		expect(reportError({ errors: [] }, { passed: 1, failed: 0 })).toBe('');
	});
});

describe('selectorFor', () => {
	it('restricts the run to the spec and escapes the title', () => {
		// Act
		const selector = selectorFor({
			testName: 'Opens (popup)',
			specFiles: ['tests/playwright/a.test.ts'],
		});

		// Assert
		expect(selector).toEqual([
			'tests/playwright/a.test.ts',
			'--grep=Opens \\(popup\\)',
		]);
	});
});

describe('orderForSetup', () => {
	it('runs tests whose shard imports data after the rest', () => {
		// Act
		const ordered = orderForSetup([
			{ testName: 'tester', shardIndex: 'plugin_tester' },
			{ testName: 'plain', shardIndex: '4' },
		]);

		// Assert
		expect(ordered.map((test) => test.testName)).toEqual([
			'plain',
			'tester',
		]);
	});
});

describe('rerunTests', () => {
	it('records passes and failures per test, with retries off and the given repeat', () => {
		// Arrange
		const { run, calls } = fakeRun({
			reports: {
				Flaky: report({ Flaky: ['failed', 'passed', 'passed'] }),
				Broken: report({ Broken: ['failed', 'failed', 'failed'] }),
			},
		});

		// Act
		const results = rerunTests({
			tests: [
				{ testName: 'Flaky', shardIndex: '1', specFiles: [] },
				{ testName: 'Broken', shardIndex: '2', specFiles: [] },
			],
			repeat: '3',
			run,
		});

		// Assert
		expect(results).toEqual([
			{ testName: 'Flaky', runs: 3, passed: 2, failed: 1, error: '' },
			{ testName: 'Broken', runs: 3, passed: 0, failed: 3, error: '' },
		]);
		expect(calls[1].args).toEqual(
			expect.arrayContaining(['--retries=0', '--repeat-each=3']),
		);
	});

	it('reports a test the selector cannot find instead of running it', () => {
		// Arrange
		const { run } = fakeRun({ listed: 0 });

		// Act
		const [result] = rerunTests({
			tests: [{ testName: 'Gone', shardIndex: '1' }],
			repeat: '3',
			run,
		});

		// Assert
		expect(result.error).toBe('The test could not be found to re-run it.');
	});

	it('runs the shard setup once, and fails only its tests when it breaks', () => {
		// Arrange
		const { run, calls } = fakeRun({
			setupStatus: 1,
			reports: { Plain: report({ Plain: ['passed'] }) },
		});

		// Act
		const results = rerunTests({
			tests: [
				{ testName: 'Tester one', shardIndex: 'plugin_tester' },
				{ testName: 'Tester two', shardIndex: 'plugin_tester' },
				{ testName: 'Plain', shardIndex: '1' },
			],
			repeat: '1',
			run,
		});

		// Assert
		expect(
			calls.filter((call) => 'test:setup' === call.script),
		).toHaveLength(1);
		expect(
			results.map((result) => [result.testName, result.error]),
		).toEqual([
			['Plain', ''],
			[
				'Tester one',
				"The shard's test setup (`npm run test:setup`) failed.",
			],
			[
				'Tester two',
				"The shard's test setup (`npm run test:setup`) failed.",
			],
		]);
	});

	it('passes the shard Pro plan to the run', () => {
		// Arrange
		const { run, calls } = fakeRun({
			reports: { Export: report({ Export: ['passed'] }) },
		});

		// Act
		rerunTests({
			tests: [
				{
					testName: 'Export',
					shardIndex: 'import_export_customization',
				},
			],
			repeat: '1',
			run,
		});

		// Assert
		expect(calls[1].env.E2E_PRO_PLAN).toBe('expert');
	});
});

describe('sortRerunResults', () => {
	it('sorts tests into flaky and failed-every-run, leaving out ones that could not run', () => {
		// Arrange
		const tests = [
			{ testName: 'A', shardIndex: '1' },
			{ testName: 'B', shardIndex: '2' },
			{ testName: 'C', shardIndex: '3' },
		];
		const results = [
			{ testName: 'A', runs: 3, passed: 1, failed: 2, error: '' },
			{ testName: 'B', runs: 3, passed: 0, failed: 3, error: '' },
			{ testName: 'C', runs: 3, passed: 0, failed: 0, error: 'boom' },
		];

		// Act
		const { flaky, failedEveryRun } = sortRerunResults(tests, results);

		// Assert
		expect(flaky).toEqual([
			{ testName: 'A', shardIndex: '1', passed: 1, runs: 3 },
		]);
		expect(failedEveryRun).toEqual([{ testName: 'B', shardIndex: '2' }]);
	});
});
