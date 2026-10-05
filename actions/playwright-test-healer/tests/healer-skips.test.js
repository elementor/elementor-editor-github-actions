const {
	COOLDOWN_DAYS,
	COOLDOWN_OUTCOMES,
	buildHealBranchName,
	buildHealBranchSlug,
	findOpenPrForTest,
	findRecentVerdict,
	findSkipReason,
	isTrustedAttemptRun,
	parseAttemptRecord,
} = require('../scripts/healer-skips');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-29T02:00:00Z');
const TEST_NAME = 'Check Mega Menu icons';

function daysAgo(days) {
	return new Date(NOW - days * DAY_MS).toISOString();
}

describe('buildHealBranchSlug', () => {
	it('matches the branch names the healer has already pushed', () => {
		// Arrange & Act
		const slug = buildHealBranchSlug(
			'Default styling - Icon Experiment: active',
		);

		// Assert
		expect(slug).toBe('default-styling-icon-experiment-active');
	});

	it('caps the slug and drops the hyphen the cut leaves behind', () => {
		// Arrange & Act
		const slug = buildHealBranchSlug(
			'A carousel that cannot scroll hides its navigation arrows',
		);

		// Assert
		expect(slug).toBe('a-carousel-that-cannot-scroll-hides-its');
	});

	it('appends the run id to form the branch name', () => {
		expect(buildHealBranchName(TEST_NAME, '36539692114')).toBe(
			'heal/check-mega-menu-icons-36539692114',
		);
	});
});

describe('findOpenPrForTest', () => {
	it('finds a healer PR by its branch whatever its label or title', () => {
		// Arrange
		const openPrs = [
			{
				url: 'u/1',
				title: 'Internal: Fix flaky test - Check Mega Menu… [ED-1]',
				headRefName: 'heal/check-mega-menu-icons-36539692114',
			},
		];

		// Act
		const pr = findOpenPrForTest(TEST_NAME, openPrs);

		// Assert
		expect(pr.url).toBe('u/1');
	});

	it('finds a PR a person opened when its title names the test', () => {
		// Arrange
		const openPrs = [
			{
				url: 'u/2',
				title: 'Internal: Fix flaky check mega menu icons test [ED-2]',
				headRefName: 'ED-2-mega-menu',
			},
		];

		// Act
		const pr = findOpenPrForTest(TEST_NAME, openPrs);

		// Assert
		expect(pr.url).toBe('u/2');
	});

	it('does not take a healer branch for a longer test that shares the prefix', () => {
		// Arrange
		const openPrs = [
			{
				url: 'u/3',
				title: 'Unrelated',
				headRefName: 'heal/check-mega-menu-icons-in-rtl-36539692114',
			},
		];

		// Act
		const pr = findOpenPrForTest(TEST_NAME, openPrs);

		// Assert
		expect(pr).toBeNull();
	});

	it('does not count a PR into another branch as fixing this one', () => {
		// Arrange
		const openPrs = [
			{
				url: 'u/5',
				title: 'Internal: Cherry-pick PR 7667 to 4.03 Fix flaky test - Check Mega Menu icons',
				headRefName: 'cherry-pick-pr7667_to_4_03',
				baseRefName: '4.03',
			},
		];

		// Act & Assert
		expect(findOpenPrForTest(TEST_NAME, openPrs, 'main')).toBeNull();
		expect(findOpenPrForTest(TEST_NAME, openPrs, '4.03').url).toBe('u/5');
	});

	it('ignores a PR that mentions the test only in its body', () => {
		// Arrange
		const openPrs = [
			{
				url: 'u/4',
				title: 'Internal: Add Playwright test healer',
				body: 'e.g. Check Mega Menu icons',
				headRefName: 'cursor/healer',
			},
		];

		// Act
		const pr = findOpenPrForTest(TEST_NAME, openPrs);

		// Assert
		expect(pr).toBeNull();
	});
});

