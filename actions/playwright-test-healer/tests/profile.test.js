const { SUPPORTED_PRODUCTS, loadProfile } = require('../scripts/profile');

describe('loadProfile', () => {
	it.each(SUPPORTED_PRODUCTS)('loads the %s profile', (product) => {
		// Act
		const profile = loadProfile(product);

		// Assert
		expect(profile.product).toBe(product);
		expect(profile.evidenceWorkflows.length).toBeGreaterThan(0);
		expect(profile.agent).toEqual({
			evidence: expect.any(String),
			localRun: expect.any(String),
			baselineDrift: expect.any(String),
		});
	});

	it('reads the product from HEALER_PRODUCT by default', () => {
		// Act
		const profile = loadProfile();

		// Assert
		expect(profile.product).toBe(process.env.HEALER_PRODUCT);
	});

	it('refuses an unknown product rather than healing with the wrong shards', () => {
		// Act & Assert
		expect(() => loadProfile('hello')).toThrow(
			'HEALER_PRODUCT must be one of core, pro, got "hello".',
		);
		expect(() => loadProfile('')).toThrow('HEALER_PRODUCT must be one of');
	});
});
