const { resolveHealerOutcome } = require('../scripts/resolve-healer-outcome');

const candidate = {
	hasCandidate: 'true',
	testName: 'Loop taxonomy filter works',
	shardIndex: 'taxonomy_filter_2',
	sourceRunId: '123',
	repo: 'elementor/elementor-pro',
};

describe('resolveHealerOutcome', () => {
	it('reports disabled before anything else, whatever else happened', () => {
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			enabled: 'false',
			healerSwitch: 'manual',
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			prUrl: 'https://github.com/o/r/pull/2',
		});

		expect(outcome).toBe('disabled');
		expect(details.healerSwitch).toBe('manual');
	});

	it('defaults the reported switch to off', () => {
		expect(
			resolveHealerOutcome({ enabled: 'false' }).details.healerSwitch,
		).toBe('off');
	});

	it('ignores the kill switch when the caller does not report one', () => {
		// Keeps older callers and unit callers working: absent means "not evaluated",
		// which must not be read as "switched off".
		expect(resolveHealerOutcome({ hasCandidate: 'false' }).outcome).toBe(
			'no-hard-failures',
		);
	});

	it('runs normally when enabled', () => {
		expect(
			resolveHealerOutcome({
				...candidate,
				enabled: 'true',
				hasCandidate: 'false',
			}).outcome,
		).toBe('no-hard-failures');
	});

	it('passes through the reason when there is no candidate', () => {
		expect(
			resolveHealerOutcome({
				hasCandidate: 'false',
				noCandidateReason: 'no-manual-evidence',
			}).outcome,
		).toBe('no-manual-evidence');
		expect(
			resolveHealerOutcome({
				hasCandidate: 'false',
				noCandidateReason: 'no-artifact-evidence',
			}).outcome,
		).toBe('no-artifact-evidence');
	});

	it('defaults to no-hard-failures when no reason was recorded', () => {
		expect(resolveHealerOutcome({ hasCandidate: 'false' }).outcome).toBe(
			'no-hard-failures',
		);
	});

	it('reports a non-finished agent run as an agent error', () => {
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'EXPIRED',
		});

		expect(outcome).toBe('agent-error');
		expect(details.status).toBe('EXPIRED');
	});

	it('reports a missing status as an agent error rather than a green run', () => {
		expect(
			resolveHealerOutcome({ ...candidate, agentStatus: '' }).outcome,
		).toBe('agent-error');
	});

	it('reports a finished run that pushed nothing as an escalation', () => {
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: '',
			agentHandoff: 'product-bug',
			agentResult: '🚨 Possible product bug: editor crashed.',
		});

		expect(outcome).toBe('agent-escalated');
		expect(details.summary).toContain('editor crashed');
	});

	it('reports a drift handoff separately from a product-bug escalation', () => {
		const drift = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: '',
			agentHandoff: 'baseline-drift',
			agentResult: '📸 Baseline drift: new icon on Core 4.3.',
		});

		expect(drift.outcome).toBe('agent-baseline-drift');
		expect(drift.details.summary).toContain('new icon');
	});

	it('reports a branchless run without a handoff marker as an agent error, not a verdict', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: '',
			agentHandoff: '',
			agentResult: 'fix-playwright-test skill unavailable',
		});

		// Assert
		expect(outcome).toBe('agent-error');
		expect(details).toMatchObject({
			status: 'FINISHED',
			summary: 'fix-playwright-test skill unavailable',
		});
	});

	it('reports a fix out of scope apart from a failed or broken verification', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyStage: 'scope',
			verifyPassed: 'false',
			verifyJobResult: 'failure',
		});

		// Assert
		expect(outcome).toBe('verification-scope-violation');
		expect(details.branch).toBe('heal/x-1');
	});

	it('reports a verify job that died before recording a stage as infrastructure', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyStage: '',
			verifyPassed: '',
			verifyJobResult: 'failure',
		});

		// Assert
		expect(outcome).toBe('verification-infra-failed');
		expect(details.stage).toBe('verify-job');
	});

	it('separates a broken verification environment from a bad fix', () => {
		for (const stage of [
			'restore',
			'setup',
			'grep',
			'baseline',
			'verify-run',
		]) {
			const { outcome, details } = resolveHealerOutcome({
				...candidate,
				agentStatus: 'FINISHED',
				agentBranch: 'heal/x-1',
				verifyStage: stage,
			});

			expect(outcome).toBe('verification-infra-failed');
			expect(details.stage).toBe(stage);
		}
	});

	it('does not credit a fix for a test that already passed without it', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyStage: 'not-reproducible',
			verifyPassed: 'false',
			buildDescription:
				'the Pro 4.2.0 with Core 4.3.0 build restored from the evidence run',
		});

		// Assert
		expect(outcome).toBe('verification-not-reproducible');
		expect(details.branch).toBe('heal/x-1');
	});

	it('reports a failing test as a failed verification', () => {
		expect(
			resolveHealerOutcome({
				...candidate,
				agentStatus: 'FINISHED',
				agentBranch: 'heal/x-1',
				verifyStage: 'test',
				verifyPassed: 'false',
				verifyJobResult: 'success',
			}).outcome,
		).toBe('verification-failed');
	});

	it('reports a passing verify-only run as a verified branch, not a heal', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			verifyOnly: 'true',
		});

		// Assert
		expect(outcome).toBe('verified-branch');
		expect(details.branch).toBe('heal/x-1');
	});

	it('still reports a failing verify-only run as a failed verification', () => {
		expect(
			resolveHealerOutcome({
				...candidate,
				agentStatus: 'FINISHED',
				agentBranch: 'heal/x-1',
				verifyStage: 'test',
				verifyPassed: 'false',
				verifyOnly: 'true',
			}).outcome,
		).toBe('verification-failed');
	});

	it('never reports healed without a passing verification', () => {
		expect(
			resolveHealerOutcome({
				...candidate,
				agentStatus: 'FINISHED',
				agentBranch: 'heal/x-1',
				prUrl: 'https://github.com/o/r/pull/2',
			}).outcome,
		).toBe('verification-failed');
	});

	it('reports healed with the PR link once verification passed', () => {
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			prUrl: 'https://github.com/o/r/pull/2',
			jiraUrl: 'https://elementor.atlassian.net/browse/ED-1',
			agentResult: 'Waited for the loop grid to paint.',
			buildDescription:
				'the Core/Pro build restored from the evidence run',
		});

		expect(outcome).toBe('healed');
		expect(details).toMatchObject({
			prUrl: 'https://github.com/o/r/pull/2',
			jiraUrl: 'https://elementor.atlassian.net/browse/ED-1',
			branch: 'heal/x-1',
			shardIndex: 'taxonomy_filter_2',
			rca: 'Waited for the loop grid to paint.',
			buildDescription:
				'the Core/Pro build restored from the evidence run',
		});
	});

	it('reports a fix that passed although the failure never reproduced as healed, flagged unreproduced', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			verifyReproduced: 'false',
			prUrl: 'https://github.com/o/r/pull/2',
		});

		// Assert
		expect(outcome).toBe('healed');
		expect(details.reproduced).toBe(false);
	});

	it('treats a verification that does not report reproduction as reproduced', () => {
		// Act
		const { details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			prUrl: 'https://github.com/o/r/pull/2',
		});

		// Assert
		expect(details.reproduced).toBe(true);
	});

	it('flags a verify-only branch that passed without the failure reproducing', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			verifyReproduced: 'false',
			verifyOnly: 'true',
		});

		// Assert
		expect(outcome).toBe('verified-branch');
		expect(details.reproduced).toBe(false);
	});

	it('reports a verified fix as a duplicate when a PR for the test appeared meanwhile', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'FINISHED',
			agentBranch: 'heal/x-1',
			verifyPassed: 'true',
			duplicatePrUrl: 'https://github.com/o/r/pull/7682',
		});

		// Assert
		expect(outcome).toBe('test-has-open-pr');
		expect(details).toMatchObject({
			branch: 'heal/x-1',
			existingPrUrl: 'https://github.com/o/r/pull/7682',
		});
	});

	it('carries the open PR through when a requested test is refused', () => {
		// Act
		const { outcome, details } = resolveHealerOutcome({
			...candidate,
			hasCandidate: 'false',
			noCandidateReason: 'test-has-open-pr',
			existingPrUrl: 'https://github.com/o/r/pull/7682',
		});

		// Assert
		expect(outcome).toBe('test-has-open-pr');
		expect(details.existingPrUrl).toBe('https://github.com/o/r/pull/7682');
	});

	it('carries the passed-over candidates into every outcome', () => {
		// Arrange
		const skippedCandidates = [
			{
				testName: 'Check Mega Menu icons',
				reason: 'open-pr',
				prUrl: 'u/1',
			},
		];

		// Act
		const { details } = resolveHealerOutcome({
			...candidate,
			agentStatus: 'EXPIRED',
			skippedCandidates,
		});

		// Assert
		expect(details.skippedCandidates).toEqual(skippedCandidates);
	});
});
