const {
	buildNightlyHealerSummary,
} = require('../scripts/nightly-healer-summary');

describe('buildNightlyHealerSummary', () => {
	it('puts the PR link in the healed summary', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'healed',
			details: {
				prUrl: 'https://github.com/o/r/pull/2',
				testName: 'Loop taxonomy filter works',
				shardIndex: 'taxonomy_filter_2',
				repo: 'o/r',
				sourceRunId: '123',
				branch: 'heal/x-1',
				rca: 'Waited for the loop grid to paint.',
			},
		});

		expect(summary).toContain('https://github.com/o/r/pull/2');
		expect(summary).toContain('`taxonomy_filter_2`');
		expect(summary).toContain('https://github.com/o/r/actions/runs/123');
		expect(summary).toContain('Waited for the loop grid to paint.');
	});

	it('warns that an unreproduced fix only proved it breaks nothing', () => {
		// Act
		const summary = buildNightlyHealerSummary({
			outcome: 'healed',
			details: {
				prUrl: 'https://github.com/o/r/pull/2',
				reproduced: false,
			},
		});

		// Assert
		expect(summary).toContain('did not reproduce');
		expect(summary).not.toContain('Fix verified');
	});

	it('builds a summary for every outcome the resolver can return', () => {
		const outcomes = [
			'healed',
			'verification-failed',
			'verification-baseline-neighbour-failed',
			'pr-open-failed',
			'unreproduced-pr-limit',
			'verified-branch',
			'verification-infra-failed',
			'verification-scope-violation',
			'agent-escalated',
			'agent-baseline-drift',
			'agent-error',
			'test-has-open-pr',
			'all-candidates-skipped',
			'no-hard-failures',
			'no-artifact-evidence',
			'no-manual-evidence',
			'disabled',
		];

		for (const outcome of outcomes) {
			expect(
				buildNightlyHealerSummary({ outcome, details: {} }),
			).toContain('Test Healer');
		}
	});

	it('throws for an unknown outcome', () => {
		expect(() =>
			buildNightlyHealerSummary({ outcome: 'nope', details: {} }),
		).toThrow(/Unknown/);
	});
});
