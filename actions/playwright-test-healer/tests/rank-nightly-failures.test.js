const {
	slugify,
	flattenAllureFailures,
	matchResultDirectories,
	selectHealCandidate,
	shardIndexForMatchedDirs,
} = require('../scripts/rank-nightly-failures');

describe('slugify', () => {
	it('lowercases and hyphenates non-alphanumeric characters', () => {
		// Arrange
		const input =
			'Mega Menu > MM efon: dd3ec — n header and page in editor';

		// Act
		const result = slugify(input);

		// Assert
		expect(result).toBe(
			'mega-menu-mm-efon-dd3ec-n-header-and-page-in-editor',
		);
	});

	it('collapses repeated separators', () => {
		// Arrange & Act
		const result = slugify('a   b---c');

		// Assert
		expect(result).toBe('a-b-c');
	});
});

describe('flattenAllureFailures', () => {
	it('returns only tests with status failed from a nested suite tree', () => {
		// Arrange
		const allureSuitesJson = {
			children: [
				{
					children: [
						{
							children: [
								{
									name: 'passes fine',
									status: 'passed',
									retriesCount: 0,
								},
								{
									name: 'hard fails',
									status: 'failed',
									retriesCount: 3,
								},
								{
									name: 'flaky recovers',
									status: 'passed',
									retriesCount: 2,
								},
							],
						},
					],
				},
			],
		};

		// Act
		const result = flattenAllureFailures(allureSuitesJson);

		// Assert
		expect(result).toEqual([
			{ name: 'hard fails', status: 'failed', retriesCount: 3 },
		]);
	});

	it('returns an empty array for malformed or missing input', () => {
		expect(flattenAllureFailures(null)).toEqual([]);
		expect(flattenAllureFailures({})).toEqual([]);
		expect(flattenAllureFailures({ children: [{ children: [] }] })).toEqual(
			[],
		);
	});

	it('treats Allure broken status as a hard failure', () => {
		// Arrange
		const allureSuitesJson = {
			children: [
				{
					children: [
						{
							children: [
								{
									name: 'click timed out',
									status: 'broken',
									retriesCount: 3,
								},
								{
									name: 'recovered',
									status: 'passed',
									retriesCount: 2,
								},
							],
						},
					],
				},
			],
		};

		// Act
		const result = flattenAllureFailures(allureSuitesJson);

		// Assert
		expect(result).toEqual([
			{ name: 'click timed out', status: 'broken', retriesCount: 3 },
		]);
	});

	it('finds hard failures nested deeper than one describe', () => {
		// Arrange
		const allureSuitesJson = {
			children: [
				{
					name: 'file.spec.ts',
					children: [
						{
							name: 'Import Export',
							children: [
								{
									name: 'Customization',
									children: [
										{
											name: 'content customization is used',
											status: 'broken',
											retriesCount: 3,
										},
									],
								},
							],
						},
					],
				},
			],
		};

		// Act
		const result = flattenAllureFailures(allureSuitesJson);

		// Assert
		expect(result.map((test) => test.name)).toEqual([
			'content customization is used',
		]);
	});
});

describe('matchResultDirectories', () => {
	it('matches a directory whose slug contains the test name slug', () => {
		// Arrange
		const resultDirs = [
			{
				dirName:
					'modules-mega-menu-mm-efon-dd3ec-n-header-and-page-in-editor',
				hasTrace: true,
			},
			{
				dirName:
					'modules-mega-menu-mm-efon-dd3ec-n-header-and-page-in-editor-retry1',
				hasTrace: true,
			},
			{
				dirName: 'modules-unrelated-widget-does-something-else',
				hasTrace: false,
			},
		];

		// Act
		const result = matchResultDirectories(
			'n header and page in editor',
			resultDirs,
		);

		// Assert
		expect(result).toHaveLength(2);
		expect(
			result.every((dir) =>
				dir.dirName.includes('n-header-and-page-in-editor'),
			),
		).toBe(true);
	});

	it('returns an empty array when nothing matches', () => {
		// Arrange
		const resultDirs = [
			{ dirName: 'modules-unrelated-widget', hasTrace: false },
		];

		// Act
		const result = matchResultDirectories(
			'completely different test',
			resultDirs,
		);

		// Assert
		expect(result).toEqual([]);
	});

	it('matches a hashed Playwright folder that truncated the leading Test- from the title', () => {
		// Arrange
		const resultDirs = [
			{
				dirName:
					'modules-search-search-infr-364a4-Search-widget-functionality',
				hasTrace: true,
			},
			{
				dirName:
					'modules-search-search-infr-364a4-Search-widget-functionality-retry1',
				hasTrace: true,
			},
		];

		// Act
		const result = matchResultDirectories(
			'Test Search widget functionality',
			resultDirs,
		);

		// Assert
		expect(result).toHaveLength(2);
	});
});

