'use strict';

/**
 * Decides, before anything is re-run, which of a pull request's Playwright
 * failures the pull request itself is linked to.
 *
 * A linked failure gets the verdict "broken by this PR" and is never re-run or
 * fixed: a pass on a re-run would only make a real regression look flaky, and
 * a "fix" to the test would hide it. So the signals here are the ones that tie
 * a failure to the diff with evidence a reviewer can check:
 *
 *  - the PR changes the test's own spec file, or its snapshot baselines;
 *  - the PR changes a file the spec imports, however indirectly;
 *  - the PR changes the Playwright config or setup every test runs under;
 *  - the PR changes the product module the spec covers;
 *  - a selector or text from the failure's error appears in a changed line of
 *    product code.
 *
 * Everything else is re-run.
 */

const fs = require('fs');
const path = require('path');

const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');

const TEST_ROOT = 'tests/playwright';
const SPEC_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_IMPORT_CLOSURE = 500;
const MAX_EVIDENCE_PER_FAILURE = 5;
const MAX_EVIDENCE_LINE_LENGTH = 160;
const MIN_TOKEN_LENGTH = 4;

/**
 * Files every test runs under. A change to one of them can break any test,
 * so it links every failure to the PR.
 */
const GLOBAL_TEST_FILES = [
	/^playwright\.config\.[cm]?[jt]s$/,
	/^tests\/playwright\/playwright\.config\.[cm]?[jt]s$/,
	/^tests\/playwright\/[^/]*global[-_.]?(?:setup|teardown)[^/]*$/i,
	/^tests\/playwright\/config\//,
	/^\.wp-env\.json$/,
	/^tests\/playwright\/\.playwright-wp-lite-env\.json$/,
];

/**
 * Changed lines in these files say nothing about the product's behaviour, so
 * an error token found there is not evidence.
 */
const NON_PRODUCT_FILES = [
	/^tests\//,
	/(?:^|\/)__tests__\//,
	/\.(?:test|spec)\.[cm]?[jt]sx?$/,
	/(?:^|\/)package-lock\.json$/,
	/(?:^|\/)composer\.lock$/,
	/^(?:changelog|readme)\.(?:txt|md)$/i,
	/\.md$/i,
	/^\.github\//,
];

/**
 * Selector fragments and texts too generic to tie a failure to a change.
 */
const STOP_TOKENS = new Set(
	[
		'body',
		'html',
		'button',
		'link',
		'heading',
		'textbox',
		'checkbox',
		'option',
		'combobox',
		'dialog',
		'menuitem',
		'listitem',
		'iframe',
		'elementor',
		'elementor-pro',
		'preview',
		'editor',
		'panel',
		'first',
		'last',
		'true',
		'false',
		'null',
		'undefined',
		'visible',
		'hidden',
		'none',
	].map((token) => token.toLowerCase()),
);

