'use strict';

const {
	assignArtifactAttempts,
	getRunAttemptInfo,
	latestArtifactPerName,
	listArtifactsAcrossAttempts,
	listJobsAcrossAttempts,
} = require('../scripts/run-attempts');

/**
 * A stand-in for `gh` that answers by the API path in its arguments. Keys
 * are matched as prefixes, longest first.
 */
function fakeGh(responses) {
	const keys = Object.keys(responses).sort((a, b) => b.length - a.length);
	const calls = [];
	const run = (args) => {
		calls.push(args);
		const match = keys.find((key) => args[1].startsWith(key));
		if (undefined === match) {
			throw new Error(`Unexpected gh call: ${args.join(' ')}`);
		}
		return responses[match];
	};
	run.calls = calls;
	return run;
}

const REPO = 'elementor/elementor-pro';
const RUN = 'repos/elementor/elementor-pro/actions/runs/7';

describe('getRunAttemptInfo', () => {
	it('reads the start time of every attempt of a re-run', () => {
		// Arrange
		const gh = fakeGh({
			[`${RUN}/attempts/1`]: '2026-11-10T02:00:00Z\n',
			[`${RUN}/attempts/2`]: '2026-11-10T05:00:00Z\n',
			[RUN]: '2\n',
		});

		// Act
		const info = getRunAttemptInfo(REPO, 7, gh);

		// Assert
		expect(info).toEqual({
			runAttempt: 2,
			attempts: [
				{ attempt: 1, startedAt: '2026-11-10T02:00:00Z' },
				{ attempt: 2, startedAt: '2026-11-10T05:00:00Z' },
			],
		});
	});
});

describe('listJobsAcrossAttempts', () => {
	it('lists the matching jobs of every attempt, tagged with the attempt', () => {
		// Arrange
		const gh = fakeGh({
			[`${RUN}/attempts/1/jobs`]: '101\n102\n',
			[`${RUN}/attempts/2/jobs`]: '201\n',
			[RUN]: '2\n',
		});

		// Act
		const jobs = listJobsAcrossAttempts(REPO, 7, ['failure'], gh);

		// Assert
		expect(jobs).toEqual([
			{ attempt: 1, jobId: '101' },
			{ attempt: 1, jobId: '102' },
			{ attempt: 2, jobId: '201' },
		]);
	});

	it('selects every requested conclusion', () => {
		// Arrange
		const gh = fakeGh({
			[`${RUN}/attempts/1/jobs`]: '',
			[RUN]: '1\n',
		});

		// Act
		listJobsAcrossAttempts(REPO, 7, ['success', 'failure'], gh);

		// Assert
		const jobsCall = gh.calls.find((args) => args[1].includes('/jobs'));
		expect(jobsCall.at(-1)).toBe(
			'.jobs[] | select(.conclusion == "success" or .conclusion == "failure") | .id',
		);
	});
});

describe('assignArtifactAttempts', () => {
	const attempts = [
		{ attempt: 1, startedAt: '2026-11-10T02:00:00Z' },
		{ attempt: 2, startedAt: '2026-11-10T05:00:00Z' },
	];

	it('gives each artifact the latest attempt that had started when it was created', () => {
		// Act
		const result = assignArtifactAttempts(
			[
				{ name: 'a', created_at: '2026-11-10T03:00:00Z' },
				{ name: 'a', created_at: '2026-11-10T06:00:00Z' },
			],
			attempts,
		);

		// Assert
		expect(result.map((artifact) => artifact.attempt)).toEqual([1, 2]);
	});

	it('falls back to attempt 1 when the times are unknown', () => {
		// Act
		const result = assignArtifactAttempts([{ name: 'a' }], []);

		// Assert
		expect(result[0].attempt).toBe(1);
	});
});

describe('listArtifactsAcrossAttempts', () => {
	it('annotates every artifact with its attempt', () => {
		// Arrange
		const gh = fakeGh({
			[`${RUN}/artifacts`]: [
				JSON.stringify({
					name: 'playwright-test-results-3',
					id: 1,
					created_at: '2026-11-10T03:00:00Z',
				}),
				JSON.stringify({
					name: 'playwright-test-results-3',
					id: 2,
					created_at: '2026-11-10T06:00:00Z',
				}),
			].join('\n'),
			[`${RUN}/attempts/1`]: '2026-11-10T02:00:00Z',
			[`${RUN}/attempts/2`]: '2026-11-10T05:00:00Z',
			[RUN]: '2',
		});

		// Act
		const artifacts = listArtifactsAcrossAttempts(REPO, 7, gh);

		// Assert
		expect(artifacts.map(({ id, attempt }) => ({ id, attempt }))).toEqual([
			{ id: 1, attempt: 1 },
			{ id: 2, attempt: 2 },
		]);
	});

	it('does not look up attempts for a run without artifacts', () => {
		// Arrange
		const gh = fakeGh({ [`${RUN}/artifacts`]: '' });

		// Act & Assert
		expect(listArtifactsAcrossAttempts(REPO, 7, gh)).toEqual([]);
		expect(gh.calls).toHaveLength(1);
	});
});

describe('latestArtifactPerName', () => {
	it('keeps the latest attempt of each name', () => {
		// Act
		const result = latestArtifactPerName([
			{ name: 'elementor-core-build', id: 1, attempt: 1 },
			{ name: 'elementor-core-build', id: 2, attempt: 2 },
			{ name: 'elementor-pro-3.30', id: 3, attempt: 1 },
		]);

		// Assert
		expect(result.map((artifact) => artifact.id).sort()).toEqual([2, 3]);
	});
});
