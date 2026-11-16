'use strict';

/**
 * Downloads an evidence run's per-shard test results, from every attempt,
 * into `test-results/<artifact name>/`.
 *
 * A re-run evidence run has one copy of a shard's artifact per attempt that
 * failed, under the same name. `gh run download -n` cannot tell those copies
 * apart, and the copy from an earlier attempt is the only evidence for a test
 * that failed there and passed on the re-run. Copies are extracted oldest
 * first into the shard's one directory, so where both attempts have the same
 * test directory the newer one wins.
 */

const path = require('path');

const { filterHealableArtifactNames } = require('./resolve-shard-command');
const {
	downloadArtifactById,
	listArtifactsAcrossAttempts,
} = require('./run-attempts');

const SHARD_ARTIFACT_PREFIX = 'playwright-test-results-';
const DEFAULT_TEST_RESULTS_ROOT = 'test-results';

function pickShardArtifactsToDownload(artifacts, profile) {
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

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;
	const root = process.env.TEST_RESULTS_ROOT || DEFAULT_TEST_RESULTS_ROOT;

	if (!repo || !runId) {
		throw new Error('GITHUB_REPOSITORY and SOURCE_RUN_ID are required.');
	}

	const artifacts = pickShardArtifactsToDownload(
		listArtifactsAcrossAttempts(repo, runId),
	);

	for (const artifact of artifacts) {
		try {
			downloadArtifactById(
				repo,
				artifact.id,
				path.join(root, artifact.name),
			);
			console.log(
				`Downloaded ${artifact.name} (attempt ${artifact.attempt})`,
			);
		} catch (error) {
			console.log(
				`::warning::Could not download ${artifact.name} (attempt ${artifact.attempt}, id ${artifact.id}): ${error.message}`,
			);
		}
	}
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { pickShardArtifactsToDownload };
