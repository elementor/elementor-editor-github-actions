const {
	buildNightlyHealerSlackPayload,
} = require('../scripts/nightly-healer-slack');

describe('buildNightlyHealerSlackPayload', () => {
	it('builds a test-has-open-pr message with the existing PR link', () => {
		// Arrange
		const details = {
			testName: 'Check Mega Menu icons',
			existingPrUrl: 'https://github.com/elementor/elementor-pro/pull/1',
		};

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'test-has-open-pr',
			details,
		});

		// Assert
		expect(payload.text).toContain('skipped');
		expect(JSON.stringify(payload.blocks)).toContain(details.existingPrUrl);
	});

	it('builds a healed message with the PR link and RCA', () => {
		// Arrange
		const details = {
			prUrl: 'https://github.com/elementor/elementor-pro/pull/2',
			testName: 'renders correctly',
			jiraUrl: 'https://elementor.atlassian.net/browse/ED-1',
			rca: 'The dropdown was not open before the option lookup.',
		};

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'healed',
			details,
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain(details.prUrl);
		expect(JSON.stringify(payload.blocks)).toContain(details.testName);
		expect(JSON.stringify(payload.blocks)).toContain(details.rca);
	});

	it('marks a healed PR whose failure did not reproduce', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'healed',
			details: {
				prUrl: 'https://github.com/elementor/elementor-pro/pull/2',
				testName: 'renders correctly',
				reproduced: false,
			},
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain('did not reproduce');
	});

	it('builds a no-artifact-evidence message listing the ranked failures', () => {
		// Arrange
		const details = { rankedFailures: ['test a', 'test b'] };

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'no-artifact-evidence',
			details,
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain('test a');
		expect(JSON.stringify(payload.blocks)).toContain('test b');
	});

	it('builds a no-hard-failures message', () => {
		// Arrange & Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'no-hard-failures',
			details: {},
		});

		// Assert
		expect(payload.text).toContain('no hard failures');
	});

	it('builds an agent-escalated message', () => {
		// Arrange
		const details = {
			testName: 'renders correctly',
			summary: 'App shows wrong count.',
		};

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'agent-escalated',
			details,
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain(details.testName);
		expect(JSON.stringify(payload.blocks)).toContain(details.summary);
	});

	it('builds an agent-error message', () => {
		// Arrange
		const details = { testName: 'renders correctly', status: 'ERROR' };

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'agent-error',
			details,
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain('ERROR');
	});

	it('builds a verification-failed message with the branch name', () => {
		// Arrange
		const details = {
			testName: 'renders correctly',
			branch: 'ED-1-nightly-heal-renders-correctly',
		};

		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'verification-failed',
			details,
		});

		// Assert
		expect(JSON.stringify(payload.blocks)).toContain(details.branch);
	});

	it('builds a baseline-drift message', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'agent-baseline-drift',
			details: {
				testName: 'Display conditions icon',
				shardIndex: '12',
				summary: 'new icon on Core 4.3',
			},
		});

		// Assert
		expect(payload.text).toContain('baseline drift');
		expect(payload.blocks[0].text.text).toContain(
			'Display conditions icon',
		);
	});

	it('builds a switched-off message', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'disabled',
			details: { healerSwitch: 'off' },
		});

		// Assert
		expect(payload.text).toContain('switched off');
	});

	it('names the branch left behind when the PR could not be opened', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'pr-open-failed',
			details: { testName: 'renders correctly', branch: 'heal/x-1' },
		});

		// Assert
		expect(payload.blocks[0].text.text).toContain('could not be opened');
		expect(payload.blocks[0].text.text).toContain('`heal/x-1`');
		expect(payload.blocks[0].text.text).not.toContain('View PR');
	});

	it('says a baseline stopped by another test is not a verdict', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'verification-baseline-neighbour-failed',
			details: { testName: 'renders correctly', branch: 'heal/x-1' },
		});

		// Assert
		expect(payload.blocks[0].text.text).toContain(
			'Another test in the file failed before the target during the baseline run, so the fix',
		);
		expect(payload.blocks[0].text.text).toContain(
			'This is not a verdict on the test or the fix.',
		);
	});

	it('names the branch left behind at the unreproduced draft limit', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'unreproduced-pr-limit',
			details: { testName: 'renders correctly', branch: 'heal/x-1' },
		});

		// Assert
		expect(payload.blocks[0].text.text).toContain('`heal/x-1`');
		expect(payload.blocks[0].text.text).toContain('manual pickup');
	});

	it('escapes mrkdwn in free text but keeps the healer-built links', () => {
		// Act
		const payload = buildNightlyHealerSlackPayload({
			outcome: 'healed',
			details: {
				prUrl: 'https://github.com/o/r/pull/2',
				jiraUrl: 'https://elementor.atlassian.net/browse/ED-1',
				testName: 'Renders <b> & <i> tags',
				rca: 'Fixed it <!channel>',
			},
		});
		const text = payload.blocks.map((block) => block.text.text).join('\n');

		// Assert
		expect(text).toContain('Renders &lt;b&gt; &amp; &lt;i&gt; tags');
		expect(text).toContain('Fixed it &lt;!channel&gt;');
		expect(text).not.toContain('<!channel>');
		expect(text).toContain('<https://github.com/o/r/pull/2|View PR>');
		expect(text).toContain(
			'<https://elementor.atlassian.net/browse/ED-1|Jira ticket>',
		);
	});

	it('throws for an unknown outcome', () => {
		expect(() =>
			buildNightlyHealerSlackPayload({
				outcome: 'not-a-real-outcome',
				details: {},
			}),
		).toThrow();
	});
});
