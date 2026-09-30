const {
	detectHandoff,
	evaluateHealerAgentRun,
	resolveHealerBranch,
	shouldWaitForCursorBranch,
	withResolvedBranch,
} = require('../scripts/poll-cloud-agent-run');

describe('evaluateHealerAgentRun', () => {
	it('accepts a finished run that pushed a branch', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: { branches: [{ name: 'ED-00000-nightly-heal-search' }] },
			result: 'RCA: waited for the results list.',
		};

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.ok).toBe(true);
		expect(result.branch).toBe('ED-00000-nightly-heal-search');
	});

	it('accepts a finished run with no branch when the product-bug marker is present', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: { branches: [] },
			result: '🚨 Possible product bug: editor crash overlay. No fix pushed — escalating.',
		};

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.ok).toBe(true);
		expect(result.branch).toBe('');
	});

	it('rejects a finished RCA-only run with no branch and no product-bug marker', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: {},
			result: 'Timing race after HTTP 200. Two races were involved.',
		};

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/without pushing a branch/);
	});
});

describe('shouldWaitForCursorBranch', () => {
	it('waits when FINISHED with empty git.branches and no product-bug marker', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: {},
			result: 'Timing race after HTTP 200.',
		};

		// Act
		const result = shouldWaitForCursorBranch(run);

		// Assert
		expect(result).toBe(true);
	});

	it('does not wait when Cursor already reported a branch', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: { branches: [{ name: 'ED-00000-nightly-heal-search' }] },
			result: 'pushed',
		};

		// Act
		const result = shouldWaitForCursorBranch(run);

		// Assert
		expect(result).toBe(false);
	});

	it('does not wait when the agent used the product-bug marker', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: {},
			result: '🚨 Possible product bug: editor crash overlay. No fix pushed — escalating.',
		};

		// Act
		const result = shouldWaitForCursorBranch(run);

		// Assert
		expect(result).toBe(false);
	});
});

describe('resolveHealerBranch', () => {
	it('accepts the branch Cursor reports when it is the one the agent was given', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			cursorBranch: 'ED-00000-nightly-heal-search',
			expectedBranch: 'ED-00000-nightly-heal-search',
			githubHasExpectedBranch: false,
		});

		// Assert
		expect(result).toBe('ED-00000-nightly-heal-search');
	});

	it('ignores any other branch Cursor reports', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			cursorBranch: 'main',
			expectedBranch: 'ED-00000-nightly-heal-search',
			githubHasExpectedBranch: false,
		});

		// Assert
		expect(result).toBe('');
	});

	it('falls back to the expected GitHub branch when Cursor git.branches is still empty', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			cursorBranch: '',
			expectedBranch: 'ED-00000-nightly-heal-search',
			githubHasExpectedBranch: true,
		});

		// Assert
		expect(result).toBe('ED-00000-nightly-heal-search');
	});

	it('returns empty when neither Cursor nor GitHub has the branch', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			cursorBranch: '',
			expectedBranch: 'ED-00000-nightly-heal-search',
			githubHasExpectedBranch: false,
		});

		// Assert
		expect(result).toBe('');
	});
});

describe('withResolvedBranch', () => {
	it('attaches a fallback branch so evaluateHealerAgentRun treats the run as pushed', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: {},
			result: 'Timing race after HTTP 200.',
		};

		// Act
		const resolved = withResolvedBranch(
			run,
			'ED-00000-nightly-heal-search',
		);
		const result = evaluateHealerAgentRun(resolved);

		// Assert
		expect(result.ok).toBe(true);
		expect(result.branch).toBe('ED-00000-nightly-heal-search');
	});

	it('drops a branch Cursor reported when the resolved branch is empty', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: { branches: [{ name: 'cursor/other-1234' }] },
			result: 'Pushed.',
		};

		// Act
		const result = evaluateHealerAgentRun(withResolvedBranch(run, ''));

		// Assert
		expect(result.ok).toBe(false);
		expect(result.branch).toBe('');
	});
});

describe('detectHandoff', () => {
	it('reads the marker from the last line only', () => {
		// Arrange
		const result =
			'Not a 📸 Baseline drift: every retry differs.\nWaited for the grid and pushed.';

		// Act
		const handoff = detectHandoff(result);

		// Assert
		expect(handoff).toBe('');
	});

	it('finds the marker on the last line after an RCA', () => {
		expect(
			detectHandoff(
				'RCA: overlay on load.\n\n🚨 Possible product bug: editor crashed.\n',
			),
		).toBe('product-bug');
	});

	it('recognises the product-bug marker', () => {
		expect(
			detectHandoff('RCA... 🚨 Possible product bug: editor crashed.'),
		).toBe('product-bug');
	});

	it('recognises the baseline-drift marker', () => {
		expect(
			detectHandoff('📸 Baseline drift: icon changed on Core 4.3.'),
		).toBe('baseline-drift');
	});

	it('recognises markers written with markdown emphasis', () => {
		expect(
			detectHandoff('> 🚨 **Possible product bug**: editor crashed.'),
		).toBe('product-bug');
		expect(
			detectHandoff('📸 **Baseline drift**: icon changed on Core 4.3.'),
		).toBe('baseline-drift');
	});

	it('returns an empty string for an RCA with no marker', () => {
		expect(detectHandoff('I looked at it and it seems flaky.')).toBe('');
		expect(detectHandoff(undefined)).toBe('');
	});
});

describe('evaluateHealerAgentRun baseline drift', () => {
	it('accepts a finished run with no branch when the drift marker is present', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			result: '📸 Baseline drift: new icon on Core 4.3. No fix pushed — needs a versioned baseline.',
		};

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.ok).toBe(true);
		expect(result.handoff).toBe('baseline-drift');
	});

	it('reports no handoff when a branch was pushed', () => {
		// Arrange
		const run = {
			status: 'FINISHED',
			git: { branches: [{ name: 'heal/x-1' }] },
			result: 'Waited for the grid.',
		};

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.handoff).toBe('');
		expect(result.branch).toBe('heal/x-1');
	});

	it('still rejects an RCA-only run and names both handoff markers', () => {
		// Arrange
		const run = { status: 'FINISHED', result: 'Looks flaky to me.' };

		// Act
		const result = evaluateHealerAgentRun(run);

		// Assert
		expect(result.ok).toBe(false);
		expect(result.error).toContain('Baseline drift');
		expect(result.error).toContain('Possible product bug');
	});
});
