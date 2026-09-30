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
		pattern: /^tests\/playwright\/blueprints\//,
		reason: 'WordPress Playground blueprint',
	},
	{
		pattern:
			/^tests\/playwright\/(?:.*\/)?\.(?:[^/]*wp-lite-env|wp-env[^/]*)\.json$/,
		reason: 'WordPress environment config',
	},
];
const DIFF_FILE_HEADER = /^(?:\+\+\+|---) (?:[ab]\/|\/dev\/null)/;
const ASSERTION = /\bexpect\s*\(/g;
const WEAKENING_PATTERNS = [
	{
		pattern:
			/\b(?:test|it)(?:\.describe)?\.(?:skip|fixme|fail|only|slow)\b/,
		reason: 'skips, marks, or narrows tests',
	},
	{
		pattern: /\b(?:describeIf|testIf)\s*\(/,
		reason: 'adds a conditional skip',
	},
	{
		pattern: /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)\s*\)/,
		reason: 'swallows a failure',
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

		if (SNAPSHOT_FILE.test(file)) {
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

function parseDiffLines(diff) {
	const added = [];
	const removed = [];

	for (const line of String(diff || '').split('\n')) {
		if (DIFF_FILE_HEADER.test(line)) {
			continue;
		}

		if (line.startsWith('+')) {
			added.push(line.slice(1));
		} else if (line.startsWith('-')) {
			removed.push(line.slice(1));
		}
	}

	return { added, removed };
}

function countAssertions(lines) {
	return lines.reduce(
		(total, line) => total + (line.match(ASSERTION) || []).length,
		0,
	);
}

function findWeakening(diff) {
	const { added, removed } = parseDiffLines(diff);
	const findings = [];

	for (const line of added) {
		const hit = WEAKENING_PATTERNS.find(({ pattern }) =>
			pattern.test(line),
		);

		if (hit) {
			findings.push(`${hit.reason}: ${line.trim()}`);
		}
	}

	const lostAssertions = countAssertions(removed) - countAssertions(added);

	if (lostAssertions > 0) {
		findings.push(`removes ${lostAssertions} expect() assertion(s)`);
	}

	return findings;
}

function git(args) {
	return execFileSync('git', args, {
		encoding: 'utf8',
		maxBuffer: MAX_DIFF_BYTES,
	});
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
		...findWeakening(
			git([
				'diff',
				'--no-renames',
				'--unified=0',
				range,
				'--',
				ALLOWED_PREFIX,
			]),
		),
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

module.exports = { findScopeViolations, findWeakening };
