const { buildPrompt } = require('../scripts/dispatch-cloud-agent');
const {
	newestMainFirst,
	pickEvidenceRuns,
	pickShardArtifacts,
} = require('../scripts/find-test-evidence');
const {
	buildNightlyHealerSummary,
} = require('../scripts/nightly-healer-summary');
const { loadProfile } = require('../scripts/profile');
const { selectHealCandidate } = require('../scripts/rank-nightly-failures');
const {
	isHealableShard,
	resolveShardCommand,
	shardIndexFromArtifactName,
} = require('../scripts/resolve-shard-command');
const {
	planCoreBuildRestore,
} = require('../scripts/restore-nightly-playwright-builds');

const core = loadProfile('core');

describe('Core shard artifacts', () => {
	it('strips the browser suffix from numeric and named shards', () => {
		// Act & Assert
		expect(
			shardIndexFromArtifactName(
				'playwright-test-results-7-chromium',
				core,
			),
		).toBe('7');
		expect(
			shardIndexFromArtifactName(
				'playwright-test-results-plugin_tester_container_1-firefox',
				core,
			),
		).toBe('plugin_tester_container_1');
	});

	it('runs the plugin tester and import/export shards by their tags', () => {
		// Act & Assert
		expect(
			resolveShardCommand('plugin_tester_section_2', core),
		).toMatchObject({
			npmScript: 'test:playwright',
			tag: '@plugin_tester_section',
			isNamedShard: true,
			testSetupScript: 'test:setup:playwright',
		});
		expect(
			resolveShardCommand('import_export_customization', core).tag,
		).toBe('@import_export_customization');
	});

	it('treats elements-regression shards as unhealable', () => {
		// Act & Assert
		expect(isHealableShard('elements-regression-core', core)).toBe(false);
		expect(isHealableShard('elements-regression-atomic', core)).toBe(false);
		expect(isHealableShard('7', core)).toBe(true);
	});
});

describe('Core ranking', () => {
	it('passes over a failure whose evidence is on an unhealable shard', () => {
		// Arrange
		const resultDirs = [
			{
				dirName: 'elements-regression-button-renders',
				artifactName:
					'playwright-test-results-elements-regression-core-chromium',
				hasTrace: true,
			},
			{
				dirName: 'editor-panel-opens-the-panel',
				artifactName: 'playwright-test-results-7-chromium',
				hasTrace: false,
			},
		];

		// Act
		const result = selectHealCandidate({
			hardFailureNames: ['button renders', 'opens the panel'],
			resultDirs,
			profile: core,
		});

		// Assert
		expect(result.candidate).toMatchObject({
			testName: 'opens the panel',
			shardIndex: '7',
		});
		expect(result.skippedCandidates).toEqual([
			{
				testName: 'button renders',
				reason: 'unhealable-shard',
				shardIndex: 'elements-regression-core',
			},
		]);
	});

	it('says why an unhealable candidate was passed over', () => {
		// Act
		const summary = buildNightlyHealerSummary({
			outcome: 'all-candidates-skipped',
			details: {
				skippedCandidates: [
					{
						testName: 'button renders',
						reason: 'unhealable-shard',
						shardIndex: 'elements-regression-core',
					},
				],
			},
		});

		// Assert
		expect(summary).toContain(
			'shard `elements-regression-core` runs tests outside `tests/playwright/`',
		);
	});
});

describe('Core evidence lookup', () => {
	it('keeps only scheduled runs, newest main runs first', () => {
		// Arrange
		const runs = [
			{ databaseId: 1, headBranch: 'main', event: 'merge_group' },
			{ databaseId: 2, headBranch: '4.3', event: 'schedule' },
			{ databaseId: 3, headBranch: 'main', event: 'schedule' },
		];

		// Act
		const picked = pickEvidenceRuns(runs, core);

		// Assert
		expect(picked.map((run) => run.databaseId)).toEqual([3, 2]);
	});

	it('keeps Pro nightly and release runs, not pull requests or feature branches', () => {
		// Arrange
		const runs = [
			{ databaseId: 1, headBranch: 'main', event: 'workflow_dispatch' },
			{ databaseId: 2, headBranch: '4.03', event: 'workflow_dispatch' },
			{ databaseId: 3, headBranch: '4.01', event: 'push' },
			{
				databaseId: 4,
				headBranch: 'cherry-pick-pr7686_to_4_01',
				event: 'pull_request',
			},
			{
				databaseId: 5,
				headBranch: 'Internal/ED-25542-x',
				event: 'workflow_dispatch',
			},
		];

		// Act
		const picked = pickEvidenceRuns(runs, loadProfile('pro'));

		// Assert
		expect(picked.map((run) => run.databaseId)).toEqual([1, 2, 3]);
	});

	it('orders main runs first without reordering within a branch', () => {
		// Act
		const ordered = newestMainFirst([
			{ databaseId: 1, headBranch: '4.3' },
			{ databaseId: 2, headBranch: 'main' },
			{ databaseId: 3, headBranch: 'main' },
		]);

		// Assert
		expect(ordered.map((run) => run.databaseId)).toEqual([2, 3, 1]);
	});

	it('tries the largest healable shard artifacts first', () => {
		// Arrange
		const artifacts = [
			{ name: 'playwright-test-results-3-chromium', size_in_bytes: 10 },
			{ name: 'playwright-test-results-7-chromium', size_in_bytes: 900 },
			{
				name: 'playwright-test-results-elements-regression-core-chromium',
				size_in_bytes: 5000,
			},
			{ name: 'allure-results-7-chromium', size_in_bytes: 800 },
			{
				name: 'playwright-test-results-1-chromium',
				size_in_bytes: 700,
				expired: true,
			},
		];

		// Act
		const picked = pickShardArtifacts(artifacts, core);

		// Assert
		expect(picked.map((artifact) => artifact.name)).toEqual([
			'playwright-test-results-7-chromium',
			'playwright-test-results-3-chromium',
		]);
	});
});

describe('Core build restore', () => {
	it('restores the run’s own plugin artifact', () => {
		// Arrange
		const artifacts = [
			{ name: 'allure-report' },
			{ name: 'elementor-4.4.0-20260929.0847' },
		];

		// Act
		const plan = planCoreBuildRestore(artifacts);

		// Assert
		expect(plan).toEqual({
			source: 'evidence',
			coreArtifactName: 'elementor-4.4.0-20260929.0847',
		});
	});

	it('rebuilds when the plugin artifact has expired', () => {
		// Arrange
		const artifacts = [
			{ name: 'elementor-4.4.0-20260929.0847', expired: true },
		];

		// Act
		const plan = planCoreBuildRestore(artifacts);

		// Assert
		expect(plan).toEqual({ source: 'fresh', coreArtifactName: '' });
	});
});

describe('Core agent prompt', () => {
	it('carries the Core repository notes', () => {
		// Act
		const prompt = buildPrompt({
			testName: 'opens the panel',
			runUrl: 'https://github.com/elementor/elementor/actions/runs/1',
			shardIndex: '7',
			branchName: 'heal/opens-the-panel-1',
			matchedDirs: 'editor-panel-opens-the-panel',
			startingRef: 'main',
			attempt: '1',
			maxAttempts: '2',
			skills: [],
			profile: core,
		});

		// Assert
		expect(prompt).toContain('Repository notes (Elementor Core):');
		expect(prompt).toContain('playwright-test-results-7-chromium');
		expect(prompt).toContain('WP_VERSION=nightly');
		expect(prompt).not.toContain('Pro licence');
	});
});
