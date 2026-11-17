const { mergeResultDirs } = require('../scripts/index-shard-artifacts');
const { assignArtifactAttempts } = require('../scripts/run-attempts');

describe('mergeResultDirs', () => {
	it('keeps attempt and artifact id so ranking can download the right copy', () => {
		const merged = mergeResultDirs([
			{
				dirName: 'suite-failed-earlier',
				artifactName: 'playwright-test-results-7',
				artifactId: 111,
				attempt: 1,
				hasTrace: true,
			},
			{
				dirName: 'suite-failed-earlier',
				artifactName: 'playwright-test-results-7',
				artifactId: 222,
				attempt: 2,
				hasTrace: false,
			},
		]);

		expect(merged).toEqual([
			{
				dirName: 'suite-failed-earlier',
				artifactName: 'playwright-test-results-7',
				artifactId: 111,
				attempt: 1,
				hasTrace: true,
			},
			{
				dirName: 'suite-failed-earlier',
				artifactName: 'playwright-test-results-7',
				artifactId: 222,
				attempt: 2,
				hasTrace: false,
			},
		]);
	});
});

describe('assignArtifactAttempts', () => {
	it('maps each artifact to the attempt that had started by created_at', () => {
		const attempts = [
			{ attempt: 1, startedAt: '2026-11-16T10:00:00Z' },
			{ attempt: 2, startedAt: '2026-11-16T12:00:00Z' },
		];
		const artifacts = [
			{ id: 1, name: 'a', created_at: '2026-11-16T10:30:00Z' },
			{ id: 2, name: 'a', created_at: '2026-11-16T12:15:00Z' },
			{ id: 3, name: 'b', created_at: '2026-11-16T09:59:00Z' },
		];

		expect(assignArtifactAttempts(artifacts, attempts)).toEqual([
			{
				id: 1,
				name: 'a',
				created_at: '2026-11-16T10:30:00Z',
				attempt: 1,
			},
			{
				id: 2,
				name: 'a',
				created_at: '2026-11-16T12:15:00Z',
				attempt: 2,
			},
			{
				id: 3,
				name: 'b',
				created_at: '2026-11-16T09:59:00Z',
				attempt: 1,
			},
		]);
	});
});
