'use strict';

const {
	collectHardFailuresWithAttempts,
	parseHardFailureTitles,
} = require('../scripts/collect-log-hard-failures');

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
});

describe('collectHardFailuresWithAttempts', () => {
	it('requires integration with actual gh and job logs', () => {
		// This function makes actual API calls via the run-attempts module,
		// so it's tested through integration tests rather than unit tests.
		// The function signature is verified here.
		expect(typeof collectHardFailuresWithAttempts).toBe('function');
	});
});
