const {
	buildPrompt,
	dispatchRetryDelayMs,
	isRetryableDispatchStatus,
	readHealerSkills,
} = require('../scripts/dispatch-cloud-agent');

const input = {
	testName: 'Search Result Visibility',
	runUrl: 'https://github.com/elementor/elementor-pro/actions/runs/35809375279',
	shardIndex: '28',
	branchName: 'heal/search-result-visibility-123',
	matchedDirs: 'modules-search-search-layo-feb35-ch-Search-Result-Visibility',
	startingRef: 'main',
	skills: [],
};

describe('readHealerSkills', () => {
	it('reads only the healer wrapper, which points at the marketplace fix-playwright-test skill', () => {
		// Act
		const skills = readHealerSkills();

		// Assert
		expect(skills.map((skill) => skill.name)).toEqual([
			'heal-ci-playwright-test',
		]);
		expect(skills[0].content).toContain('/fix-playwright-test');
	});

	it('fails loudly when a skill is missing rather than dispatching without it', () => {
		expect(() => readHealerSkills('/nonexistent')).toThrow(
			/Healer skill not found/,
		);
	});
});

describe('buildPrompt', () => {
	it('embeds every skill in full, so the agent has them whatever its base ref carries', () => {
		// Arrange
		const skills = [
			{ name: 'heal-ci-playwright-test', content: 'WRAPPER BODY' },
			{ name: 'fix-playwright-test', content: 'METHOD BODY' },
		];

		// Act
		const prompt = buildPrompt({ ...input, skills });

		// Assert
		expect(prompt).toContain(
			'===== SKILL: heal-ci-playwright-test =====\nWRAPPER BODY',
		);
		expect(prompt).toContain(
			'===== SKILL: fix-playwright-test =====\nMETHOD BODY',
		);
		expect(prompt.indexOf('Failing test:')).toBeLessThan(
			prompt.indexOf('WRAPPER BODY'),
		);
	});

	it('tells the agent to stop when the marketplace skill is unavailable', () => {
		expect(buildPrompt(input)).toContain(
			'fix-playwright-test skill unavailable',
		);
	});

	it('asks for a local run before pushing', () => {
		expect(buildPrompt(input)).toContain('run the test locally');
	});

	it('carries the candidate the ranker chose', () => {
		// Act
		const prompt = buildPrompt(input);

		// Assert
		expect(prompt).toContain('Search Result Visibility');
		expect(prompt).toContain(input.runUrl);
		expect(prompt).toContain(input.branchName);
		expect(prompt).toContain(input.matchedDirs);
	});

	it('names the shard artifact so the agent does not guess from the Allure title', () => {
		expect(buildPrompt(input)).toContain('playwright-test-results-28');
	});

	it('tells the agent to find the failed shard itself when none was resolved', () => {
		// Arrange
		const prompt = buildPrompt({ ...input, shardIndex: '' });

		// Assert
		expect(prompt).toContain('Failed shard: unknown');
		// It should point at the wildcard, never invent a specific shard artifact.
		expect(prompt).toContain('playwright-test-results-* artifact');
		expect(prompt).not.toMatch(/playwright-test-results-\d/);
	});

	it('offers all three endings, not just pushing', () => {
		// A prompt that says only "you fail if you do not push" biases the agent
		// into a wait-based fix for baseline drift, which then verifies green.
		const prompt = buildPrompt(input);

		expect(prompt).toContain('push a fix');
		expect(prompt).toContain('baseline-drift line');
		expect(prompt).toContain('product-bug line');
		expect(prompt).not.toContain(
			'You fail this assignment if you do not git push',
		);
	});

	it('states the race/drift/product-bug decision and both exact markers', () => {
		// Act
		const prompt = buildPrompt(input);

		// Assert
		expect(prompt).toContain('race vs baseline drift vs product bug');
		expect(prompt).toContain('📸 Baseline drift:');
		expect(prompt).toContain('🚨 Possible product bug:');
	});

	it('forbids snapshot changes and PR creation', () => {
		// Act
		const prompt = buildPrompt(input);

		// Assert
		expect(prompt).toContain(
			'Never update, replace, or add snapshot images',
		);
		expect(prompt).toContain('Do NOT open a pull request');
		expect(prompt).toContain('Only commit files under tests/playwright/');
	});

	it('defaults the starting ref to main', () => {
		expect(buildPrompt({ ...input, startingRef: '' })).toContain(
			'starting from git ref "main"',
		);
	});
});

