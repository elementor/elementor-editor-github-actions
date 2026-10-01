const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	diffTestCode,
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

	it('rejects mu-plugins as environment or WordPress plugin code', () => {
		expect(
			findScopeViolations(['tests/playwright/mu-plugins/healer.php']),
		).toEqual([
			'tests/playwright/mu-plugins/healer.php: environment or WordPress plugin code',
		]);
	});

	it('rejects Playground blueprints', () => {
		expect(
			findScopeViolations(['tests/playwright/blueprints/local.json']),
		).toEqual([
			'tests/playwright/blueprints/local.json: WordPress Playground blueprint',
		]);
	});

	it('rejects wp-lite-env and wp-env config at any depth', () => {
		// Arrange
		const files = [
			'tests/playwright/.playwright-wp-lite-env.json',
			'tests/playwright/upgrade-test/.upgrade-test-wp-lite-env.json',
			'tests/playwright/upgrade-test/.wp-env.json',
			'tests/playwright/.wp-env.override.json',
		];

		// Act
		const violations = findScopeViolations(files);

		// Assert
		expect(violations).toEqual(
			files.map((file) => `${file}: WordPress environment config`),
		);
	});

	it('still accepts helper and spec edits next to the environment files', () => {
		expect(
			findScopeViolations([
				'tests/playwright/pages/wp-admin-page.ts',
				'tests/playwright/pages/blueprints-helper.ts',
				'tests/playwright/sanity/modules/search/search.test.ts',
			]),
		).toEqual([]);
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

	it('flags an added describeIf or testIf as a conditional skip', () => {
		// Arrange
		const change = diff([
			"+describeIf( isCore335OrHigher, 'Search widget', () => {",
			"+\ttestIf( shouldRun, 'renders', async () => {",
		]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toEqual([
			"adds a conditional skip: describeIf( isCore335OrHigher, 'Search widget', () => {",
			"adds a conditional skip: testIf( shouldRun, 'renders', async () => {",
		]);
	});

	it('flags an empty catch as swallowing a failure', () => {
		// Arrange
		const change = diff([
			'+\tawait expect( el ).toBeVisible().catch( () => {} );',
			'+\tawait page.click( a ).catch(() => undefined);',
			'+\tawait page.click( b ).catch( () => null );',
		]);

		// Act
		const findings = findWeakening(change);

		// Assert
		expect(findings).toHaveLength(3);
		expect(
			findings.every((finding) =>
				finding.startsWith('swallows a failure:'),
			),
		).toBe(true);
	});

	it('does not flag a catch that handles the error', () => {
		// Arrange
		const change = diff([
			'+\tawait page.click( a ).catch( ( error ) => { throw error; } );',
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([]);
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

describe('git attributes', () => {
	let repo;
	const run = (...args) =>
		execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
	const write = (file, content) => {
		const target = path.join(repo, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	};

	beforeEach(() => {
		repo = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-scope-'));
		run('init', '-q', '-b', 'main');
		run('config', 'user.email', 'healer@example.com');
		run('config', 'user.name', 'Healer');
		write(
			'tests/playwright/sanity/a.test.ts',
			"test('a', async () => {\n\tawait expect(page).toHaveTitle('A');\n});\n",
		);
		run('add', '.');
		run('commit', '-q', '-m', 'base');
		run('checkout', '-q', '-b', 'fix');
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	it('rejects a .gitattributes under tests/playwright', () => {
		// Act
		const violations = findScopeViolations([
			'tests/playwright/.gitattributes',
			'tests/playwright/sanity/.gitattributes',
		]);

		// Assert
		expect(violations).toEqual([
			'tests/playwright/.gitattributes: git attributes, which can hide changes from this check',
			'tests/playwright/sanity/.gitattributes: git attributes, which can hide changes from this check',
		]);
	});

	it('still sees a skip and a removed assertion when the branch marks specs -diff', () => {
		// Arrange
		write('tests/playwright/.gitattributes', '*.ts -diff\n');
		write(
			'tests/playwright/sanity/a.test.ts',
			"test.skip('a', async () => {\n});\n",
		);
		run('add', '.');
		run('commit', '-q', '-m', 'fix');

		// Act
		const findings = findWeakening(diffTestCode('main...HEAD', repo));

		// Assert
		expect(findings).toEqual([
			"skips, marks, or narrows tests: test.skip('a', async () => {",
			'removes 1 expect() assertion(s)',
		]);
	});
});
