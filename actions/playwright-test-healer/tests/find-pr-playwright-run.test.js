const {
	candidateRuns,
	ranPlaywright,
	waitForRun,
} = require('../scripts/find-pr-playwright-run');

function run(id, createdAt, overrides = {}) {
	return {
		id,
		created_at: createdAt,
		event: 'pull_request',
		status: 'completed',
		head_repository: { full_name: 'elementor/elementor-pro' },
		...overrides,
	};
}

describe('candidateRuns', () => {
	it('keeps PR runs from the PR repository that started over a minute before the healer, newest first', () => {
		// Arrange
		const runs = [
			run(1, '2026-10-30T10:00:00Z'),
			run(2, '2026-10-30T11:00:00Z'),
			run(3, '2026-10-30T13:00:00Z'),
			run(6, '2026-10-30T11:59:30Z'),
			run(4, '2026-10-30T11:30:00Z', { event: 'push' }),
			run(5, '2026-10-30T11:45:00Z', {
				head_repository: { full_name: 'someone/elementor-pro' },
			}),
		];

		// Act
		const candidates = candidateRuns(runs, {
			healerCreatedAt: '2026-10-30T12:00:00Z',
			headRepository: 'elementor/elementor-pro',
		});

		// Assert
		expect(candidates.map((candidate) => candidate.id)).toEqual([2, 1]);
	});
});

describe('ranPlaywright', () => {
	it('is true only when a Playwright job passed or failed', () => {
		// Assert
		expect(
			ranPlaywright([
				{ name: 'build', conclusion: 'success' },
				{
					name: 'playwright-custom-core / Playwright - 3',
					conclusion: 'failure',
				},
			]),
		).toBe(true);
		expect(
			ranPlaywright([
				{ name: 'playwright-custom-core', conclusion: 'skipped' },
				{ name: 'lint-js', conclusion: 'success' },
			]),
		).toBe(false);
	});
});

describe('waitForRun', () => {
	it('polls until the run completes', () => {
		// Arrange
		const states = ['in_progress', 'completed'];
		const fetch = vi.fn(() => ({ id: 7, status: states.shift() }));
		const wait = vi.fn();

		// Act
		const finished = waitForRun(
			'elementor/elementor-pro',
			{ id: 7, status: 'queued' },
			wait,
			fetch,
		);

		// Assert
		expect(finished.status).toBe('completed');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(wait).toHaveBeenCalledTimes(2);
	});
});