describe('isRetryableDispatchStatus', () => {
	it('retries the rate limit Cursor returns when its GitHub App is throttled', () => {
		expect(isRetryableDispatchStatus(429)).toBe(true);
	});

	it('retries server errors', () => {
		expect(isRetryableDispatchStatus(500)).toBe(true);
		expect(isRetryableDispatchStatus(503)).toBe(true);
	});

	it('does not retry a bad key or a bad request', () => {
		expect(isRetryableDispatchStatus(401)).toBe(false);
		expect(isRetryableDispatchStatus(400)).toBe(false);
		expect(isRetryableDispatchStatus(404)).toBe(false);
	});
});

describe('dispatchRetryDelayMs', () => {
	it('honours the retryAfter Cursor nests in its error details', () => {
		// Arrange — the real 429 body shape observed from api.cursor.com.
		const body = {
			code: 'resource_exhausted',
			details: [
				{
					debug: {
						details: {
							additionalInfo: {
								kind: 'github_api',
								retryAfter: '60',
							},
						},
					},
				},
			],
		};

		// Act & Assert
		expect(dispatchRetryDelayMs(body, 1)).toBe(60000);
	});

	it('backs off progressively when the server gives no hint', () => {
		expect(dispatchRetryDelayMs({}, 1)).toBe(60000);
		expect(dispatchRetryDelayMs({}, 3)).toBe(180000);
	});

	it('never waits longer than five minutes', () => {
		expect(dispatchRetryDelayMs({}, 99)).toBe(300000);
		expect(
			dispatchRetryDelayMs(
				{
					details: [
						{
							debug: {
								details: {
									additionalInfo: { retryAfter: '99999' },
								},
							},
						},
					],
				},
				1,
			),
		).toBe(300000);
	});

	it('ignores a malformed retryAfter', () => {
		expect(
			dispatchRetryDelayMs(
				{
					details: [
						{
							debug: {
								details: {
									additionalInfo: { retryAfter: 'soon' },
								},
							},
						},
					],
				},
				2,
			),
		).toBe(120000);
	});
});

describe('buildPrompt retries', () => {
	const retryInput = {
		...input,
		attempt: '2',
		maxAttempts: '2',
		previousBranch: 'heal/keyword-search-for-posts-123',
		previousRunId: '456',
	};

	it('says nothing about attempts on the first try', () => {
		const prompt = buildPrompt({
			...input,
			attempt: '1',
			maxAttempts: '2',
		});

		expect(prompt).not.toContain('attempt');
		expect(prompt).not.toContain('FAILED verification');
	});

	it('hands the retry the branch that already failed, so it does not re-derive it', () => {
		const prompt = buildPrompt(retryInput);

		expect(prompt).toContain('attempt 2 of 2');
		expect(prompt).toContain('heal/keyword-search-for-posts-123');
		expect(prompt).toContain('Do not repeat that approach');
	});

	it('diffs the failed branch against the fix base, not always main', () => {
		expect(buildPrompt({ ...retryInput, startingRef: '4.03' })).toContain(
			'git diff 4.03...FETCH_HEAD',
		);
	});

	it('points the retry at the failing re-run output', () => {
		expect(buildPrompt(retryInput)).toContain(
			'healer-verify-failure-test-results',
		);
		expect(buildPrompt(retryInput)).toContain('456');
	});

	it('tells the retry that a second failure is evidence against a race', () => {
		// Without this a retry loop just produces three waits in a row.
		expect(buildPrompt(retryInput)).toContain('not a race');
	});

	it('omits the run-artifact hint when no previous run is known', () => {
		const prompt = buildPrompt({ ...retryInput, previousRunId: '' });

		expect(prompt).toContain('Do not repeat that approach');
		expect(prompt).not.toContain('healer-verify-failure-test-results');
	});

	it('ignores an attempt number with no previous branch to learn from', () => {
		expect(
			buildPrompt({
				...input,
				attempt: '2',
				maxAttempts: '2',
				previousBranch: '',
			}),
		).not.toContain('FAILED verification');
	});
});
