'use strict';

/**
 * Maps a Playwright shard index back to the exact command, npm script, and
 * environment the product's CI used to run it.
 *
 * The healer must re-run a single test the same way CI ran it. Named shards
 * are not interchangeable with the default numeric shards: they can use a
 * different Playwright config, need a data import first, or need a specific
 * Pro plan. Running such a test with the plain default command either finds
 * nothing or fails for environment reasons, which would look like "the fix
 * did not verify". Each product's shards are listed in its profile.
 */

const { loadProfile } = require('./profile');

const ARTIFACT_NAME_PREFIX = 'playwright-test-results-';

/**
 * `playwright-test-results-27`, `playwright-test-results-nightly-27`, and
 * `playwright-test-results-7-chromium` all carry the shard index between the
 * profile's run prefixes and browser suffixes. Returns '' for anything that
 * is not a shard artifact.
 */
function shardIndexFromArtifactName(artifactName, profile = loadProfile()) {
	const name = String(artifactName || '');

	if (!name.startsWith(ARTIFACT_NAME_PREFIX)) {
		return '';
	}

	let shardIndex = name.slice(ARTIFACT_NAME_PREFIX.length);

	const runPrefix = profile.artifactRunPrefixes.find((prefix) =>
		shardIndex.startsWith(prefix),
	);
	if (runPrefix) {
		shardIndex = shardIndex.slice(runPrefix.length);
	}

	const suffix = profile.artifactSuffixes.find((candidate) =>
		shardIndex.endsWith(candidate),
	);
	if (suffix) {
		shardIndex = shardIndex.slice(0, -suffix.length);
	}

	return shardIndex;
}

function isNamedShard(shardIndex, profile = loadProfile()) {
	return Object.prototype.hasOwnProperty.call(
		profile.namedShards,
		String(shardIndex),
	);
}

/**
 * Some shards run tests from outside `tests/playwright/`, the only place a
 * fix may touch, so a failure there cannot be healed.
 */
function isHealableShard(shardIndex, profile = loadProfile()) {
	return !profile.unhealableShards.includes(String(shardIndex));
}

/**
 * An unknown or empty shard index falls back to the default command. That is
 * the correct default: the numeric shards all run the same way, and a
 * manually fed test with no shard evidence is most likely one of them.
 */
function resolveShardCommand(shardIndex, profile = loadProfile()) {
	const named = profile.namedShards[String(shardIndex)] || {};

	return {
		shardIndex: String(shardIndex || ''),
		isNamedShard: isNamedShard(shardIndex, profile),
		npmScript: named.npmScript || profile.defaultNpmScript,
		tag: named.tag || '',
		requiresTestSetup: Boolean(named.requiresTestSetup),
		testSetupScript: profile.testSetupScript,
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
	setOutput('test_setup_script', shard.testSetupScript);
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
	buildGrepPattern,
	escapeRegExp,
	isHealableShard,
	isNamedShard,
	parsePlaywrightListTotal,
	resolveShardCommand,
	shardIndexFromArtifactName,
};
