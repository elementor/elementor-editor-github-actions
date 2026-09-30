const {
	findScopeViolations,
	findWeakening,
} = require('../scripts/check-fix-scope');

function diff(lines) {
	return [
		'--- a/tests/playwright/sanity/a.test.ts',
		'+++ b/tests/playwright/sanity/a.test.ts',
		'@@ -1 +1 @@',
		...lines,
	].join('\n');
}

describe('findScopeViolations', () => {
	it('accepts test code under tests/playwright', () => {
		expect(
			findScopeViolations([
				'tests/playwright/sanity/a.test.ts',
				'tests/playwright/pages/editor-page.ts',
			]),
		).toEqual([]);
	});

	it('rejects files outside tests/playwright, snapshots, and runner files', () => {
		// Arrange
		const files = [
			'.github/workflows/x.yml',
			'tests/playwright/sanity/a.test.ts-snapshots/a-linux.png',
			'tests/playwright/playwright.config.ts',
			'tests/playwright/global-setup.ts',
		];

		// Act
		const violations = findScopeViolations(files);

		// Assert
		expect(violations).toEqual([
			'.github/workflows/x.yml: outside tests/playwright/',
			'tests/playwright/sanity/a.test.ts-snapshots/a-linux.png: snapshot baseline',
			'tests/playwright/playwright.config.ts: Playwright config or global setup',
			'tests/playwright/global-setup.ts: Playwright config or global setup',
		]);
	});
});

describe('findWeakening', () => {
	it('accepts a wait added before an unchanged assertion', () => {
		// Arrange
		const change = diff([
			"+\tawait page.locator( '.e-loop-item' ).first().waitFor( { timeout: timeouts.longAction } );",
		]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toEqual([]);
	});

	it('accepts an assertion rewritten in place', () => {
		// Arrange
		const change = diff([
			"-\texpect( await page.screenshot() ).toMatchSnapshot( 'a.png' );",
			"+\tawait expect( page.locator( '#a' ) ).toHaveScreenshot( 'a.png' );",
		]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toEqual([]);
	});

	it('flags skips, retries, soft assertions, and looser screenshots', () => {
		// Arrange
		const change = diff([
			"+\ttest.skip( isCI, 'flaky' );",
			'+test.describe.configure( { retries: 2 } );',
			'+\texpect.soft( value ).toBe( 1 );',
			"+\tawait expect( el ).toHaveScreenshot( 'a.png', { maxDiffPixels: 500 } );",
		]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toHaveLength(4);
	});

	it('flags a removed assertion', () => {
		// Arrange
		const change = diff(["-\texpect( title ).toBe( 'Home' );"]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toEqual(['removes 1 expect() assertion(s)']);
	});
});