describe('selectHealCandidate', () => {
	const allureSuitesJson = {
		children: [
			{
				children: [
					{
						children: [
							{
								name: 'has trace evidence',
								status: 'failed',
								retriesCount: 3,
							},
							{
								name: 'log only evidence',
								status: 'failed',
								retriesCount: 3,
							},
							{
								name: 'no evidence at all',
								status: 'failed',
								retriesCount: 3,
							},
							{
								name: 'recovered on retry',
								status: 'passed',
								retriesCount: 2,
							},
						],
					},
				],
			},
		],
	};

	it('prefers a trace-backed candidate over a log-only candidate', () => {
		// Arrange
		const resultDirs = [
			{ dirName: 'suite-has-trace-evidence', hasTrace: true },
			{ dirName: 'suite-log-only-evidence', hasTrace: false },
		];

		// Act
		const result = selectHealCandidate({ allureSuitesJson, resultDirs });

		// Assert
		expect(result.reason).toBeNull();
		expect(result.candidate.testName).toBe('has trace evidence');
		expect(result.candidate.hasTrace).toBe(true);
	});

	it('returns no-artifact-evidence when no hard failure has a matching result directory', () => {
		// Arrange
		const resultDirs = [
			{ dirName: 'suite-something-unrelated', hasTrace: false },
		];

		// Act
		const result = selectHealCandidate({ allureSuitesJson, resultDirs });

		// Assert
		expect(result.candidate).toBeNull();
		expect(result.reason).toBe('no-artifact-evidence');
		expect(result.rankedFailures).toEqual([
			'has trace evidence',
			'log only evidence',
			'no evidence at all',
		]);
	});

	it('ranks a job-log failure list the same way when the Allure report has expired', () => {
		// Arrange
		const hardFailureNames = [
			'Search Result Visibility',
			'Check Mega Menu icons',
		];
		const resultDirs = [
			{
				dirName:
					'modules-search-search-layo-feb35-ch-Search-Result-Visibility',
				artifactName: 'playwright-test-results-28',
				hasTrace: true,
			},
			{
				dirName:
					'modules-mega-menu-mm-e-fon-5ad64----11-Check-Mega-Menu-icons',
				artifactName: 'playwright-test-results-19',
				hasTrace: true,
			},
		];

		// Act
		const result = selectHealCandidate({ hardFailureNames, resultDirs });

		// Assert
		expect(result.rankedFailures).toEqual(hardFailureNames);
		expect(result.candidate.testName).toBe('Check Mega Menu icons');
		expect(result.candidate.shardIndex).toBe('19');
	});

	it('selects a candidate when Playwright hashed the output folder and dropped Test- from the title', () => {
		// Arrange
		const suites = {
			children: [
				{
					children: [
						{
							children: [
								{
									name: 'Test Search widget functionality',
									status: 'failed',
									retriesCount: 3,
								},
							],
						},
					],
				},
			],
		};
		const resultDirs = [
			{
				dirName:
					'modules-search-search-infr-364a4-Search-widget-functionality',
				hasTrace: true,
			},
		];

		// Act
		const result = selectHealCandidate({
			allureSuitesJson: suites,
			resultDirs,
		});

		// Assert
		expect(result.candidate.testName).toBe(
			'Test Search widget functionality',
		);
		expect(result.candidate.hasTrace).toBe(true);
	});

	it('selects a nested Allure broken timeout when the Playwright folder is truncated', () => {
		// Arrange
		const suites = {
			children: [
				{
					name: 'import-export.spec.ts',
					children: [
						{
							name: 'Import Export',
							children: [
								{
									name: 'Customization',
									children: [
										{
											name: 'content customization is used',
											status: 'broken',
											retriesCount: 3,
										},
									],
								},
							],
						},
					],
				},
			],
		};
		const resultDirs = [
			{
				dirName:
					'modules-import-export-cust-948f5-ntent-customization-is-used',
				hasTrace: true,
			},
		];

		// Act
		const result = selectHealCandidate({
			allureSuitesJson: suites,
			resultDirs,
		});

		// Assert
		expect(result.candidate.testName).toBe('content customization is used');
		expect(result.candidate.hasTrace).toBe(true);
	});

	it('returns no-hard-failures when nothing failed', () => {
		// Arrange
		const allGreen = {
			children: [
				{
					children: [
						{
							children: [
								{
									name: 'passes',
									status: 'passed',
									retriesCount: 0,
								},
							],
						},
					],
				},
			],
		};

		// Act
		const result = selectHealCandidate({
			allureSuitesJson: allGreen,
			resultDirs: [],
		});

		// Assert
		expect(result.candidate).toBeNull();
		expect(result.reason).toBe('no-hard-failures');
	});
});

