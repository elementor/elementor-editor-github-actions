'use strict';

const {
	mergeResultDirs,
	pickShardArtifactsToIndex,
} = require('../scripts/index-shard-artifacts');

describe('pickShardArtifactsToIndex', () => {
	it("keeps every attempt's unexpired shard results, oldest attempt first", () => {
		// Act
		const picked = pickShardArtifactsToIndex([
			{ name: 'playwright-test-results-3', id: 3, attempt: 2 },
			{ name: 'playwright-test-results-3', id: 1, attempt: 1 },
			{
				name: 'playwright-test-results-4',
				id: 4,
				attempt: 1,
				expired: true,
			},
			{ name: 'allure-report', id: 5, attempt: 2 },
		]);

		// Assert
		expect(picked.map((artifact) => artifact.id)).toEqual([1, 3]);
	});
});

describe('mergeResultDirs', () => {
	it("merges one shard's attempts, keeping a trace from any of them", () => {
		// Act
		const merged = mergeResultDirs([
			{ dirName: 'a', artifactName: 'p-3', attempt: 1, hasTrace: true },
			{ dirName: 'a', artifactName: 'p-3', attempt: 2, hasTrace: false },
			{ dirName: 'a', artifactName: 'p-9', attempt: 1, hasTrace: false },
		]);

		// Assert
		expect(merged).toEqual([
			{ dirName: 'a', artifactName: 'p-3', hasTrace: true },
			{ dirName: 'a', artifactName: 'p-9', hasTrace: false },
		]);
	});
});
