const {
	parseHardFailureTitles,
} = require('../scripts/collect-log-hard-failures');

describe('parseHardFailureTitles', () => {
	it('returns the leaf titles listed under the failed summary block', () => {
		// Arrange
		const log = [
			'2026-09-25T02:33:53.6401433Z ##[notice]  1 failed',
			'2026-09-25T02:33:53.6480494Z ',
			'2026-09-25T02:33:53.6480602Z   1 failed',
			'2026-09-25T02:33:53.6481166Z     tests/playwright/sanity/modules/search/search-layout-2.test.ts:92:6 › Search widget layout test - #2 @search › Search Result Visibility ',
			'2026-09-25T02:33:53.6481663Z   11 passed (9.7m)',
		].join('\n');

		// Act
		const result = parseHardFailureTitles(log);

		// Assert
		expect(result).toEqual(['Search Result Visibility']);
	});

	it('ignores flaky tests that recovered on retry', () => {
		// Arrange
		const log = [
			'  2 failed',
			'    tests/playwright/a.test.ts:10:6 › Suite A › Hard failure one',
			'    tests/playwright/b.test.ts:20:6 › Suite B › Hard failure two',
			'  1 flaky',
			'    tests/playwright/c.test.ts:30:6 › Suite C › Recovered on retry',
			'  40 passed (8.1m)',
		].join('\n');

		// Act
		const result = parseHardFailureTitles(log);

		// Assert
		expect(result).toEqual(['Hard failure one', 'Hard failure two']);
	});

	it('handles a project prefix and deduplicates titles', () => {
		// Arrange
		const log = [
			'  2 failed',
			'    [chromium] › tests/playwright/a.test.ts:10:6 › Suite › Same title',
			'    [chromium] › tests/playwright/b.test.ts:10:6 › Other suite › Same title',
		].join('\n');

		// Act
		const result = parseHardFailureTitles(log);

		// Assert
		expect(result).toEqual(['Same title']);
	});

	it('returns nothing for a log without a failed summary', () => {
		// Arrange
		const log =
			'  12 passed (9.7m)\n##[error]Process completed with exit code 1.';

		// Act
		const result = parseHardFailureTitles(log);

		// Assert
		expect(result).toEqual([]);
	});
});
