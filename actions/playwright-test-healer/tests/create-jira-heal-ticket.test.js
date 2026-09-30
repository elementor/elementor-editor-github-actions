const {
	buildBasicAuthHeader,
	formatHttpError,
	normalizeBaseUrl,
	previewBody,
	readHttpBody,
	resolveJiraSiteUrl,
} = require('../scripts/create-jira-heal-ticket');

describe('previewBody', () => {
	it('collapses whitespace and truncates long Atlassian text bodies', () => {
		// Arrange
		const raw =
			'Client must be authenticated to access this resource.\n'.repeat(
				20,
			);

		// Act
		const result = previewBody(raw);

		// Assert
		expect(result.startsWith('Client must be authenticated')).toBe(true);
		expect(result.length).toBeLessThanOrEqual(300);
	});
});

describe('formatHttpError', () => {
	it('includes the HTTP status and a preview of a non-JSON body', () => {
		// Arrange
		const response = { status: 401 };
		const raw = 'Client must be authenticated to access this resource.';

		// Act
		const result = formatHttpError('Jira ticket creation', response, raw);

		// Assert
		expect(result).toBe(
			'Jira ticket creation failed: HTTP 401: Client must be authenticated to access this resource.',
		);
	});
});

describe('readHttpBody', () => {
	it('returns parsed JSON when the body is JSON', async () => {
		// Arrange
		const response = {
			text: async () => '{"key":"ED-1"}',
		};

		// Act
		const result = await readHttpBody(response);

		// Assert
		expect(result.json).toEqual({ key: 'ED-1' });
		expect(result.raw).toContain('ED-1');
	});

	it('returns a null json field when the body is plain text', async () => {
		// Arrange
		const response = {
			text: async () =>
				'Client must be authenticated to access this resource.',
		};

		// Act
		const result = await readHttpBody(response);

		// Assert
		expect(result.json).toBeNull();
		expect(result.raw).toContain('Client must be authenticated');
	});
});

describe('normalizeBaseUrl', () => {
	it('strips trailing slashes and lowercases the host URL', () => {
		// Arrange & Act
		const result = normalizeBaseUrl('https://Elementor.atlassian.net/');

		// Assert
		expect(result).toBe('https://elementor.atlassian.net');
	});
});

describe('resolveJiraSiteUrl', () => {
	it('uses the same Elementor Jira host as get-jira-release-url.sh by default', () => {
		// Arrange & Act
		const result = resolveJiraSiteUrl(undefined);

		// Assert
		expect(result).toBe('https://elementor.atlassian.net');
	});

	it('honors an explicit JIRA_SITE_URL override', () => {
		// Arrange & Act
		const result = resolveJiraSiteUrl('https://example.atlassian.net/');

		// Assert
		expect(result).toBe('https://example.atlassian.net');
	});
});

describe('buildBasicAuthHeader', () => {
	it('encodes email and API token as a Basic Authorization header', () => {
		// Arrange & Act
		const result = buildBasicAuthHeader('bot@example.com', 'token-value');

		// Assert
		expect(result).toBe(
			`Basic ${Buffer.from('bot@example.com:token-value').toString('base64')}`,
		);
	});
});
