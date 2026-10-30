const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectPrFailures } = require('../scripts/collect-pr-failures');
const { loadProfile } = require('../scripts/profile');
const { readResultDirs } = require('../scripts/rank-nightly-failures');

describe('collectPrFailures', () => {
	it('keeps every failure, with its shard, error context and whether it can be re-run', () => {
		// Arrange
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-test-'));
		const dir = path.join(
			root,
			'playwright-test-results-12',
			'forms-Forms-Submit-button-is-visible',
		);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'trace.zip'), '');
		fs.writeFileSync(
			path.join(dir, 'error-context.md'),
			[
				'# Test info',
				'- Location: /work/elementor-pro/tests/playwright/forms.test.ts:4:6',
				'# Error details',
				"Error: locator('.e-form__submit') not visible",
			].join('\n'),
		);

		// Act
		const failures = collectPrFailures({
			testNames: [
				'Submit button is visible',
				'No evidence',
				'No evidence',
			],
			resultDirs: readResultDirs(root),
			resultsRoot: root,
			profile: loadProfile('pro'),
		});

		// Assert
		expect(failures).toEqual([
			{
				testName: 'Submit button is visible',
				shardIndex: '12',
				rerunnable: true,
				matchedDirs: ['forms-Forms-Submit-button-is-visible'],
				artifactNames: ['playwright-test-results-12'],
				hasTrace: true,
				specFile: 'tests/playwright/forms.test.ts',
				errorText: "Error: locator('.e-form__submit') not visible",
			},
			{
				testName: 'No evidence',
				shardIndex: '',
				rerunnable: true,
				matchedDirs: [],
				artifactNames: [],
				hasTrace: false,
				specFile: '',
				errorText: '',
			},
		]);
	});

	it('marks a failure in a shard the healer cannot run as not re-runnable', () => {
		// Arrange
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-test-'));
		fs.mkdirSync(
			path.join(
				root,
				'playwright-test-results-elements-regression-core-chromium',
				'regression-Heading-renders',
			),
			{ recursive: true },
		);

		// Act
		const [result] = collectPrFailures({
			testNames: ['Heading renders'],
			resultDirs: readResultDirs(root),
			resultsRoot: root,
			profile: loadProfile('core'),
		});

		// Assert
		expect(result.shardIndex).toBe('elements-regression-core');
		expect(result.rerunnable).toBe(false);
	});
});
