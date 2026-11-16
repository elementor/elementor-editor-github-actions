'use strict';

/**
 * Indexes an evidence run's per-shard test results, from every attempt, into
 * `test-results-index.json`: one entry per test directory with the shard
 * artifact it came from and whether it has a trace. That is all ranking
 * needs, so each zip's file list is read instead of the zip (a few KB
 * instead of tens of MB); only an artifact that cannot be listed is
 * downloaded.
 *
 * A re-run evidence run has one copy of a shard's artifact per attempt that
 * failed, under the same name, and the copy from an earlier attempt is the
 * only evidence for a test that failed there and passed on the re-run. Copies
 * of one shard are merged: a directory has a trace if any copy's does.
 */

const fs = require('fs');

const { readArtifactResultDirs } = require('./find-test-evidence');
const { DEFAULT_TEST_RESULTS_INDEX_PATH } = require('./rank-nightly-failures');
const { filterHealableArtifactNames } = require('./resolve-shard-command');
const { listArtifactsAcrossAttempts } = require('./run-attempts');

const SHARD_ARTIFACT_PREFIX = 'playwright-test-results-';

function pickShardArtifactsToIndex(artifacts, profile) {
	const shardArtifacts = artifacts.filter(
		(artifact) =>
			!artifact.expired &&
			typeof artifact.name === 'string' &&
			artifact.name.startsWith(SHARD_ARTIFACT_PREFIX),
	);
	const healable = new Set(
		filterHealableArtifactNames(
			shardArtifacts.map((artifact) => artifact.name),
			profile,
		),
	);

	return shardArtifacts
		.filter((artifact) => healable.has(artifact.name))
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name) ||
				(a.attempt || 1) - (b.attempt || 1),
		);
}

/**
 * One entry per (artifact, directory), merged across attempts.
 */
function mergeResultDirs(resultDirs) {
	const merged = new Map();

	for (const { dirName, artifactName, hasTrace } of resultDirs) {
		const key = `${artifactName}/${dirName}`;
		const existing = merged.get(key);
		merged.set(key, {
			dirName,
			artifactName,
			hasTrace: Boolean(existing && existing.hasTrace) || hasTrace,
		});
	}

	return [...merged.values()];
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;
	const indexPath =
		process.env.TEST_RESULTS_INDEX_PATH || DEFAULT_TEST_RESULTS_INDEX_PATH;

	if (!repo || !runId) {
		throw new Error('GITHUB_REPOSITORY and SOURCE_RUN_ID are required.');
	}

	const resultDirs = [];

	for (const artifact of pickShardArtifactsToIndex(
		listArtifactsAcrossAttempts(repo, runId),
	)) {
		const dirs = readArtifactResultDirs(repo, artifact);
		console.log(
			`${artifact.name} (attempt ${artifact.attempt}): ${dirs.length} test director${1 === dirs.length ? 'y' : 'ies'}`,
		);
		resultDirs.push(...dirs);
	}

	fs.writeFileSync(indexPath, JSON.stringify(mergeResultDirs(resultDirs)));
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
	mergeResultDirs,
	pickShardArtifactsToIndex,
};
