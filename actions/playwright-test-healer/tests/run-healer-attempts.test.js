const {
	MAX_FIX_REPEAT,
	MIN_FIX_REPEAT,
	SCOPE_FILE,
	SCOPE_TEST,
	assertTestsRan,
	parseTestFile,
	requiredFixRepeat,
	summarizeReport,
	unreproducedFixRepeat,
} = require('../scripts/run-healer-attempts');

const TARGET = 'Check Mega Menu icons';

function spec(title, statuses) {
	return {
		title,
		tests: statuses.map((status) => ({ results: [{ status }] })),
	};
}

function report(specs) {
	return {
		suites: [
			{ title: 'file.test.ts', suites: [{ title: 'describe', specs }] },
		],
	};
}

describe('parseTestFile', () => {
	it('reads the spec file from a Playwright --list line', () => {
		// Arrange
		const list = [
			'Listing tests:',
			'  modules/mega-menu/mm-e-font-icon-inactive-11.test.ts:118:6 › Mega Menu tests › Check Mega Menu icons',
			'Total: 1 test in 1 file',
		].join('\n');

		// Act
		const file = parseTestFile(list);

		// Assert
		expect(file).toBe(
			'modules/mega-menu/mm-e-font-icon-inactive-11.test.ts',
		);
	});

	it('reads the file when the line carries a project name', () => {
		expect(
			parseTestFile(
				'  [chromium] › sanity/a/b.spec.ts:9:6 › Suite › Test',
			),
		).toBe('sanity/a/b.spec.ts');
	});

	it('returns an empty string when nothing was listed', () => {
		expect(parseTestFile('Total: 0 tests in 0 files')).toBe('');
	});
});

describe('summarizeReport', () => {
	it('counts target passes up to the run that failed it', () => {
		// Arrange
		const json = report([
			spec(TARGET, ['passed', 'passed', 'failed', 'skipped']),
		]);

		// Act
		const summary = summarizeReport(json, TARGET);

		// Assert
		expect(summary).toEqual({
			targetPasses: 2,
			targetFailed: true,
			otherFailed: false,
		});
	});

	it('keeps a neighbour failing apart from the target failing', () => {
		// Arrange
		const json = report([
			spec(
				'Theme Style doesnt override menu item link typography settings',
				['failed'],
			),
			spec(TARGET, ['passed']),
		]);

		// Act
		const summary = summarizeReport(json, TARGET);

		// Assert
		expect(summary).toEqual({
			targetPasses: 1,
			targetFailed: false,
			otherFailed: true,
		});
	});

	it('treats a timeout as a failure', () => {
		expect(
			summarizeReport(report([spec(TARGET, ['timedOut'])]), TARGET)
				.targetFailed,
		).toBe(true);
	});

	it('counts a pass that needed a retry as a failure, not a pass', () => {
		// Arrange
		const flaky = { results: [{ status: 'failed' }, { status: 'passed' }] };
		const json = report([
			{
				title: TARGET,
				tests: [{ results: [{ status: 'passed' }] }, flaky],
			},
		]);

		// Act
		const summary = summarizeReport(json, TARGET);

		// Assert
		expect(summary).toEqual({
			targetPasses: 1,
			targetFailed: true,
			otherFailed: false,
		});
	});
});

