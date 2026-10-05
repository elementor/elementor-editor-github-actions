const {
	PR_TITLE_MAX_LENGTH,
	buildHealPrTitle,
	buildTicketSummary,
	buildJiraIssuePayload,
} = require('../scripts/build-jira-heal-ticket');

describe('buildTicketSummary', () => {
	it('truncates the test name to at most 5 words', () => {
		// Arrange
		const testName = 'clicking the mega menu should open the submenu panel';

		// Act
		const summary = buildTicketSummary(testName);

		// Assert
		expect(summary).toBe(
			'Internal: Fix flaky test - clicking the mega menu should',
		);
	});

	it('does not count separators as words or end on one', () => {
		// Act
		const whole = buildTicketSummary(
			'Default styling - Icon Experiment: active',
		);
		const cut = buildTicketSummary(
			'Search control styling - Icon Experiment: active',
		);

		// Assert
		expect(whole).toBe(
			'Internal: Fix flaky test - Default styling - Icon Experiment: active',
		);
		expect(cut).toBe(
			'Internal: Fix flaky test - Search control styling - Icon Experiment',
		);
	});

	it('keeps short test names intact', () => {
		// Arrange & Act
		const summary = buildTicketSummary('renders correctly');

		// Assert
		expect(summary).toBe('Internal: Fix flaky test - renders correctly');
	});
});

describe('buildJiraIssuePayload', () => {
	it('builds an ED project Task issue with a link to the run', () => {
		// Arrange
		const params = {
			testName: 'renders correctly',
			runUrl: 'https://github.com/elementor/elementor-pro/actions/runs/123',
		};

		// Act
		const payload = buildJiraIssuePayload(params);

		// Assert
		expect(payload.fields.project).toEqual({ key: 'ED' });
		expect(payload.fields.issuetype).toEqual({ name: 'Task' });
		expect(payload.fields.summary).toBe(
			'Internal: Fix flaky test - renders correctly',
		);
		expect(JSON.stringify(payload.fields.description)).toContain(
			params.runUrl,
		);
	});

	it('files the task under the parent epic with the verification run and branch', () => {
		// Arrange
		const params = {
			testName: 'renders correctly',
			runUrl: 'https://github.com/elementor/elementor-pro/actions/runs/123',
			verificationRunUrl:
				'https://github.com/elementor/elementor-pro/actions/runs/456',
			branch: 'heal/renders-correctly-123',
			parentKey: 'ED-22856',
		};

		// Act
		const payload = buildJiraIssuePayload(params);

		// Assert
		const description = JSON.stringify(payload.fields.description);
		expect(payload.fields.parent).toEqual({ key: 'ED-22856' });
		expect(description).toContain(params.verificationRunUrl);
		expect(description).toContain(params.branch);
	});

	it('says so when the failure did not reproduce during verification', () => {
		// Act
		const payload = buildJiraIssuePayload({
			testName: 'renders correctly',
			runUrl: 'https://example.com/run/1',
			reproduced: false,
		});

		// Assert
		const description = JSON.stringify(payload.fields.description);
		expect(description).toContain('did not reproduce');
		expect(description).not.toContain('failed without the change');
	});

	it('omits the parent when no parent key is given', () => {
		// Act
		const payload = buildJiraIssuePayload({
			testName: 'renders correctly',
			runUrl: 'https://example.com/run/1',
		});

		// Assert
		expect(payload.fields).not.toHaveProperty('parent');
	});

	it('honors a custom project key', () => {
		// Arrange & Act
		const payload = buildJiraIssuePayload({
			testName: 'renders correctly',
			runUrl: 'https://example.com/run/1',
			projectKey: 'TEST',
		});

		// Assert
		expect(payload.fields.project).toEqual({ key: 'TEST' });
	});
});

describe('buildHealPrTitle', () => {
	it('matches how this repo titles the same change by hand', () => {
		// Arrange
		const testName = 'Search Result Visibility';

		// Act
		const result = buildHealPrTitle({ testName, jiraKey: 'ED-25619' });

		// Assert
		expect(result).toBe(
			'Internal: Fix flaky test - Search Result Visibility [ED-25619]',
		);
	});

	it("keeps a long Playwright title inside commitlint's 100-character header limit", () => {
		// Arrange
		const testName =
			'Visually verify that the frontend renders identical content and styles before and after detach with a screenshot comparison';

		// Act
		const result = buildHealPrTitle({ testName, jiraKey: 'ED-25619' });

		// Assert
		expect(result.length).toBeLessThanOrEqual(PR_TITLE_MAX_LENGTH);
		expect(result).toContain('[ED-25619]');
	});

	it('still carries the key when the descriptor alone would overflow', () => {
		// Arrange
		const testName = 'Supercalifragilistic '.repeat(20);

		// Act
		const result = buildHealPrTitle({
			testName,
			jiraKey: 'VERYLONGKEY-123456',
		});

		// Assert
		expect(result.length).toBeLessThanOrEqual(PR_TITLE_MAX_LENGTH);
		expect(result.endsWith('[VERYLONGKEY-123456]')).toBe(true);
	});

	it('omits the suffix when no key is available', () => {
		expect(
			buildHealPrTitle({ testName: 'Some flaky thing', jiraKey: '' }),
		).toBe('Internal: Fix flaky test - Some flaky thing');
	});
});
