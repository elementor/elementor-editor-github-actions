const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	diffTestCode,
	findDeletions,
	findScopeViolations,
	findWeakening,
	listDeletedFiles,
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
		expect(findings).toEqual([
			'removes 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts',
		]);
	});
});

describe('findWeakening, harder cases', () => {
	it.each([
		"+\ttest['skip']( true, 'flaky' );",
		'+\tconst { skip } = test;',
		'+\tconst t = test;',
		"+\ttestInfo.skip( isCI, 'flaky' );",
		'+\ttest.info().fixme();',
		"+\ttest.step.skip( 'opens', async () => {} );",
		"+test.describe.serial.only( 'Panel', () => {",
		'+\tif ( process.env.CI ) return;',
		'+\tawait el.click().catch( async () => {} );',
		'+\tawait el.click().catch( () => false );',
		'+\tawait el.click().catch( ( e ) => true );',
		'+\ttry { await expect( el ).toBeVisible(); } catch {}',
		'+\ttest.setTimeout( 0 );',
	])('flags %s', (line) => {
		// Act
		const findings = findWeakening(diff([line]));

		// Assert
		expect(findings).toHaveLength(1);
	});

	it('counts expect.poll as an assertion, so a race rewrite passes', () => {
		// Arrange
		const change = diff([
			'-\tawait expect( widget ).toHaveCSS( "background-color", red );',
			'+\tawait expect.poll( () => getBackground( widget ) ).toBe( red );',
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([]);
	});

	it('counts an assertion split across lines as one', () => {
		// Arrange
		const change = diff([
			'-\tawait expect( widget ).toHaveCSS( "background-color", red );',
			'+\tawait expect',
			'+\t\t.poll( () => getBackground( widget ) )',
			'+\t\t.toBe( red );',
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([]);
	});

	it('does not let a commented-out expect balance a removed one', () => {
		// Arrange
		const change = diff([
			"-\tawait expect( title ).toHaveText( 'Saved' );",
			"+\t// await expect( title ).toHaveText( 'Saved' );",
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([
			'removes 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts',
		]);
	});

	it('flags an await dropped from an assertion', () => {
		// Arrange
		const change = diff([
			"-\tawait expect( title ).toHaveText( 'Saved' );",
			"+\texpect( title ).toHaveText( 'Saved' );",
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([
			'drops await from 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts, so they no longer wait or fail the test',
		]);
	});

	it('counts assertions per file, so a dummy one elsewhere does not balance', () => {
		// Arrange
		const change = [
			'--- a/tests/playwright/sanity/a.test.ts',
			'+++ b/tests/playwright/sanity/a.test.ts',
			'@@ -1 +1 @@',
			"-\tawait expect( title ).toHaveText( 'Saved' );",
			'--- a/tests/playwright/sanity/b.test.ts',
			'+++ b/tests/playwright/sanity/b.test.ts',
			'@@ -1 +1 @@',
			'+\texpect( true ).toBe( true );',
		].join('\n');

		// Act & Assert
		expect(findWeakening(change)).toEqual([
			'removes 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts',
		]);
	});

	it('does not flag a catch that waits for an optional popup and rethrows the rest', () => {
		// Arrange
		const change = diff([
			"+\tawait page.locator( '#popup' ).waitFor( { timeout: 2000 } ).catch( ( error ) => { if ( ! isTimeout( error ) ) { throw error; } } );",
		]);

		// Act & Assert
		expect(findWeakening(change)).toEqual([]);
	});
});

describe('findScopeViolations, snapshots', () => {
	it('rejects any baseline under a snapshots directory and aria snapshots', () => {
		// Act
		const violations = findScopeViolations([
			'tests/playwright/sanity/a.test.ts-snapshots/a-linux.txt',
			'tests/playwright/sanity/__snapshots__/a.json',
			'tests/playwright/sanity/panel.aria.yml',
		]);

		// Assert
		expect(violations).toEqual([
			'tests/playwright/sanity/a.test.ts-snapshots/a-linux.txt: snapshot baseline',
			'tests/playwright/sanity/__snapshots__/a.json: snapshot baseline',
			'tests/playwright/sanity/panel.aria.yml: snapshot baseline',
		]);
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

	it('rejects a spec deleted and its title re-added asserting nothing', () => {
		// Arrange
		run('rm', '-q', 'tests/playwright/sanity/a.test.ts');
		write(
			'tests/playwright/sanity/b.test.ts',
			"test('a', async () => {\n\texpect(1).toBe(1);\n});\n",
		);
		run('add', '.');
		run('commit', '-q', '-m', 'fix');

		// Act
		const problems = [
			...findDeletions(listDeletedFiles('main...HEAD', repo)),
			...findWeakening(diffTestCode('main...HEAD', repo)),
		];

		// Assert
		expect(problems).toEqual([
			'tests/playwright/sanity/a.test.ts: deleted or renamed',
			'removes 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts',
		]);
	});

	it('rejects a renamed spec as the deletion of its old path', () => {
		// Arrange
		run(
			'mv',
			'tests/playwright/sanity/a.test.ts',
			'tests/playwright/sanity/c.test.ts',
		);
		run('commit', '-q', '-m', 'fix');

		// Act & Assert
		expect(findDeletions(listDeletedFiles('main...HEAD', repo))).toEqual([
			'tests/playwright/sanity/a.test.ts: deleted or renamed',
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
			'removes 1 expect() assertion(s) in tests/playwright/sanity/a.test.ts',
		]);
	});
});
