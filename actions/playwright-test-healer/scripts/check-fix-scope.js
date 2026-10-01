'use strict';

/**
 * The gate the agent's branch must pass before anything from it executes.
 *
 * The skill tells the agent to change only test code, never snapshots, and
 * never what a test asserts. A prompt is not a boundary, and a fix that skips,
 * retries, or loosens the test would verify green while fixing nothing.
 */

const { execFileSync } = require('child_process');

const MAX_DIFF_BYTES = 64 * 1024 * 1024;
const ALLOWED_PREFIX = 'tests/playwright/';
const SNAPSHOT_FILE = /\.(?:png|jpe?g|webp)$/i;
const RUNNER_FILE =
	/^tests\/playwright\/(?:[^/]*\.config|global-(?:setup|teardown))\.[cm]?[jt]s$/;
const FORBIDDEN_PATHS = [
	{
		pattern: /^tests\/playwright\/mu-plugins\//,
		reason: 'environment or WordPress plugin code',
	},
	{
		pattern: /(?:^|\/)\.gitattributes$/,
		reason: 'git attributes, which can hide changes from this check',
	},
	{
		pattern: /^tests\/playwright\/blueprints\//,
		reason: 'WordPress Playground blueprint',
	},
	{
		pattern:
			/^tests\/playwright\/(?:.*\/)?\.(?:[^/]*wp-lite-env|wp-env[^/]*)\.json$/,
		reason: 'WordPress environment config',
	},
];
const SNAPSHOT_DIR = /(?:-snapshots|__snapshots__)\//i;
const ARIA_SNAPSHOT = /\.aria\.ya?ml$/i;
const DIFF_FILE_HEADER = /^(?:\+\+\+|---) (?:[ab]\/|\/dev\/null)/;
const NEW_FILE_HEADER = /^\+\+\+ b\/(.+)$/;
const ASSERTION = /\bexpect(?:\.poll)?\s*(?:\(|$)/g;
const AWAITED_ASSERTION = /\bawait\s+expect\b/g;
const LINE_COMMENT = /(^|[^:])\/\/.*$/;
const BLOCK_COMMENT_LINE = /^\s*(?:\/\*|\*)/;
const SKIP_MARKS = '(?:skip|fixme|fail|only|slow)';
const SWALLOWED_VALUE =
	'(?:\\{\\s*\\}|undefined|null|true|false|0|\'\'|""|\\[\\s*\\])';

/**
 * Regexes over a diff narrow what a fix can get away with; they cannot prove
 * a test still checks what it did. Verification and review cover the rest.
 */
const WEAKENING_PATTERNS = [
	{
		pattern: new RegExp(
			`\\b(?:test|it|testInfo|test\\.info\\(\\))(?:\\.(?:describe|step)(?:\\.serial|\\.parallel)?)?\\.${SKIP_MARKS}\\b`,
		),
		reason: 'skips, marks, or narrows tests',
	},
	{
		pattern: new RegExp(
			`\\b(?:test|it|testInfo)\\s*\\[\\s*['"\`]${SKIP_MARKS}['"\`]\\s*\\]`,
		),
		reason: 'skips, marks, or narrows tests',
	},
	{
		pattern: new RegExp(
			`\\{[^}]*\\b${SKIP_MARKS}\\b[^}]*\\}\\s*=\\s*(?:test|testInfo)\\b`,
		),
		reason: 'skips, marks, or narrows tests',
	},
	{
		pattern: /=\s*test\s*;?\s*$/,
		reason: 'aliases test, which hides later skips from this check',
	},
	{
		pattern: /\b(?:describeIf|testIf)\s*\(/,
		reason: 'adds a conditional skip',
	},
	{
		pattern: /\bprocess\.env\.\w+.*\)\s*\{?\s*return\b/,
		reason: 'returns early on an environment condition',
	},
	{
		pattern: new RegExp(
			`\\.catch\\(\\s*(?:async\\s*)?(?:\\(\\s*[\\w$]*\\s*\\)|[\\w$]+)\\s*=>\\s*${SWALLOWED_VALUE}\\s*\\)`,
		),
		reason: 'swallows a failure',
	},
	{
		pattern: /\bcatch\s*(?:\(\s*[\w$]*\s*\))?\s*\{\s*\}/,
		reason: 'swallows a failure',
	},
	{
		pattern: /\.setTimeout\s*\(\s*0\s*\)/,
		reason: 'removes the test timeout',
	},
	{ pattern: /\bretries\s*:/, reason: 'adds retries' },
	{ pattern: /\bexpect\.soft\b/, reason: 'turns an assertion soft' },
	{
		pattern: /\b(?:maxDiffPixels|maxDiffPixelRatio|threshold)\s*:/,
		reason: 'loosens a screenshot comparison',
	},
];

function findScopeViolations(files) {
	return (files || []).flatMap((file) => {
		if (!file.startsWith(ALLOWED_PREFIX)) {
			return [`${file}: outside ${ALLOWED_PREFIX}`];
		}

		if (
			[SNAPSHOT_FILE, SNAPSHOT_DIR, ARIA_SNAPSHOT].some((pattern) =>
				pattern.test(file),
			)
		) {
			return [`${file}: snapshot baseline`];
		}

		if (RUNNER_FILE.test(file)) {
			return [`${file}: Playwright config or global setup`];
		}

		const forbidden = FORBIDDEN_PATHS.find(({ pattern }) =>
			pattern.test(file),
		);

		return forbidden ? [`${file}: ${forbidden.reason}`] : [];
	});
}

/**
 * Groups changed lines by file, so an assertion removed from the failing
 * test cannot be balanced by a trivial one added somewhere else.
 */
function parseDiffFiles(diff) {
	const files = new Map();
	let current = { added: [], removed: [] };
	files.set('', current);

	for (const line of String(diff || '').split('\n')) {
		const header = NEW_FILE_HEADER.exec(line);

		if (header) {
			current = files.get(header[1]) || { added: [], removed: [] };
			files.set(header[1], current);
			continue;
		}

		if (DIFF_FILE_HEADER.test(line)) {
			continue;
		}

		if (line.startsWith('+')) {
			current.added.push(line.slice(1));
		} else if (line.startsWith('-')) {
			current.removed.push(line.slice(1));
		}
	}

	return files;
}

function withoutComment(line) {
	return BLOCK_COMMENT_LINE.test(line)
		? ''
		: line.replace(LINE_COMMENT, '$1');
}

function count(lines, pattern) {
	return lines.reduce(
		(total, line) =>
			total + (withoutComment(line).match(pattern) || []).length,
		0,
	);
}

function findWeakening(diff) {
	const findings = [];

	for (const [file, { added, removed }] of parseDiffFiles(diff)) {
		for (const line of added) {
			const hit = WEAKENING_PATTERNS.find(({ pattern }) =>
				pattern.test(withoutComment(line)),
			);

			if (hit) {
				findings.push(`${hit.reason}: ${line.trim()}`);
			}
		}

		const where = file ? ` in ${file}` : '';
		const lostAssertions =
			count(removed, ASSERTION) - count(added, ASSERTION);

		if (lostAssertions > 0) {
			findings.push(
				`removes ${lostAssertions} expect() assertion(s)${where}`,
			);
		}

		const lostAwaits =
			count(removed, AWAITED_ASSERTION) - count(added, AWAITED_ASSERTION);

		if (lostAwaits > 0 && lostAssertions <= 0) {
			findings.push(
				`drops await from ${lostAwaits} expect() assertion(s)${where}, so they no longer wait or fail the test`,
			);
		}
	}

	return findings;
}

function git(args, cwd) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: MAX_DIFF_BYTES,
	});
}

