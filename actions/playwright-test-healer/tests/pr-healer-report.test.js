const {
	COMMENT_MARKER,
	VERDICTS,
	buildFixPrBody,
	buildFixPrTitle,
	buildPrComment,
	buildSlackPayload,
	describeFixOutcome,
	planFlakyFixes,
	resolvePrVerdicts,
	testMarker,
} = require('../scripts/pr-healer-report');

function triaged(testName, overrides = {}) {
	return {
		testName,
		shardIndex: '3',
		rerunnable: true,
		linked: false,
		reasons: [],
		evidence: [],
		specFiles: [],
		artifactNames: ['playwright-test-results-3'],
		hasTrace: true,
		...overrides,
	};
}

function rerun(testName, passed, failed, error = '') {
	return { testName, runs: passed + failed || 3, passed, failed, error };
}

const LINKS = {
	repo: 'elementor/elementor-pro',
	headSha: 'abcdef1234567',
	baseSha: '1234567abcdef',
	sourceRunUrl: 'https://github.com/elementor/elementor-pro/actions/runs/1',
	healerRunUrl: 'https://github.com/elementor/elementor-pro/actions/runs/2',
	label: 'heal',
};

describe('resolvePrVerdicts', () => {
	it('gives every failure exactly one verdict, most actionable first', () => {
		// Arrange
		const triage = [
			triaged('Flaky'),
			triaged('Linked', {
				linked: true,
				reasons: ['The PR changes the spec.', 'And more.'],
			}),
			triaged('On main'),
			triaged('Only here'),
			triaged('Unrunnable', {
				rerunnable: false,
				shardIndex: 'elements-regression-core',
			}),
			triaged('Over limit'),
			triaged('Errored'),
		];

		// Act
		const verdicts = resolvePrVerdicts({
			triage,
			prRerun: [
				rerun('Flaky', 1, 2),
				rerun('On main', 0, 3),
				rerun('Only here', 0, 3),
				rerun(
					'Errored',
					0,
					0,
					'The test could not be found to re-run it.',
				),
			],
			mainRerun: [rerun('On main', 0, 3), rerun('Only here', 2, 1)],
			fixes: [
				{ testName: 'Flaky', status: 'fixed', url: 'https://x/pr/9' },
			],
			overLimit: ['Over limit'],
			rerunLimit: 20,
		});

		// Assert
		const byName = Object.fromEntries(
			verdicts.map((verdict) => [verdict.testName, verdict]),
		);
		expect(verdicts).toHaveLength(triage.length);
		expect(verdicts[0].verdict).toBe(VERDICTS.BROKEN);
		expect(byName.Linked.reason).toBe('The PR changes the spec.');
		expect(byName.Flaky).toMatchObject({
			verdict: VERDICTS.FLAKY,
			fix: 'fixed',
		});
		expect(byName['On main'].verdict).toBe(VERDICTS.FAILING_ON_MAIN);
		expect(byName['Only here'].verdict).toBe(VERDICTS.NEEDS_HUMAN);
		expect(byName['Only here'].reason).toContain(
			'passed 2 of 3 runs on main',
		);
		expect(byName.Unrunnable.reason).toContain('elements-regression-core');
		expect(byName['Over limit'].reason).toContain('at most 20 tests');
		expect(byName.Errored.reason).toContain('could not be found');
	});

	it('never re-runs a linked failure into another verdict, even with re-run data', () => {
		// Act
		const [verdict] = resolvePrVerdicts({
			triage: [
				triaged('Linked', { linked: true, reasons: ['Spec changed.'] }),
			],
			prRerun: [rerun('Linked', 3, 0)],
		});

		// Assert
		expect(verdict.verdict).toBe(VERDICTS.BROKEN);
	});

	it('needs a human when a re-run job did not finish', () => {
		// Act
		const verdicts = resolvePrVerdicts({
			triage: [triaged('No rerun'), triaged('No main')],
			prRerun: [rerun('No main', 0, 3)],
			prRerunFailed: true,
			mainRerunFailed: true,
		});

		// Assert
		expect(verdicts.map((verdict) => verdict.verdict)).toEqual([
			VERDICTS.NEEDS_HUMAN,
			VERDICTS.NEEDS_HUMAN,
		]);
		expect(verdicts[0].reason).toContain('failed before it could re-run');
		expect(verdicts[1].reason).toContain('run on main failed');
	});
});

describe('planFlakyFixes', () => {
	it('links tests with an open fix, caps the rest, and indexes the ones to fix', () => {
		// Arrange
		const openPrs = [
			{
				url: 'https://x/pr/1',
				baseRefName: 'main',
				title: 'Internal: Fix flaky test - Already nightly [ED-1]',
				headRefName: 'heal/already-nightly-123',
				body: '',
			},
			{
				url: 'https://x/pr/2',
				baseRefName: 'main',
				title: 'Internal: Fix flaky Playwright tests found on PR 5 [ED-1]',
				headRefName: 'heal/pr-5-1',
				body: `### x\n${testMarker('From a PR')}`,
			},
		];

		// Act
		const { toFix, skipped } = planFlakyFixes({
			flakyTests: [
				{ testName: 'Already nightly' },
				{ testName: 'From a PR' },
				{ testName: 'New one' },
				{ testName: 'New two' },
			],
			openPrs,
			baseRef: 'main',
			maxFixes: 1,
		});

		// Assert
		expect(toFix).toEqual([{ testName: 'New one', index: 0 }]);
		expect(skipped).toEqual([
			expect.objectContaining({
				testName: 'Already nightly',
				status: 'existing-pr',
				url: 'https://x/pr/1',
			}),
			expect.objectContaining({
				testName: 'From a PR',
				status: 'existing-pr',
				url: 'https://x/pr/2',
			}),
			expect.objectContaining({
				testName: 'New two',
				status: 'not-fixed',
			}),
		]);
	});
});

