'use strict';

const {
	collectFlakyTests,
	collectHardFailureTitles,
	parseFlakyTitles,
	parseHardFailureTitles,
} = require('../scripts/collect-log-hard-failures');

const SUMMARY_LOG = `
  1 failed
    [chromium] › tests/playwright/sanity/search.test.ts:92:6 › Search widget › Search Result Visibility
  2 flaky
    [chromium] › tests/playwright/sanity/container.test.ts:45:2 › Container › Container can be added
    tests/playwright/sanity/loop.test.ts:118:6 › Loop › Loop taxonomy filter works
  40 passed (12.3m)
`;

describe('parseHardFailureTitles', () => {
	it('extracts test titles from Playwright failure summary', () => {
		const log = `
  3 failed
    tests/playwright/sanity/modules/loop-filter/loop-taxonomy-filter.test.ts:118:6 › Loop › Loop taxonomy filter works
    tests/playwright/sanity/modules/search/search.test.ts:92:6 › Search widget › Search Result Visibility
    [chromium] › tests/playwright/sanity/container.test.ts:45:2 › Container › Container can be added
`;

		const titles = parseHardFailureTitles(log);

		expect(titles).toContain('Loop taxonomy filter works');
		expect(titles).toContain('Search Result Visibility');
		expect(titles).toContain('Container can be added');
		expect(titles).toHaveLength(3);
	});

	it('handles timestamp prefixes in log lines', () => {
		const log = `
2026-11-12T10:30:45.123Z   3 failed
2026-11-12T10:30:45.456Z     tests/playwright/sanity/test.ts:10:2 › Test title
`;

		const titles = parseHardFailureTitles(log);

		expect(titles).toContain('Test title');
	});

	it('returns empty array when no failures found', () => {
		const log = `
  0 failed
  5 passed
`;

		const titles = parseHardFailureTitles(log);

		expect(titles).toEqual([]);
	});

	it('does not count the flaky block as failures', () => {
		expect(parseHardFailureTitles(SUMMARY_LOG)).toEqual([
			'Search Result Visibility',
		]);
	});
});

describe('parseFlakyTitles', () => {
	it('reads only the flaky block of the summary', () => {
		expect(parseFlakyTitles(SUMMARY_LOG)).toEqual([
			'Container can be added',
			'Loop taxonomy filter works',
		]);
	});

	it('returns nothing for a run without flaky tests', () => {
		expect(parseFlakyTitles('  12 passed (3.1m)\n')).toEqual([]);
	});
});

describe('collectHardFailureTitles', () => {
	it('reads the failed jobs of every attempt', () => {
		// Arrange
		const listJobs = vi.fn(() => [
			{ attempt: 1, jobId: '1' },
			{ attempt: 2, jobId: '2' },
		]);
		const logs = {
			1: '  1 failed\n    a.test.ts:1:1 › Suite › Failed in attempt one\n',
			2: '  1 failed\n    b.test.ts:1:1 › Suite › Failed in attempt two\n',
		};

		// Act
		const titles = collectHardFailureTitles('o/r', 9, {
			listJobs,
			fetchLog: (repo, jobId) => logs[jobId],
		});

		// Assert
		expect(listJobs).toHaveBeenCalledWith('o/r', 9, ['failure']);
		expect(titles).toEqual([
			'Failed in attempt one',
			'Failed in attempt two',
		]);
	});
});

describe('collectFlakyTests', () => {
	it('reads passing and failing jobs and counts where each test flaked', () => {
		// Arrange
		const listJobs = vi.fn(() => [
			{ attempt: 1, jobId: '1' },
			{ attempt: 1, jobId: '2' },
		]);
		const flakyLog =
			'  1 flaky\n    a.test.ts:1:1 › Suite › Sometimes slow\n';

		// Act
		const flaky = collectFlakyTests('o/r', 9, {
			listJobs,
			fetchLog: () => flakyLog,
		});

		// Assert
		expect(listJobs).toHaveBeenCalledWith('o/r', 9, ['success', 'failure']);
		expect(flaky).toEqual([{ name: 'Sometimes slow', flakyCount: 2 }]);
	});
});
