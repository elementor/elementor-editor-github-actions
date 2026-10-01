const {
	countCommitsAhead,
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
	it('accepts the expected branch once it has commits ahead of the base', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			expectedBranch: 'heal/test-search-1',
			commitsAhead: 1,
		});

		// Assert
		expect(result).toBe('heal/test-search-1');
	});

	it('rejects an expected branch the agent created but never committed to', () => {
		// Arrange & Act
		const result = resolveHealerBranch({
			expectedBranch: 'heal/test-search-1',
			commitsAhead: 0,
		});

		// Assert
		expect(result).toBe('');
	});

	it('returns empty when no branch was expected', () => {
		expect(
			resolveHealerBranch({ expectedBranch: '', commitsAhead: 3 }),
		).toBe('');
	});
});

describe('countCommitsAhead', () => {
	const target = {
		repository: 'elementor/elementor-pro',
		baseRef: 'main',
		branch: 'heal/test-search-1',
	};

	it('compares the branch against the base it was started from', () => {
		// Arrange
		const run = vi.fn(() => '2\n');

		// Act
		const ahead = countCommitsAhead(target, run);

		// Assert
		expect(ahead).toBe(2);
		expect(run).toHaveBeenCalledWith([
			'api',
			'repos/elementor/elementor-pro/compare/main...heal/test-search-1',
			'--jq',
			'.ahead_by',
		]);
	});

	it('counts a branch that does not exist as zero commits ahead', () => {
		// Arrange
		const run = vi.fn(() => {
			throw Object.assign(new Error('gh failed'), {
				stderr: 'gh: Not Found (HTTP 404)',
			});
		});

		// Act & Assert
		expect(countCommitsAhead(target, run)).toBe(0);
	});

	it('fails on any other GitHub error rather than discarding a fix', () => {
		// Arrange
		const run = vi.fn(() => {
			throw Object.assign(new Error('gh failed'), {
				stderr: 'gh: Bad credentials (HTTP 401)',
			});
		});

		// Act & Assert
		expect(() => countCommitsAhead(target, run)).toThrow('gh failed');
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
