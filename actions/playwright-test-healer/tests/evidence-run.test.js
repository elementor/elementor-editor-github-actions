const {
	assertHealableEvidenceRun,
	isHealableBase,
} = require('../scripts/evidence-run');

const run = {
	runId: 1,
	repo: 'elementor/elementor',
	event: 'schedule',
	headRepository: 'elementor/elementor',
	baseRef: 'main',
};

describe('isHealableBase', () => {
	it.each(['main', '4.03', '3.32'])('accepts %s', (branch) => {
		expect(isHealableBase(branch)).toBe(true);
	});

	it.each([
		'',
		'cursor/x',
		'Internal/ED-1-x',
		'cherry-pick-pr1_to_4_01',
		'main-x',
	])('refuses "%s"', (branch) => {
		expect(isHealableBase(branch)).toBe(false);
	});
});

describe('assertHealableEvidenceRun', () => {
	it('accepts a nightly on main and a dispatch on a release branch', () => {
		expect(() => assertHealableEvidenceRun(run)).not.toThrow();
		expect(() =>
			assertHealableEvidenceRun({
				...run,
				event: 'workflow_dispatch',
				baseRef: '4.03',
			}),
		).not.toThrow();
	});

	it('refuses a pull request run even on main', () => {
		expect(() =>
			assertHealableEvidenceRun({ ...run, event: 'pull_request' }),
		).toThrow(/pull_request run/);
	});

	it("refuses a fork's run", () => {
		expect(() =>
			assertHealableEvidenceRun({
				...run,
				headRepository: 'someone/elementor',
			}),
		).toThrow(/someone\/elementor/);
	});

	it('refuses a feature branch', () => {
		expect(() =>
			assertHealableEvidenceRun({
				...run,
				baseRef: 'Internal/ED-25542-x',
			}),
		).toThrow(/main and release branches/);
	});
});
