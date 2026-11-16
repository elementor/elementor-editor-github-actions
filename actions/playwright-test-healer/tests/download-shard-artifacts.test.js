'use strict';

const {
	pickShardArtifactsToDownload,
} = require('../scripts/download-shard-artifacts');

describe('pickShardArtifactsToDownload', () => {
	it("keeps every attempt's unexpired shard results, oldest attempt first", () => {
		// Act
		const picked = pickShardArtifactsToDownload([
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
