const {
	collectRelatedCorePrs,
	extractHints,
	formatRelatedCorePrs,
	pickRelatedPrs,
	scorePr,
} = require('../scripts/collect-related-core-prs');

describe('extractHints', () => {
	it('keeps product tokens from the title and artifact directory', () => {
		expect(
			extractHints(
				'Search Result Visibility',
				'modules-search-search-layo-feb35-ch-Search-Result-Visibility',
			),
		).toEqual(expect.arrayContaining(['search', 'result', 'visibility']));
		expect(
			extractHints(
				'Search Result Visibility',
				'modules-search-search-layo-feb35-ch-Search-Result-Visibility',
			),
		).not.toContain('modules');
	});
});

describe('scorePr and pickRelatedPrs', () => {
	const prs = [
		{
			number: 1,
			title: 'Refactor editor panel',
			merged_at: '2026-03-01T00:00:00Z',
			files: ['modules/editor/assets/js/panel.js'],
		},
		{
			number: 2,
			title: 'Change search widget empty state',
			merged_at: '2026-03-10T00:00:00Z',
			files: ['modules/search/widgets/search.php'],
		},
		{
			number: 3,
			title: 'Unrelated docs tweak',
			merged_at: '2026-03-11T00:00:00Z',
			files: ['readme.md'],
		},
	];

	it('scores by title and file path overlap', () => {
		expect(scorePr(prs[1], ['search'])).toBeGreaterThan(
			scorePr(prs[0], ['search']),
		);
	});

	it('prefers hint matches over mere recency', () => {
		expect(pickRelatedPrs(prs, ['search']).map((pr) => pr.number)).toEqual([
			2,
		]);
	});

	it('falls back to recent merges when nothing matches', () => {
		expect(
			pickRelatedPrs(prs, ['woocommerce']).map((pr) => pr.number),
		).toEqual([3, 2, 1]);
	});
});

describe('formatRelatedCorePrs', () => {
	it('returns empty when there are no PRs', () => {
		expect(formatRelatedCorePrs({ prs: [] })).toBe('');
	});

	it('names the evidence Core SHA and lists files', () => {
		const text = formatRelatedCorePrs({
			coreSha: '0123456789abcdef0123456789abcdef01234567',
			coreBranch: 'main',
			prs: [
				{
					number: 99,
					title: 'Change search widget empty state',
					html_url: 'https://github.com/elementor/elementor/pull/99',
					merged_at: '2026-03-10T12:00:00Z',
					files: ['modules/search/widgets/search.php'],
				},
			],
		});

		expect(text).toContain('Related Core merges');
		expect(text).toContain('0123456789ab');
		expect(text).toContain('#99');
		expect(text).toContain('modules/search/widgets/search.php');
		expect(text).toContain('never push');
	});
});

describe('collectRelatedCorePrs', () => {
	it('rejects a non-SHA Core ref before calling GitHub', () => {
		expect(() =>
			collectRelatedCorePrs({
				coreSha: 'main; curl evil',
				api: () => {
					throw new Error('should not call GitHub');
				},
			}),
		).toThrow(/Invalid Core SHA/);
	});

	it('rejects a malformed Core repository name', () => {
		expect(() =>
			collectRelatedCorePrs({
				coreRepo: '../etc/passwd',
				api: () => {
					throw new Error('should not call GitHub');
				},
			}),
		).toThrow(/Invalid repository/);
	});

	it('walks commit history, attaches files, and prefers hint matches', () => {
		const api = (args) => {
			const path = args[1] || '';

			if (path.includes('/commits?sha=')) {
				return JSON.stringify([
					{ sha: 'aaaaaaaaaaaa' },
					{ sha: 'bbbbbbbbbbbb' },
				]);
			}

			if (path.includes('/commits/aaaaaaaaaaaa/pulls')) {
				return JSON.stringify([
					{
						number: 10,
						title: 'Docs only',
						html_url:
							'https://github.com/elementor/elementor/pull/10',
						merged_at: '2026-03-01T00:00:00Z',
						state: 'closed',
					},
				]);
			}

			if (path.includes('/commits/bbbbbbbbbbbb/pulls')) {
				return JSON.stringify([
					{
						number: 11,
						title: 'Search empty state',
						html_url:
							'https://github.com/elementor/elementor/pull/11',
						merged_at: '2026-03-02T00:00:00Z',
						state: 'closed',
					},
				]);
			}

			if (path.includes('/pulls/11/files')) {
				return JSON.stringify([
					{ filename: 'modules/search/widgets/search.php' },
				]);
			}

			if (path.includes('/pulls/10/files')) {
				return JSON.stringify([{ filename: 'readme.md' }]);
			}

			throw new Error(`unexpected gh api ${path}`);
		};

		const text = collectRelatedCorePrs({
			coreSha: '0123456789abcdef0123456789abcdef01234567',
			coreBranch: 'main',
			testName: 'Search Result Visibility',
			matchedDirs: 'modules-search-search-layo',
			api,
		});

		expect(text).toContain('#11');
		expect(text).toContain('Search empty state');
		expect(text).toContain('modules/search/widgets/search.php');
		// Unrelated docs PR is dropped once a hint match exists.
		expect(text).not.toContain('#10');
	});

	it('falls back to the search API when no Core SHA is known', () => {
		const api = (args) => {
			const path = args[1] || '';

			if (path.startsWith('search/issues?')) {
				return JSON.stringify({
					items: [
						{
							number: 42,
							title: 'Loop grid tweak',
							html_url:
								'https://github.com/elementor/elementor/pull/42',
							closed_at: '2026-03-05T00:00:00Z',
						},
					],
				});
			}

			if (path.includes('/pulls/42/files')) {
				return JSON.stringify([
					{ filename: 'modules/loop-builder/widgets/loop-grid.php' },
				]);
			}

			throw new Error(`unexpected gh api ${path}`);
		};

		const text = collectRelatedCorePrs({
			testName: 'Loop grid renders',
			api,
		});

		expect(text).toContain('#42');
		expect(text).toContain('last 14 days');
	});
});
