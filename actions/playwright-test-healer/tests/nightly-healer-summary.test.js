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

	it('links the Jira task when one was created', () => {
		// Arrange
		const details = {
			prUrl: 'https://github.com/o/r/pull/2',
			jiraUrl: 'https://elementor.atlassian.net/browse/ED-1',
		};

		// Act
		const summary = buildNightlyHealerSummary({
			outcome: 'healed',
			details,
		});

		// Assert
		expect(summary).toContain(
			'Jira: https://elementor.atlassian.net/browse/ED-1',
		);
	});

	it('says which build the fix was verified against', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'healed',
			details: {
				prUrl: 'https://github.com/o/r/pull/2',
				buildDescription: 'a fresh build of `main`',
			},
		});

		expect(summary).toContain(
			're-run against a fresh build of `main` before the PR was opened',
		);
	});

	it('explains what to try next when a fed test has no evidence', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'no-manual-evidence',
			details: { testName: 'Typo in the title' },
		});

		expect(summary).toContain('Typo in the title');
		expect(summary).toContain('source_run_id');
	});

	it('says an infrastructure failure is not a verdict on the fix', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'verification-infra-failed',
			details: { testName: 't', branch: 'heal/x-1', stage: 'restore' },
		});

		expect(summary).toContain('`restore`');
		expect(summary).toContain('untested');
	});

	it('explains why a drift handoff could not be completed by the healer', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'agent-baseline-drift',
			details: {
				testName: 'Display conditions icon',
				summary: '📸 Baseline drift: new icon on Core 4.3.',
			},
		});

		expect(summary).toContain('test-helper.ts');
		expect(summary).toContain('not allowed to add baseline images');
	});

	it('lists the failures it could not investigate', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'no-artifact-evidence',
			details: { rankedFailures: ['first test', 'second test'] },
		});

		expect(summary).toContain('`first test`');
		expect(summary).toContain('`second test`');
	});

	it('builds a summary for every outcome the resolver can return', () => {
		const outcomes = [
			'healed',
			'verification-failed',
			'verification-not-reproducible',
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

	it('lists the candidates it passed over and why', () => {
		// Arrange
		const skippedCandidates = [
			{
				testName: 'Check Mega Menu icons',
				reason: 'recent-verdict',
				outcome: 'verification-not-reproducible',
				recordedAt: '2026-09-28T02:00:00Z',
				runUrl: 'https://github.com/o/r/actions/runs/1',
			},
			{
				testName: 'Search Result Visibility',
				reason: 'open-pr',
				prUrl: 'https://github.com/o/r/pull/7682',
			},
		];

		// Act
		const summary = buildNightlyHealerSummary({
			outcome: 'no-hard-failures',
			details: { skippedCandidates },
		});

		// Assert
		expect(summary).toContain(
			'`Check Mega Menu icons` — `verification-not-reproducible`',
		);
		expect(summary).toContain(
			'`Search Result Visibility` — open PR https://github.com/o/r/pull/7682',
		);
	});

	it('says how to switch the healer on', () => {
		const summary = buildNightlyHealerSummary({
			outcome: 'disabled',
			details: { healerSwitch: 'off' },
		});

		expect(summary).toContain('TEST_HEALER_ENABLED');
		expect(summary).toContain('`manual`');
		expect(summary).toContain('`all`');
	});

	it('throws for an unknown outcome', () => {
		expect(() =>
			buildNightlyHealerSummary({ outcome: 'nope', details: {} }),
		).toThrow(/Unknown/);
	});
});