describe('describeFixOutcome', () => {
	it('says why a fix did not make it, from the furthest stage it reached', () => {
		// Assert
		expect(
			describeFixOutcome({
				agent: { branch: 'heal/x' },
				verify: { passed: 'true' },
			}),
		).toEqual({ status: 'verified' });
		expect(describeFixOutcome({}).note).toContain('did not report back');
		expect(
			describeFixOutcome({ agent: { handoff: 'baseline-drift' } }).note,
		).toContain('baseline drift');
		expect(
			describeFixOutcome({ agent: { status: 'FINISHED', branch: '' } })
				.note,
		).toContain('pushed no fix (finished)');
		expect(
			describeFixOutcome({
				agent: { branch: 'heal/x' },
				verify: { passed: 'false', stage: 'test' },
				verifyRepeat: 10,
			}).note,
		).toContain('did not pass 10 runs in a row on main');
		expect(
			describeFixOutcome({
				agent: { branch: 'heal/x' },
				verify: { passed: 'false', stage: 'scope' },
			}).note,
		).toContain('may not touch');
	});
});

describe('buildPrComment', () => {
	it('starts with the marker and lists each verdict with its evidence', () => {
		// Arrange
		const verdicts = resolvePrVerdicts({
			triage: [
				triaged('Linked | pipe', {
					linked: true,
					reasons: ['The PR changes `x.ts`.'],
					evidence: [
						{
							file: 'x.ts',
							line: 12,
							side: 'head',
							text: '+const a = 1;',
						},
					],
				}),
				triaged('Flaky'),
			],
			prRerun: [rerun('Flaky', 2, 1)],
			fixes: [
				{ testName: 'Flaky', status: 'fixed', url: 'https://x/pr/9' },
			],
		});

		// Act
		const comment = buildPrComment({
			...LINKS,
			state: 'ok',
			verdicts,
			fixPrUrl: 'https://x/pr/9',
		});

		// Assert
		expect(comment.startsWith(COMMENT_MARKER)).toBe(true);
		expect(comment).toContain('Checked the 2 failed tests');
		expect(comment).toContain('`Linked \\| pipe`');
		expect(comment).toContain(
			'[`x.ts:12`](https://github.com/elementor/elementor-pro/blob/abcdef1234567/x.ts#L12)',
		);
		expect(comment).toContain('Fixed in the flaky-fix PR.');
		expect(comment).toContain('🩹 **Flaky fixes:** https://x/pr/9');
		expect(comment).toContain('were not re-run or changed');
	});

	it('escapes a backslash before a pipe, so a title cannot break the table', () => {
		// Arrange
		const verdicts = resolvePrVerdicts({
			triage: [triaged('a\\|b', { rerunnable: false })],
		});

		// Act
		const comment = buildPrComment({ ...LINKS, state: 'ok', verdicts });

		// Assert
		expect(comment).toContain('| `a\\\\\\|b` |');
	});

	it('says there was nothing to heal when the run has no failures', () => {
		// Act
		const comment = buildPrComment({ ...LINKS, state: 'ok', verdicts: [] });

		// Assert
		expect(comment).toContain('has no failed tests — nothing to heal');
		expect(comment).not.toContain('Flaky fixes');
	});

	it.each([
		['disabled', 'switched off'],
		['fork', 'only runs on PRs from branches in this repository'],
		['no-run', 'No Playwright run'],
		['error', 'failed before it could check'],
	])('explains the %s state', (state, text) => {
		// Assert
		expect(buildPrComment({ ...LINKS, state })).toContain(text);
	});
});

describe('fix PR texts', () => {
	it('keeps the title within commitlint limits and marks each test in the body', () => {
		// Act
		const title = buildFixPrTitle({
			prNumber: '7850',
			jiraKey: 'ED-22856',
		});
		const body = buildFixPrBody({
			fixes: [
				{ testName: 'Flaky one', resultText: 'Waited for ~~~ settle' },
			],
			prUrl: 'https://x/pr/7850',
			sourceRunUrl: LINKS.sourceRunUrl,
			healerRunUrl: LINKS.healerRunUrl,
			verifyRepeat: 10,
			jiraUrl: 'https://elementor.atlassian.net/browse/ED-22856',
		});

		// Assert
		expect(title).toBe(
			'Internal: Fix flaky Playwright tests found on PR 7850 [ED-22856]',
		);
		expect(body).toContain(testMarker('Flaky one'));
		expect(body).toContain('passed 10x in a row');
		expect(body).toContain('Waited for ~ ~ ~ settle');
	});

	it('names the fix PR and its tests in the Slack message', () => {
		// Act
		const payload = buildSlackPayload({
			repo: 'elementor/elementor-pro',
			prNumber: '7850',
			prUrl: 'https://x/pr/7850',
			fixPrUrl: 'https://x/pr/9',
			fixes: [{ testName: 'Flaky one' }],
		});

		// Assert
		expect(payload.text).toContain('<https://x/pr/9|review the fix PR>');
		expect(payload.blocks[1].text.text).toContain('`Flaky one`');
	});
});
