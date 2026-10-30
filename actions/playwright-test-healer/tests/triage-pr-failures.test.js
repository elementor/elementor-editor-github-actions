const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadProfile } = require('../scripts/profile');
const {
	extractErrorTokens,
	findSpecFiles,
	importClosure,
	parseErrorContext,
	parsePatch,
	pickReruns,
	readImports,
	specCoversModule,
	triagePrFailures,
} = require('../scripts/triage-pr-failures');

function makeRepo(files) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-test-'));

	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	}

	return dir;
}

const SPEC = 'tests/playwright/sanity/modules/forms/forms.test.ts';
const OTHER_SPEC = 'tests/playwright/sanity/modules/popup/popup.test.ts';

function repoWithSpecs() {
	return makeRepo({
		[SPEC]: [
			"import { test } from '../../../parallelTest';",
			"import EditorPage from '../../../pages/editor-page';",
			"test.describe( 'Forms', () => {",
			"\ttest( 'Submit button is visible', async () => {} );",
			'} );',
		].join('\n'),
		[OTHER_SPEC]: [
			"import { test } from '../../../parallelTest';",
			"test( 'Popup opens on click', async () => {} );",
		].join('\n'),
		'tests/playwright/parallelTest.ts': "export * from './fixtures';",
		'tests/playwright/fixtures.ts': 'export const test = {};',
		'tests/playwright/pages/editor-page.ts':
			"import BasePage from './base-page';\nexport default class EditorPage {}",
		'tests/playwright/pages/base-page.ts':
			'export default class BasePage {}',
	});
}

function failure(overrides = {}) {
	return {
		testName: 'Submit button is visible',
		shardIndex: '3',
		rerunnable: true,
		matchedDirs: ['forms-Forms-Submit-button-is-visible'],
		artifactNames: ['playwright-test-results-3'],
		hasTrace: true,
		specFile: '',
		errorText: '',
		...overrides,
	};
}

describe('parsePatch', () => {
	it('numbers added lines in the new file and removed lines in the old one', () => {
		// Arrange
		const patch = [
			'@@ -10,3 +20,4 @@ class Foo',
			' unchanged',
			'-removed',
			'+added one',
			'+added two',
			' tail',
		].join('\n');

		// Act
		const lines = parsePatch(patch);

		// Assert
		expect(lines).toEqual([
			{ type: '-', line: 11, text: 'removed' },
			{ type: '+', line: 21, text: 'added one' },
			{ type: '+', line: 22, text: 'added two' },
		]);
	});
});

describe('parseErrorContext', () => {
	it('reads the spec from Location and only the error details, not the page snapshot', () => {
		// Arrange
		const markdown = [
			'# Test info',
			'',
			'- Name: Forms >> Submit button is visible',
			`- Location: /home/runner/work/elementor-pro/elementor-pro/${SPEC}:4:6`,
			'',
			'# Error details',
			'',
			'```',
			"Error: locator('.e-form__submit').click: Timeout 10000ms exceeded.",
			'```',
			'',
			'# Page snapshot',
			'',
			'```yaml',
			'- button "Unrelated"',
			'```',
		].join('\n');

		// Act
		const context = parseErrorContext(markdown);

		// Assert
		expect(context.specFile).toBe(SPEC);
		expect(context.errorText).toContain('.e-form__submit');
		expect(context.errorText).not.toContain('Unrelated');
	});
});

describe('extractErrorTokens', () => {
	it('takes classes and ids from selectors, accessible names and texts, and drops generic words', () => {
		// Arrange
		const error = [
			'Locator: locator(\'#elementor-panel .e-form__submit[data-setting="button_text"]\')',
			"waiting for getByRole('button', { name: 'Publish now' })",
			"waiting for getByText('Saved')",
			"waiting for locator('body')",
		].join('\n');

		// Act
		const tokens = extractErrorTokens(error);

		// Assert
		expect(tokens).toEqual(
			expect.arrayContaining([
				'elementor-panel',
				'e-form__submit',
				'button_text',
				'Publish now',
				'Saved',
			]),
		);
		expect(tokens).not.toContain('button');
		expect(tokens).not.toContain('body');
	});
});

describe('readImports and importClosure', () => {
	it('follows relative imports, re-exports and index files, but not packages', () => {
		// Arrange
		const dir = repoWithSpecs();

		// Act
		const closure = importClosure(SPEC, dir);

		// Assert
		expect([...closure].sort()).toEqual([
			'tests/playwright/fixtures.ts',
			'tests/playwright/pages/base-page.ts',
			'tests/playwright/pages/editor-page.ts',
			'tests/playwright/parallelTest.ts',
		]);
		expect(readImports("import x from '@playwright/test';")).toEqual([
			'@playwright/test',
		]);
	});
});

describe('findSpecFiles', () => {
	it('finds the spec that holds the title as a string literal', () => {
		// Arrange
		const dir = repoWithSpecs();

		// Act
		const specs = findSpecFiles({
			testName: 'Popup opens on click',
			repoDir: dir,
		});

		// Assert
		expect(specs).toEqual([OTHER_SPEC]);
	});

	it('breaks a tie between two specs by the result directory name', () => {
		// Arrange
		const dir = makeRepo({
			'tests/playwright/a/alpha.test.ts':
				"test( 'Shared title', () => {} );",
			'tests/playwright/b/beta.test.ts':
				"test( 'Shared title', () => {} );",
		});

		// Act
		const specs = findSpecFiles({
			testName: 'Shared title',
			repoDir: dir,
			matchedDirs: ['beta-Shared-title'],
		});

		// Assert
		expect(specs).toEqual(['tests/playwright/b/beta.test.ts']);
	});
});

