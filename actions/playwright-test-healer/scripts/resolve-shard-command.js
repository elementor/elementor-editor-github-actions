'use strict';

/**
 * Maps a Playwright shard index back to the exact command, npm script, and
 * environment that `playwright-custom-core-suite.yml` used to run it.
 *
 * The healer must re-run a single test the same way the nightly ran it.
 * Named shards are not interchangeable with the default numeric shards:
 * `template_tests_*` use a different Playwright config, `plugin_tester`
 * needs `npm run test:setup` first, and `import_export_customization`
 * needs an `expert` Pro plan. Running such a test with the plain default
 * command either finds nothing or fails for environment reasons, which
 * would look like "the fix did not verify".
 */

const ARTIFACT_NAME_PREFIX = 'playwright-test-results-';
const ARTIFACT_RUN_PREFIXES = ['nightly-', 'rc-'];

const DEFAULT_NPM_SCRIPT = 'test:playwright';
const TEMPLATE_TESTS_NPM_SCRIPT = 'test:playwright:template-tests';

const NAMED_SHARDS = {
	template_tests_1: {
		npmScript: TEMPLATE_TESTS_NPM_SCRIPT,
		tag: '@template_test_1',
	},
	template_tests_2: {
		npmScript: TEMPLATE_TESTS_NPM_SCRIPT,
		tag: '@template_test_2',
	},
	plugin_tester: { tag: '@pluginTester', requiresTestSetup: true },
	loop_taxonomy: { tag: '@loop_taxonomy' },
	taxonomy_filter_1: { tag: '@taxonomyFilter-1' },
	taxonomy_filter_2: { tag: '@taxonomyFilter-2' },
	taxonomy_filter_3: { tag: '@taxonomyFilter-3' },
	wc_archive_styling_1: { tag: '@woocommerce-archive-1' },
	wc_archive_styling_2: { tag: '@woocommerce-archive-2' },
	wc_product_styling_1: { tag: '@woocommerce-product-1' },
	wc_product_styling_2: { tag: '@woocommerce-product-2' },
	import_export_customization: {
		tag: '@import_export_customization',
		proPlan: 'expert',
	},
};

/**
 * `playwright-test-results-27`, `playwright-test-results-nightly-27`, and
 * `playwright-test-results-rc-taxonomy_filter_1` all carry the shard index
 * as the suffix. Returns '' for anything that is not a shard artifact.
 */
function shardIndexFromArtifactName(artifactName) {
	const name = String(artifactName || '');

	if (!name.startsWith(ARTIFACT_NAME_PREFIX)) {
		return '';
	}

	let suffix = name.slice(ARTIFACT_NAME_PREFIX.length);

	for (const runPrefix of ARTIFACT_RUN_PREFIXES) {
		if (suffix.startsWith(runPrefix)) {
			suffix = suffix.slice(runPrefix.length);
			break;
		}
	}

	return suffix;
}

function isNamedShard(shardIndex) {
	return Object.prototype.hasOwnProperty.call(
		NAMED_SHARDS,
		String(shardIndex),
	);
}

/**
 * An unknown or empty shard index falls back to the default command. That is
 * the correct default: the 50 numeric shards all run the same way, and a
 * manually fed test with no shard evidence is most likely one of them.
 */
function resolveShardCommand(shardIndex) {
	const named = NAMED_SHARDS[String(shardIndex)] || {};

	return {
		shardIndex: String(shardIndex || ''),
		isNamedShard: isNamedShard(shardIndex),
		npmScript: named.npmScript || DEFAULT_NPM_SCRIPT,
		tag: named.tag || '',
		requiresTestSetup: Boolean(named.requiresTestSetup),
		proPlan: named.proPlan || '',
	};
}

/**
 * Playwright's `--grep` is a regular expression, and test titles routinely
 * contain `(`, `.`, `+`, `[`, and `|`. An unescaped title is either an
 * invalid regex or — worse, because it silently passes verification — an
 * alternation that matches unrelated tests.
 */
function escapeRegExp(text) {
	return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGrepPattern(testName) {
	return escapeRegExp(String(testName || '').trim());
}

/**
 * `Total: 3 tests in 2 files` / `Total: 1 test in 1 file` from
 * `playwright test --list`. Returns null when the line is absent, so the
 * caller can tell "no tests matched" apart from "could not parse".
 */
function parsePlaywrightListTotal(stdout) {
	const match = /^\s*Total:\s+(\d+)\s+tests?\b/m.exec(String(stdout || ''));
	return match ? Number(match[1]) : null;
}

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) {
		console.log(`${name}=${value}`);
		return;
	}
	require('fs').appendFileSync(
		process.env.GITHUB_OUTPUT,
		`${name}=${value}\n`,
	);
}

function main() {
	const testName = process.env.HEAL_TEST_NAME;

	if (!testName) {
		throw new Error('HEAL_TEST_NAME is required.');
	}

	const shard = resolveShardCommand(process.env.HEAL_SHARD_INDEX || '');
	const grepPattern = buildGrepPattern(testName);

	console.log(
		`Shard ${shard.shardIndex || '(default)'} -> npm run ${shard.npmScript}`,
	);
	console.log(`Grep pattern: ${grepPattern}`);

	setOutput('npm_script', shard.npmScript);
	setOutput('grep_pattern', grepPattern);
	setOutput('requires_test_setup', String(shard.requiresTestSetup));
	setOutput('pro_plan', shard.proPlan);
	setOutput('shard_tag', shard.tag);
	setOutput('is_named_shard', String(shard.isNamedShard));
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	DEFAULT_NPM_SCRIPT,
	NAMED_SHARDS,
	TEMPLATE_TESTS_NPM_SCRIPT,
	buildGrepPattern,
	escapeRegExp,
	isNamedShard,
	parsePlaywrightListTotal,
	resolveShardCommand,
	shardIndexFromArtifactName,
};