const LOCATOR_CALL =
	/\b(?:locator|frameLocator|getByText|getByLabel|getByPlaceholder|getByTitle|getByTestId|getByAltText)\(\s*(['"`])((?:\\.|(?!\1).)+)\1/g;
const ROLE_NAME = /\bname:\s*(['"`])((?:\\.|(?!\1).)+)\1/g;
const CSS_CLASS = /\.(-?[A-Za-z_][\w-]*)/g;
const CSS_ID = /#([A-Za-z_][\w-]*)/g;
const CSS_ATTRIBUTE = /\[([\w-]+)(?:[*^$|~]?=\s*["']?([^"'\]]+)["']?)?\]/g;

function normalizePath(file) {
	return String(file || '')
		.replace(/\\/g, '/')
		.replace(/^\.\//, '');
}

function isSpecFile(file) {
	return SPEC_FILE.test(file);
}

function isGlobalTestFile(file) {
	return GLOBAL_TEST_FILES.some((pattern) => pattern.test(file));
}

function isProductFile(file) {
	return !NON_PRODUCT_FILES.some((pattern) => pattern.test(file));
}

/**
 * The +/- lines of a unified diff, numbered in the file they belong to: added
 * lines in the new file, removed lines in the old one.
 */
function parsePatch(patch) {
	const lines = [];
	let oldLine = 0;
	let newLine = 0;

	for (const raw of String(patch || '').split('\n')) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);

		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			continue;
		}

		if (raw.startsWith('+')) {
			lines.push({ type: '+', line: newLine, text: raw.slice(1) });
			newLine++;
		} else if (raw.startsWith('-')) {
			lines.push({ type: '-', line: oldLine, text: raw.slice(1) });
			oldLine++;
		} else if (!raw.startsWith('\\')) {
			oldLine++;
			newLine++;
		}
	}

	return lines;
}

/**
 * Every path the PR touches, renames under both names: a test importing the
 * old name of a moved helper is as linked as one importing the new name.
 */
function changedPaths(changedFiles) {
	const paths = new Set();

	for (const file of changedFiles || []) {
		paths.add(normalizePath(file.filename));
		if (file.previous_filename) {
			paths.add(normalizePath(file.previous_filename));
		}
	}

	return paths;
}

/**
 * error-context.md starts with `# Test info`, whose `- Location:` line names
 * the spec, and has the failure itself under `# Error details`. The page
 * snapshot after it is the whole DOM: matching tokens there would link every
 * failure to every change.
 */
function parseErrorContext(markdown) {
	const text = String(markdown || '');
	const location = /^-\s*Location:\s*(.+?):\d+:\d+\s*$/m.exec(text);
	const details = /^#\s*Error details\s*$([\s\S]*?)(?=^#\s|(?![\s\S]))/m.exec(
		text,
	);

	let specFile = '';
	if (location) {
		const file = normalizePath(location[1]);
		const index = file.indexOf(`${TEST_ROOT}/`);
		specFile = index >= 0 ? file.slice(index) : '';
	}

	return {
		specFile,
		errorText: details ? details[1].trim() : '',
	};
}

/**
 * Strings a failure's error names the page by: locator arguments, accessible
 * names, and the classes, ids and attributes inside CSS selectors.
 */
function extractErrorTokens(errorText) {
	const text = String(errorText || '');
	const tokens = new Set();

	const addToken = (token) => {
		const value = String(token || '').trim();
		if (
			value.length >= MIN_TOKEN_LENGTH &&
			!STOP_TOKENS.has(value.toLowerCase())
		) {
			tokens.add(value);
		}
	};

	const addSelector = (selector) => {
		for (const match of selector.matchAll(CSS_CLASS)) {
			addToken(match[1]);
		}
		for (const match of selector.matchAll(CSS_ID)) {
			addToken(match[1]);
		}
		for (const match of selector.matchAll(CSS_ATTRIBUTE)) {
			if (match[2]) {
				addToken(match[2]);
			} else {
				addToken(match[1]);
			}
		}
	};

	for (const match of text.matchAll(LOCATOR_CALL)) {
		const value = match[2];
		if (/^\s*(?:[.#[]|[a-z-]+[.#[])/i.test(value)) {
			addSelector(value);
		} else {
			addToken(value);
		}
	}

	for (const match of text.matchAll(ROLE_NAME)) {
		addToken(match[2]);
	}

	return [...tokens];
}

function listSpecFiles(repoDir, dir = TEST_ROOT, files = []) {
	const absolute = path.join(repoDir, dir);

	if (!fs.existsSync(absolute)) {
		return files;
	}

	for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
		const relative = `${dir}/${entry.name}`;

		if (entry.isDirectory()) {
			if ('node_modules' !== entry.name) {
				listSpecFiles(repoDir, relative, files);
			}
		} else if (isSpecFile(entry.name)) {
			files.push(relative);
		}
	}

	return files;
}

function slugify(text) {
	return String(text || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * The spec that declares a test title. error-context.md names it when there
 * is one; otherwise it is the spec holding the title as a string literal.
 * Two specs can hold the same title, and Playwright names a result directory
 * after its spec file first, so that breaks the tie.
 */
function findSpecFiles({ testName, repoDir, matchedDirs = [], specs }) {
	const quoted = ["'", '"', '`'].map(
		(quote) => `${quote}${testName}${quote}`,
	);
	const candidates = (specs || listSpecFiles(repoDir)).filter((file) => {
		const source = fs.readFileSync(path.join(repoDir, file), 'utf8');
		return quoted.some((literal) => source.includes(literal));
	});

	if (candidates.length <= 1) {
		return candidates;
	}

	const dirSlugs = matchedDirs.map(slugify);
	const byDir = candidates.filter((file) => {
		const base = slugify(path.basename(file).replace(SPEC_FILE, ''));
		return dirSlugs.some((dir) => dir.startsWith(`${base}-`));
	});

	return byDir.length ? byDir : candidates;
}

const IMPORT_SPECIFIER =
	/(?:\bimport\s+(?:[^'"`]*?\s+from\s+)?|\bexport\s+[^'"`]*?\s+from\s+|\bimport\(\s*|\brequire\(\s*)(['"])([^'"]+)\1/g;

function readImports(source) {
	return [...String(source || '').matchAll(IMPORT_SPECIFIER)].map(
		(match) => match[2],
	);
}

function resolveImport(fromFile, specifier, repoDir) {
	if (!specifier.startsWith('.')) {
		return '';
	}

	const base = normalizePath(
		path.posix.join(path.posix.dirname(fromFile), specifier),
	);
	const candidates = [
		base,
		...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
		...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
	];

	return (
		candidates.find((candidate) => {
			const absolute = path.join(repoDir, candidate);
			return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
		}) || ''
	);
}

/**
 * Every repository file a spec reaches through relative imports. Path aliases
 * and packages are left out: they point outside the test tree.
 */
function importClosure(specFile, repoDir) {
	const seen = new Set([specFile]);
	const queue = [specFile];

	while (queue.length && seen.size < MAX_IMPORT_CLOSURE) {
		const file = queue.shift();
		const absolute = path.join(repoDir, file);

		if (!fs.existsSync(absolute)) {
			continue;
		}

		for (const specifier of readImports(
			fs.readFileSync(absolute, 'utf8'),
		)) {
			const resolved = resolveImport(file, specifier, repoDir);
			if (resolved && !seen.has(resolved)) {
				seen.add(resolved);
				queue.push(resolved);
			}
		}
	}

	seen.delete(specFile);
	return seen;
}

function moduleOf(file, moduleRoots) {
	for (const root of moduleRoots || []) {
		if (file.startsWith(`${root}/`)) {
			const name = file.slice(root.length + 1).split('/')[0];
			if (name && !name.includes('.')) {
				return name;
			}
		}
	}
	return '';
}

/**
 * A spec covers a module when a directory on its path, or its own file name,
 * carries the module's name: `tests/playwright/sanity/modules/forms/…` and
 * `tests/playwright/sanity/forms.test.ts` both cover `modules/forms`.
 */
function specCoversModule(specFile, moduleName) {
	const parts = specFile.split('/');
	const fileName = parts.pop().replace(SPEC_FILE, '');
	return (
		parts.includes(moduleName) ||
		fileName === moduleName ||
		fileName.startsWith(`${moduleName}-`) ||
		fileName.startsWith(`${moduleName}.`)
	);
}

function trimLine(text) {
	const line = String(text || '').trim();
	return line.length > MAX_EVIDENCE_LINE_LENGTH
		? `${line.slice(0, MAX_EVIDENCE_LINE_LENGTH - 1)}…`
		: line;
}

function findTokenEvidence(tokens, changedFiles) {
	const evidence = [];

	if (!tokens.length) {
		return evidence;
	}

	for (const file of changedFiles || []) {
		const filename = normalizePath(file.filename);

		if (!isProductFile(filename)) {
			continue;
		}

		for (const line of parsePatch(file.patch)) {
			const token = tokens.find((candidate) =>
				line.text.includes(candidate),
			);

			if (token) {
				evidence.push({
					file: filename,
					line: line.line,
					side: '+' === line.type ? 'head' : 'base',
					text: trimLine(`${line.type}${line.text}`),
					token,
				});
			}

			if (evidence.length >= MAX_EVIDENCE_PER_FAILURE) {
				return evidence;
			}
		}
	}

	return evidence;
}

/**
 * The changed line to show as evidence: the first one holding `preferText`
 * (in a spec, the failing test's own title), otherwise the first change.
 */
function changedLineEvidence(changedFile, preferText = '') {
	const lines = parsePatch(changedFile && changedFile.patch);
	const line =
		(preferText && lines.find((item) => item.text.includes(preferText))) ||
		lines[0];
	return line
		? {
				line: line.line,
				side: '+' === line.type ? 'head' : 'base',
				text: trimLine(`${line.type}${line.text}`),
			}
		: { line: 0, side: 'head', text: '' };
}

function fileEvidence(filename, changedFiles, preferText = '') {
	const changed = (changedFiles || []).find(
		(file) =>
			normalizePath(file.filename) === filename ||
			normalizePath(file.previous_filename) === filename,
	);
	return { file: filename, ...changedLineEvidence(changed, preferText) };
}

/**
 * One failure's link to the PR, if any. The signals are checked strongest
 * first and every one that fires is reported, so the reason names the most
 * direct cause and the evidence shows the rest.
 */
function triageFailure({
	failure,
	specFiles,
	closures,
	changedFiles,
	changed,
	profile,
}) {
	const reasons = [];
	const evidence = [];

	const changedSpecs = specFiles.filter((file) => changed.has(file));
	for (const file of changedSpecs) {
		reasons.push(`The PR changes the test's own spec, \`${file}\`.`);
		evidence.push(fileEvidence(file, changedFiles, failure.testName));
	}

	for (const file of specFiles) {
		const snapshots = [...changed].filter((changedFile) =>
			changedFile.startsWith(`${file}-snapshots/`),
		);
		if (snapshots.length) {
			reasons.push(
				`The PR changes the test's snapshot baselines, \`${snapshots[0]}\`${snapshots.length > 1 ? ` and ${snapshots.length - 1} more` : ''}.`,
			);
			evidence.push({
				file: snapshots[0],
				line: 0,
				side: 'head',
				text: '',
			});
		}
	}

	const importedChanges = new Set();
	for (const file of specFiles) {
		for (const imported of closures.get(file) || []) {
			if (changed.has(imported)) {
				importedChanges.add(imported);
			}
		}
	}
	if (importedChanges.size) {
		const [first, ...rest] = [...importedChanges];
		reasons.push(
			`The PR changes \`${first}\`${rest.length ? ` and ${rest.length} more file(s)` : ''}, which the test imports.`,
		);
		evidence.push(fileEvidence(first, changedFiles));
	}

	const globalChanges = [...changed].filter(isGlobalTestFile);
	if (globalChanges.length) {
		reasons.push(
			`The PR changes \`${globalChanges[0]}\`, which every Playwright test runs under.`,
		);
		evidence.push(fileEvidence(globalChanges[0], changedFiles));
	}

	const modules = new Map();
	for (const file of changed) {
		const name = moduleOf(file, profile.moduleRoots);
		if (name && !modules.has(name)) {
			modules.set(name, file);
		}
	}
	for (const [name, file] of modules) {
		if (specFiles.some((spec) => specCoversModule(spec, name))) {
			reasons.push(
				`The PR changes the \`${name}\` module (\`${file}\`), which this test covers.`,
			);
			evidence.push(fileEvidence(file, changedFiles));
			break;
		}
	}

	const tokenEvidence = findTokenEvidence(
		extractErrorTokens(failure.errorText),
		changedFiles,
	);
	if (tokenEvidence.length) {
		const first = tokenEvidence[0];
		reasons.push(
			`The failure is on \`${first.token}\`, which the PR changes in \`${first.file}\`.`,
		);
		evidence.push(...tokenEvidence);
	}

	return {
		linked: reasons.length > 0,
		reasons,
		evidence: evidence.slice(0, MAX_EVIDENCE_PER_FAILURE),
	};
}

/**
 * @param {Object}   options
 * @param {Object[]} options.failures     From collect-pr-failures.js.
 * @param {Object[]} options.changedFiles The PR's files, as the REST API lists them.
 * @param {string}   options.repoDir      A checkout of the PR head.
 * @param {Object}   [options.profile]
 * @return {Object[]} Each failure with its spec files and link to the PR.
 */
function triagePrFailures({
	failures,
	changedFiles,
	repoDir,
	profile = loadProfile(),
}) {
	const changed = changedPaths(changedFiles);
	const specs = listSpecFiles(repoDir);
	const closures = new Map();

	return (failures || []).map((failure) => {
		const specFiles = failure.specFile
			? [failure.specFile]
			: findSpecFiles({
					testName: failure.testName,
					repoDir,
					matchedDirs: failure.matchedDirs,
					specs,
				});

		for (const file of specFiles) {
			if (!closures.has(file)) {
				closures.set(file, importClosure(file, repoDir));
			}
		}

		return {
			...failure,
			specFiles,
			...triageFailure({
				failure,
				specFiles,
				closures,
				changedFiles,
				changed,
				profile,
			}),
		};
	});
}

/**
 * The failures to re-run, in the shape the re-run and fix jobs take. Past the
 * limit the rest are named, not re-run: dozens of failures at once usually
 * share one cause, and re-running each three times would take hours.
 */
function pickReruns(triage, maxReruns) {
	const eligible = (triage || []).filter(
		(failure) => !failure.linked && failure.rerunnable,
	);

	return {
		reruns: eligible.slice(0, maxReruns).map((failure) => ({
			testName: failure.testName,
			shardIndex: failure.shardIndex,
			specFiles: failure.specFiles,
			matchedDirs: failure.matchedDirs.join(','),
		})),
		overLimit: eligible.slice(maxReruns).map((failure) => failure.testName),
	};
}

function main() {
	const failuresPath = process.env.PR_FAILURES_PATH || 'pr-failures.json';
	const filesPath = process.env.PR_FILES_PATH || 'pr-files.json';
	const outputPath = process.env.PR_TRIAGE_PATH || 'pr-triage.json';
	const repoDir = process.env.PR_CHECKOUT_DIR || '.';

	const triage = triagePrFailures({
		failures: JSON.parse(fs.readFileSync(failuresPath, 'utf8')),
		changedFiles: JSON.parse(fs.readFileSync(filesPath, 'utf8')),
		repoDir,
	});

	fs.writeFileSync(outputPath, JSON.stringify(triage, null, 2));

	for (const failure of triage) {
		console.log(
			`${failure.linked ? 'LINKED  ' : 'RE-RUN  '} ${failure.testName}${failure.reasons.length ? ` — ${failure.reasons[0]}` : ''}`,
		);
	}

	const { reruns, overLimit } = pickReruns(
		triage,
		Number(process.env.MAX_RERUNS) || 0,
	);
	setOutput('rerun_tests', JSON.stringify(reruns));
	setOutput('over_limit', JSON.stringify(overLimit));
	setOutput('has_reruns', String(reruns.length > 0));
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	extractErrorTokens,
	findSpecFiles,
	importClosure,
	isGlobalTestFile,
	isProductFile,
	parseErrorContext,
	parsePatch,
	pickReruns,
	readImports,
	specCoversModule,
	triagePrFailures,
};