describe('specCoversModule', () => {
	it('matches a directory or a file name, not a module whose name only starts the same', () => {
		// Assert
		expect(specCoversModule(SPEC, 'forms')).toBe(true);
		expect(
			specCoversModule(
				'tests/playwright/sanity/loop-builder.test.ts',
				'loop-builder',
			),
		).toBe(true);
		expect(specCoversModule(SPEC, 'form')).toBe(false);
	});
});

describe('triagePrFailures', () => {
	const profile = loadProfile('pro');

	it('links a failure to a PR that changes its spec', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{ filename: SPEC, patch: '@@ -4,1 +4,1 @@\n-old\n+new' },
		];

		// Act
		const [result] = triagePrFailures({
			failures: [failure()],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.linked).toBe(true);
		expect(result.specFiles).toEqual([SPEC]);
		expect(result.reasons[0]).toContain("test's own spec");
		expect(result.evidence[0]).toMatchObject({ file: SPEC, line: 4 });
	});

	it("points the spec evidence at the failing test's own line", () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{
				filename: SPEC,
				patch: [
					'@@ -1,0 +1,4 @@',
					"+import { test } from '../../../parallelTest';",
					'+',
					"+test( 'Submit button is visible', async () => {} );",
					'+',
				].join('\n'),
			},
		];

		// Act
		const [result] = triagePrFailures({
			failures: [failure()],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.evidence[0]).toMatchObject({ file: SPEC, line: 3 });
	});

	it('links a failure to a PR that changes a helper the spec imports indirectly', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{
				filename: 'tests/playwright/pages/base-page.ts',
				patch: '@@ -1,1 +1,2 @@\n context\n+added',
			},
		];

		// Act
		const [result] = triagePrFailures({
			failures: [failure()],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.linked).toBe(true);
		expect(result.reasons[0]).toContain('pages/base-page.ts');
	});

	it('links a failure to a PR that changes the module the spec covers', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{
				filename: 'modules/forms/widgets/form.php',
				patch: '@@ -1 +1 @@\n-a\n+b',
			},
		];

		// Act
		const [result] = triagePrFailures({
			failures: [failure()],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.linked).toBe(true);
		expect(result.reasons[0]).toContain('`forms` module');
	});

	it('links a failure whose selector the PR changes in product code, with the line as evidence', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{
				filename: 'assets/dev/js/frontend/handler.js',
				patch: "@@ -30,1 +30,1 @@\n-const SUBMIT = '.e-form__submit';\n+const SUBMIT = '.e-form__send';",
			},
		];

		// Act
		const [result] = triagePrFailures({
			failures: [
				failure({
					errorText: "waiting for locator('.e-form__submit')",
				}),
			],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.linked).toBe(true);
		expect(result.evidence[0]).toMatchObject({
			file: 'assets/dev/js/frontend/handler.js',
			line: 30,
			side: 'base',
			token: 'e-form__submit',
		});
	});

	it('links every failure to a PR that changes the Playwright config', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [{ filename: 'playwright.config.ts', patch: '' }];

		// Act
		const results = triagePrFailures({
			failures: [
				failure(),
				failure({ testName: 'Popup opens on click', matchedDirs: [] }),
			],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(results.every((result) => result.linked)).toBe(true);
	});

	it('leaves a failure unlinked when the PR touches nothing it depends on', () => {
		// Arrange
		const dir = repoWithSpecs();
		const changedFiles = [
			{
				filename: 'modules/popup/module.php',
				patch: '@@ -1 +1 @@\n-a\n+b',
			},
			{ filename: 'tests/playwright/sanity/other.test.ts', patch: '' },
		];

		// Act
		const [result] = triagePrFailures({
			failures: [failure({ errorText: "locator('.e-form__submit')" })],
			changedFiles,
			repoDir: dir,
			profile,
		});

		// Assert
		expect(result.linked).toBe(false);
		expect(result.reasons).toEqual([]);
	});
});

describe('pickReruns', () => {
	it('re-runs unlinked, re-runnable failures up to the limit and names the rest', () => {
		// Arrange
		const triage = [
			{ ...failure({ testName: 'A' }), linked: false },
			{ ...failure({ testName: 'B' }), linked: true },
			{ ...failure({ testName: 'C', rerunnable: false }), linked: false },
			{ ...failure({ testName: 'D' }), linked: false },
			{ ...failure({ testName: 'E' }), linked: false },
		].map((item) => ({ ...item, specFiles: [SPEC] }));

		// Act
		const { reruns, overLimit } = pickReruns(triage, 2);

		// Assert
		expect(reruns.map((test) => test.testName)).toEqual(['A', 'D']);
		expect(reruns[0]).toEqual({
			testName: 'A',
			shardIndex: '3',
			specFiles: [SPEC],
			matchedDirs: 'forms-Forms-Submit-button-is-visible',
		});
		expect(overLimit).toEqual(['E']);
	});
});