describe('assertTestsRan', () => {
	it('fails on errors outside any test, such as a global-setup crash', () => {
		// Arrange
		const json = {
			suites: [],
			errors: [
				{ message: 'Error: wp-env is not running\n    at globalSetup' },
			],
		};

		// Act
		const act = () =>
			assertTestsRan(json, summarizeReport(json, TARGET), SCOPE_TEST);

		// Assert
		expect(act).toThrow('wp-env is not running');
	});

	it('accepts the notice Playwright adds when --max-failures stops the run', () => {
		// Arrange
		const json = {
			...report([spec(TARGET, ['failed', 'skipped'])]),
			errors: [
				{
					message:
						'Testing stopped early after 1 maximum allowed failures.',
				},
			],
		};

		// Act
		const act = () =>
			assertTestsRan(json, summarizeReport(json, TARGET), SCOPE_TEST);

		// Assert
		expect(act).not.toThrow();
	});

	it('still fails on a real error reported next to the --max-failures notice', () => {
		// Arrange
		const json = {
			...report([spec(TARGET, ['failed'])]),
			errors: [
				{
					message:
						'Testing stopped early after 1 maximum allowed failures.',
				},
				{ message: 'Error: globalTeardown crashed' },
			],
		};

		// Act
		const act = () =>
			assertTestsRan(json, summarizeReport(json, TARGET), SCOPE_TEST);

		// Assert
		expect(act).toThrow('globalTeardown crashed');
	});

	it('fails when nothing ran, rather than reading it as a test that never failed', () => {
		// Arrange
		const json = report([spec(TARGET, ['skipped'])]);

		// Act
		const act = () =>
			assertTestsRan(json, summarizeReport(json, TARGET), SCOPE_FILE);

		// Assert
		expect(act).toThrow('without running the target test');
	});

	it('accepts a run where only a neighbour failed', () => {
		// Arrange
		const json = report([spec('Another test', ['failed'])]);

		// Act
		const act = () =>
			assertTestsRan(json, summarizeReport(json, TARGET), SCOPE_FILE);

		// Assert
		expect(act).not.toThrow();
	});
});

describe('unreproducedFixRepeat', () => {
	it('asks the fix to pass as many runs as the test passed without it', () => {
		expect(
			unreproducedFixRepeat({
				baselinePasses: 10,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(10);
	});

	it('never asks for fewer than verify_repeat', () => {
		expect(
			unreproducedFixRepeat({
				baselinePasses: 2,
				floor: 3,
				scope: SCOPE_FILE,
			}),
		).toBe(3);
	});

	it('never asks a single test for fewer than the scope minimum', () => {
		expect(
			unreproducedFixRepeat({
				baselinePasses: 1,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(MIN_FIX_REPEAT[SCOPE_TEST]);
		expect(
			unreproducedFixRepeat({
				baselinePasses: 1,
				floor: 1,
				scope: SCOPE_FILE,
			}),
		).toBe(MIN_FIX_REPEAT[SCOPE_FILE]);
	});

	it('caps a single test at the scope maximum', () => {
		expect(
			unreproducedFixRepeat({
				baselinePasses: 50,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(MAX_FIX_REPEAT[SCOPE_TEST]);
	});

	it('caps the runs at the scope maximum', () => {
		expect(
			unreproducedFixRepeat({
				baselinePasses: 50,
				floor: 3,
				scope: SCOPE_FILE,
			}),
		).toBe(MAX_FIX_REPEAT[SCOPE_FILE]);
	});
});

describe('requiredFixRepeat', () => {
	it('asks for three passes per run the failure took', () => {
		expect(
			requiredFixRepeat({
				runsToFailure: 5,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(15);
	});

	it('never asks for fewer than verify_repeat', () => {
		expect(
			requiredFixRepeat({
				runsToFailure: 1,
				floor: 10,
				scope: SCOPE_TEST,
			}),
		).toBe(10);
	});

	it('asks a test that failed on its first run for the scope minimum', () => {
		expect(
			requiredFixRepeat({
				runsToFailure: 1,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(MIN_FIX_REPEAT[SCOPE_TEST]);
		expect(
			requiredFixRepeat({
				runsToFailure: 1,
				floor: 3,
				scope: SCOPE_FILE,
			}),
		).toBe(MIN_FIX_REPEAT[SCOPE_FILE]);
	});

	it('asks a test that failed on its tenth run for three passes per run, up to the cap', () => {
		expect(
			requiredFixRepeat({
				runsToFailure: 10,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(30);
		expect(
			requiredFixRepeat({
				runsToFailure: 10,
				floor: 3,
				scope: SCOPE_FILE,
			}),
		).toBe(MAX_FIX_REPEAT[SCOPE_FILE]);
	});

	it('stops at the cap for the scope', () => {
		expect(
			requiredFixRepeat({
				runsToFailure: 20,
				floor: 3,
				scope: SCOPE_TEST,
			}),
		).toBe(MAX_FIX_REPEAT[SCOPE_TEST]);
		expect(
			requiredFixRepeat({
				runsToFailure: 20,
				floor: 3,
				scope: SCOPE_FILE,
			}),
		).toBe(MAX_FIX_REPEAT[SCOPE_FILE]);
	});
});