describe('findRecentVerdict', () => {
	it('returns the latest verdict inside the cooldown', () => {
		// Arrange
		const attempts = [
			{
				testName: TEST_NAME,
				outcome: 'verification-failed',
				recordedAt: daysAgo(3),
			},
			{
				testName: TEST_NAME,
				outcome: 'agent-escalated',
				recordedAt: daysAgo(1),
			},
		];

		// Act
		const verdict = findRecentVerdict(TEST_NAME, attempts, NOW);

		// Assert
		expect(verdict.outcome).toBe('agent-escalated');
	});

	it('lets the test back in once the cooldown has passed', () => {
		// Arrange
		const attempts = [
			{
				testName: TEST_NAME,
				outcome: 'agent-escalated',
				recordedAt: daysAgo(COOLDOWN_DAYS + 1),
			},
		];

		// Act & Assert
		expect(findRecentVerdict(TEST_NAME, attempts, NOW)).toBeNull();
	});

	it('does not hold an infrastructure failure against the test', () => {
		// Arrange
		const attempts = [
			{
				testName: TEST_NAME,
				outcome: 'verification-infra-failed',
				recordedAt: daysAgo(1),
			},
		];

		// Act & Assert
		expect(findRecentVerdict(TEST_NAME, attempts, NOW)).toBeNull();
	});

	it('does not hold a baseline stopped by another test against the test', () => {
		// Arrange
		const attempts = [
			{
				testName: TEST_NAME,
				outcome: 'verification-baseline-neighbour-failed',
				recordedAt: daysAgo(1),
			},
		];

		// Act & Assert
		expect(
			COOLDOWN_OUTCOMES.has('verification-baseline-neighbour-failed'),
		).toBe(false);
		expect(findRecentVerdict(TEST_NAME, attempts, NOW)).toBeNull();
	});

	it('cools down a test whose unreproduced fix hit the draft limit', () => {
		// Arrange
		const attempts = [
			{
				testName: TEST_NAME,
				outcome: 'unreproduced-pr-limit',
				recordedAt: daysAgo(1),
			},
		];

		// Act
		const verdict = findRecentVerdict(TEST_NAME, attempts, NOW);

		// Assert
		expect(verdict.outcome).toBe('unreproduced-pr-limit');
	});

	it('never cools down a PR that could not be opened', () => {
		expect(COOLDOWN_OUTCOMES.has('pr-open-failed')).toBe(false);
	});
});

describe('isTrustedAttemptRun', () => {
	const healerRun = {
		repositoryId: 1,
		headRepositoryId: 1,
		headBranch: 'main',
		event: 'schedule',
	};

	it('trusts a scheduled or dispatched run of this repo on a healable branch', () => {
		expect(isTrustedAttemptRun(healerRun)).toBe(true);
		expect(
			isTrustedAttemptRun({
				...healerRun,
				headBranch: '4.03',
				event: 'workflow_dispatch',
			}),
		).toBe(true);
	});

	it("does not trust a fork's pull request run", () => {
		expect(
			isTrustedAttemptRun({
				...healerRun,
				headRepositoryId: 2,
				event: 'pull_request',
			}),
		).toBe(false);
	});

	it('does not trust a run on a feature branch or from another event', () => {
		expect(
			isTrustedAttemptRun({ ...healerRun, headBranch: 'ED-1-feature' }),
		).toBe(false);
		expect(isTrustedAttemptRun({ ...healerRun, event: 'push' })).toBe(
			false,
		);
	});
});

describe('parseAttemptRecord', () => {
	it('reads a record the report job wrote', () => {
		expect(
			parseAttemptRecord(
				JSON.stringify({
					testName: TEST_NAME,
					outcome: 'agent-escalated',
				}),
			),
		).toEqual({ testName: TEST_NAME, outcome: 'agent-escalated' });
	});

	it('rejects bad JSON and records without a test name', () => {
		expect(() => parseAttemptRecord('{')).toThrow();
		expect(() => parseAttemptRecord('null')).toThrow();
		expect(() =>
			parseAttemptRecord(JSON.stringify({ outcome: 'agent-escalated' })),
		).toThrow('it has no testName or outcome');
	});
});

describe('findSkipReason', () => {
	it('reports an open PR ahead of a recent verdict', () => {
		// Arrange
		const sources = {
			openPrs: [
				{
					url: 'u/1',
					title: '',
					headRefName: 'heal/check-mega-menu-icons-1',
				},
			],
			attempts: [
				{
					testName: TEST_NAME,
					outcome: 'agent-baseline-drift',
					recordedAt: daysAgo(1),
					runUrl: 'r/1',
				},
			],
			now: NOW,
		};

		// Act
		const skip = findSkipReason(TEST_NAME, sources);

		// Assert
		expect(skip).toEqual({ reason: 'open-pr', prUrl: 'u/1' });
	});

	it('returns null for a test nobody is working on', () => {
		expect(
			findSkipReason(TEST_NAME, { openPrs: [], attempts: [], now: NOW }),
		).toBeNull();
	});
});
