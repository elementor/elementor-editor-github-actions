const {
	buildEvidenceCandidates,
	findEvidenceInResultDirs,
	isShardArtifact,
	listEvidenceRuns,
	pickBestEvidence,
} = require('../scripts/find-test-evidence');

describe('isShardArtifact', () => {
	it('accepts an unexpired per-shard results artifact', () => {
		expect(
			isShardArtifact({
				name: 'playwright-test-results-27',
				expired: false,
			}),
		).toBe(true);
	});

	it('rejects expired artifacts and other artifact names', () => {
		expect(
			isShardArtifact({
				name: 'playwright-test-results-27',
				expired: true,
			}),
		).toBe(false);
		expect(isShardArtifact({ name: 'allure-report', expired: false })).toBe(
			false,
		);
		expect(isShardArtifact(null)).toBe(false);
	});
});

describe('buildEvidenceCandidates', () => {
	it('keeps the shard index with the evidence it came from', () => {
		const resultDirs = [
			{
				dirName: 'modules-loop-filter-loop-taxonomy-filter-works',
				artifactName: 'playwright-test-results-taxonomy_filter_2',
				hasTrace: true,
			},
		];

		expect(
			buildEvidenceCandidates('Loop taxonomy filter works', resultDirs),
		).toEqual([
			{
				artifactName: 'playwright-test-results-taxonomy_filter_2',
				shardIndex: 'taxonomy_filter_2',
				matchedDirs: ['modules-loop-filter-loop-taxonomy-filter-works'],
				hasTrace: true,
			},
		]);
	});

	it('groups matches per shard artifact rather than merging them', () => {
		const resultDirs = [
			{
				dirName: 'a-search-widget-functionality',
				artifactName: 'playwright-test-results-3',
				hasTrace: false,
			},
			{
				dirName: 'b-search-widget-functionality',
				artifactName: 'playwright-test-results-9',
				hasTrace: true,
			},
		];

		const candidates = buildEvidenceCandidates(
			'Search widget functionality',
			resultDirs,
		);

		expect(candidates.map((candidate) => candidate.shardIndex)).toEqual([
			'3',
			'9',
		]);
	});

	it('returns nothing when no directory matches the title', () => {
		const resultDirs = [
			{
				dirName: 'unrelated-spec-something-else',
				artifactName: 'playwright-test-results-1',
				hasTrace: true,
			},
		];

		expect(
			buildEvidenceCandidates('Search widget functionality', resultDirs),
		).toEqual([]);
	});
});

describe('pickBestEvidence', () => {
	it('prefers trace-backed evidence over log-only evidence', () => {
		const best = pickBestEvidence([
			{ shardIndex: '3', matchedDirs: ['a'], hasTrace: false },
			{ shardIndex: '9', matchedDirs: ['b'], hasTrace: true },
		]);

		expect(best.shardIndex).toBe('9');
	});

	it('returns null when nothing matched', () => {
		expect(pickBestEvidence([])).toBeNull();
		expect(
			pickBestEvidence([
				{ shardIndex: '1', matchedDirs: [], hasTrace: true },
			]),
		).toBeNull();
	});
});

describe('findEvidenceInResultDirs', () => {
	it('finds a hashed and truncated Playwright directory for a fed test title', () => {
		const resultDirs = [
			{
				dirName:
					'modules-search-search-infr-364a4-Search-widget-functionality',
				artifactName: 'playwright-test-results-nightly-12',
				hasTrace: true,
			},
		];

		const evidence = findEvidenceInResultDirs(
			'Test Search widget functionality',
			resultDirs,
		);

		expect(evidence).toMatchObject({ shardIndex: '12', hasTrace: true });
	});
});

describe('listEvidenceRuns', () => {
	const profile = { evidenceEvents: ['schedule'] };
	const page = (event, count) =>
		Array.from({ length: count }, (_, index) => ({
			databaseId: index,
			headBranch: 'main',
			event,
		}));

	it('reads further pages while pull request runs crowd out the nightlies', () => {
		// Arrange
		const pages = [
			[...page('pull_request', 99), ...page('schedule', 1)],
			[...page('pull_request', 90), ...page('schedule', 10)],
			[...page('pull_request', 80), ...page('schedule', 20)],
		];
		const requested = [];
		const fetchPage = (repo, workflow, number) => {
			requested.push(number);
			return pages[number - 1] || [];
		};

		// Act
		const runs = listEvidenceRuns(
			'o/r',
			'playwright.yml',
			profile,
			fetchPage,
		);

		// Assert
		expect(requested).toEqual([1, 2, 3]);
		expect(runs).toHaveLength(31);
		expect(runs.every((run) => 'schedule' === run.event)).toBe(true);
	});

	it('stops at a short page', () => {
		// Arrange
		const requested = [];
		const fetchPage = (repo, workflow, number) => {
			requested.push(number);
			return page('schedule', 3);
		};

		// Act
		const runs = listEvidenceRuns(
			'o/r',
			'playwright.yml',
			profile,
			fetchPage,
		);

		// Assert
		expect(requested).toEqual([1]);
		expect(runs).toHaveLength(3);
	});
});
