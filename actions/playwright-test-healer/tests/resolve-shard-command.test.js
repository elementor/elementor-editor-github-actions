const {
	buildGrepPattern,
	parsePlaywrightListTotal,
	resolveShardCommand,
	shardIndexFromArtifactName,
} = require('../scripts/resolve-shard-command');

describe('shardIndexFromArtifactName', () => {
	it('reads a numeric shard index', () => {
		expect(shardIndexFromArtifactName('playwright-test-results-27')).toBe(
			'27',
		);
	});

	it('strips the nightly and rc run prefixes', () => {
		expect(
			shardIndexFromArtifactName('playwright-test-results-nightly-27'),
		).toBe('27');
		expect(
			shardIndexFromArtifactName(
				'playwright-test-results-rc-taxonomy_filter_1',
			),
		).toBe('taxonomy_filter_1');
	});

	it('keeps named shards intact', () => {
		expect(
			shardIndexFromArtifactName(
				'playwright-test-results-import_export_customization',
			),
		).toBe('import_export_customization');
	});

	it('returns an empty string for anything that is not a shard artifact', () => {
		expect(shardIndexFromArtifactName('allure-report')).toBe('');
		expect(shardIndexFromArtifactName(undefined)).toBe('');
	});
});

describe('resolveShardCommand', () => {
	it('uses the default command for numeric shards', () => {
		expect(resolveShardCommand('27')).toMatchObject({
			npmScript: 'test:playwright',
			isNamedShard: false,
			requiresTestSetup: false,
			proPlan: '',
		});
	});

	it('uses the elements-regression config for template tests', () => {
		expect(resolveShardCommand('template_tests_2')).toMatchObject({
			npmScript: 'test:playwright:template-tests',
			isNamedShard: true,
			tag: '@template_test_2',
		});
	});

	it('requires the data import for the plugin tester shard', () => {
		expect(resolveShardCommand('plugin_tester')).toMatchObject({
			requiresTestSetup: true,
			testSetupScript: 'test:setup',
		});
	});

	it('requires the expert plan for import/export customization', () => {
		expect(resolveShardCommand('import_export_customization').proPlan).toBe(
			'expert',
		);
	});

	it('falls back to the default command for an unknown or empty shard', () => {
		expect(resolveShardCommand('').npmScript).toBe('test:playwright');
		expect(resolveShardCommand('something_new').npmScript).toBe(
			'test:playwright',
		);
		expect(resolveShardCommand('something_new').isNamedShard).toBe(false);
	});
});

describe('buildGrepPattern', () => {
	it('escapes regex metacharacters so a title cannot widen the match', () => {
		expect(buildGrepPattern('Search widget | default state')).toBe(
			'Search widget \\| default state',
		);
		expect(buildGrepPattern('Renders (with a caption).')).toBe(
			'Renders \\(with a caption\\)\\.',
		);
	});

	it('trims surrounding whitespace', () => {
		expect(buildGrepPattern('  padded title  ')).toBe('padded title');
	});

	it('produces a pattern that matches the literal title and nothing wider', () => {
		const pattern = new RegExp(
			buildGrepPattern('Loop grid | taxonomy filter'),
		);

		expect(pattern.test('Loop grid | taxonomy filter')).toBe(true);
		expect(pattern.test('Loop grid')).toBe(false);
		expect(pattern.test('taxonomy filter')).toBe(false);
	});
});

describe('parsePlaywrightListTotal', () => {
	it('reads a single matched test', () => {
		expect(
			parsePlaywrightListTotal(
				'Listing tests:\n  a.spec.ts:1:1 › x\nTotal: 1 test in 1 file',
			),
		).toBe(1);
	});

	it('reads several matched tests', () => {
		expect(parsePlaywrightListTotal('Total: 4 tests in 2 files')).toBe(4);
	});

	it('returns null when the total line is absent, so no match is not read as zero', () => {
		expect(parsePlaywrightListTotal('Error: No tests found')).toBeNull();
		expect(parsePlaywrightListTotal('')).toBeNull();
	});
});