/**
 * The branch's own .gitattributes could mark specs `-diff` or give them a
 * textconv driver, turning every changed line into "Binary files differ";
 * the forced flags keep the real lines in the diff.
 */
function diffTestCode(range, cwd) {
	return git(
		[
			'diff',
			'--no-renames',
			'--unified=0',
			'--text',
			'--no-textconv',
			'--no-ext-diff',
			range,
			'--',
			ALLOWED_PREFIX,
		],
		cwd,
	);
}

function main() {
	const baseRef = process.env.BASE_REF;

	if (!baseRef) {
		throw new Error('BASE_REF is required.');
	}

	const range = `origin/${baseRef}...HEAD`;
	const files = git(['diff', '--no-renames', '--name-only', range])
		.split('\n')
		.filter(Boolean);

	if (!files.length) {
		throw new Error(
			`The agent's branch has no changes against ${baseRef}.`,
		);
	}

	console.log(
		`Changed files:\n${files.map((file) => `  ${file}`).join('\n')}`,
	);

	const problems = [
		...findScopeViolations(files),
		...findWeakening(diffTestCode(range)),
	];

	if (problems.length) {
		console.log(
			`Out of scope:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
		);
		throw new Error(
			`The fix is out of scope in ${problems.length} way(s); the log lists them.`,
		);
	}
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { diffTestCode, findScopeViolations, findWeakening };