describe('selectHealCandidate skips', () => {
	const hardFailureNames = [
		'Check Mega Menu icons',
		'Search Result Visibility',
	];
	const resultDirs = [
		{
			dirName:
				'modules-mega-menu-mm-e-fon-5ad64----11-Check-Mega-Menu-icons',
			artifactName: 'playwright-test-results-19',
			hasTrace: true,
		},
		{
			dirName:
				'modules-search-search-layo-feb35-ch-Search-Result-Visibility',
			artifactName: 'playwright-test-results-28',
			hasTrace: true,
		},
	];
	const recentVerdict = {
		testName: 'Check Mega Menu icons',
		outcome: 'verification-not-reproducible',
		recordedAt: new Date().toISOString(),
		runUrl: 'https://github.com/o/r/actions/runs/1',
	};

	it('moves on to the next failure when the top one had a recent verdict', () => {
		// Arrange
		const skipSources = { openPrs: [], attempts: [recentVerdict] };

		// Act
		const result = selectHealCandidate({
			hardFailureNames,
			resultDirs,
			skipSources,
		});

		// Assert
		expect(result.candidate.testName).toBe('Search Result Visibility');
		expect(result.skippedCandidates).toEqual([
			{
				testName: 'Check Mega Menu icons',
				reason: 'recent-verdict',
				outcome: 'verification-not-reproducible',
				runUrl: recentVerdict.runUrl,
				recordedAt: recentVerdict.recordedAt,
			},
		]);
	});

	it('moves on when the top failure already has an open PR from anyone', () => {
		// Arrange
		const skipSources = {
			openPrs: [
				{
					url: 'https://github.com/o/r/pull/7686',
					title: 'Fix it',
					headRefName: 'heal/check-mega-menu-icons-36539692114',
				},
			],
			attempts: [],
		};

		// Act
		const result = selectHealCandidate({
			hardFailureNames,
			resultDirs,
			skipSources,
		});

		// Assert
		expect(result.candidate.testName).toBe('Search Result Visibility');
		expect(result.skippedCandidates[0]).toMatchObject({
			reason: 'open-pr',
			prUrl: 'https://github.com/o/r/pull/7686',
		});
	});

	it('still heals a test whose only open PR targets another branch', () => {
		// Arrange
		const skipSources = {
			openPrs: [
				{
					url: 'u/1',
					title: 'Fix',
					headRefName: 'heal/check-mega-menu-icons-1',
					baseRefName: '4.02',
				},
			],
			attempts: [],
			baseRef: 'main',
		};

		// Act
		const result = selectHealCandidate({
			hardFailureNames,
			resultDirs,
			skipSources,
		});

		// Assert
		expect(result.candidate.testName).toBe('Check Mega Menu icons');
		expect(result.skippedCandidates).toEqual([]);
	});

	it('reports all-candidates-skipped when nothing is left', () => {
		// Arrange
		const skipSources = {
			openPrs: [
				{
					url: 'u/1',
					title: 'Internal: Fix flaky Search Result Visibility test',
					headRefName: 'ED-1',
				},
			],
			attempts: [recentVerdict],
		};

		// Act
		const result = selectHealCandidate({
			hardFailureNames,
			resultDirs,
			skipSources,
		});

		// Assert
		expect(result.candidate).toBeNull();
		expect(result.reason).toBe('all-candidates-skipped');
		expect(result.skippedCandidates.map((skip) => skip.testName)).toEqual(
			hardFailureNames,
		);
	});
});

describe('shardIndexForMatchedDirs', () => {
	it('reports the shard the evidence came from', () => {
		// Arrange
		const matchedDirs = [
			{
				dirName: 'a',
				artifactName: 'playwright-test-results-plugin_tester',
				hasTrace: false,
			},
		];

		// Act
		const result = shardIndexForMatchedDirs(matchedDirs);

		// Assert
		expect(result).toBe('plugin_tester');
	});

	it('prefers the trace-backed directory when shards disagree', () => {
		// Arrange
		const matchedDirs = [
			{
				dirName: 'a',
				artifactName: 'playwright-test-results-3',
				hasTrace: false,
			},
			{
				dirName: 'b',
				artifactName: 'playwright-test-results-9',
				hasTrace: true,
			},
		];

		// Act
		const result = shardIndexForMatchedDirs(matchedDirs);

		// Assert
		expect(result).toBe('9');
	});

	it('returns an empty string when there is no evidence', () => {
		expect(shardIndexForMatchedDirs([])).toBe('');
	});
});

describe('selectHealCandidate shard tracking', () => {
	it('carries the failing shard index on the candidate', () => {
		// Arrange
		const suites = {
			children: [
				{
					children: [
						{
							name: 'Import export customization runs',
							status: 'failed',
							retriesCount: 3,
						},
					],
				},
			],
		};
		const resultDirs = [
			{
				dirName: 'modules-ie-import-export-customization-runs',
				artifactName:
					'playwright-test-results-import_export_customization',
				hasTrace: true,
			},
		];

		// Act
		const result = selectHealCandidate({
			allureSuitesJson: suites,
			resultDirs,
		});

		// Assert
		expect(result.candidate.shardIndex).toBe('import_export_customization');
	});
});
