'use strict';

const fs = require('fs');
const path = require('path');

const { DEFAULT_HARD_FAILURES_PATH } = require('./collect-log-hard-failures');
const { setOutput } = require('./github-output');
const { findSkipReason, readSkipSources } = require('./healer-skips');
const { loadProfile } = require('./profile');
const {
	isHealableShard,
	shardIndexFromArtifactName,
} = require('./resolve-shard-command');

const MIN_CONFIDENCE_SCORE = 1;
const TRACE_EVIDENCE_SCORE = 2;
const LOG_ONLY_EVIDENCE_SCORE = 1;
const MIN_TRUNCATED_TAIL_LENGTH = 10;
const RETRY_SUFFIX = /-retry\d+$/;
const PROJECT_SUFFIX = /-(?:chromium|firefox|webkit)$/;
const TRUNCATION_HASH = /-[0-9a-f]{5}-/g;

/**
 * Lowercases and hyphenates a string the same way Playwright slugs test
 * titles into `test-results/` directory names, so the two can be compared.
 */
function slugify(text) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Allure TimeoutErrors are often `broken`, not `failed`. Suites.json also
 * nests describes arbitrarily deep. Walk every node and keep leaf tests
 * whose final status is failed or broken (retries exhausted). Flakes stay
 * `passed` with retriesCount > 0 and are ignored.
 */
function isAllureTestNode(node) {
	if (!node || typeof node.status !== 'string') {
		return false;
	}

	return !Array.isArray(node.children) || node.children.length === 0;
}

function isHardFailureStatus(status) {
	return status === 'failed' || status === 'broken';
}

function collectAllureFailures(node, failures) {
	if (!node) {
		return;
	}

	if (isAllureTestNode(node)) {
		if (isHardFailureStatus(node.status)) {
			failures.push(node);
		}
		return;
	}

	if (!Array.isArray(node.children)) {
		return;
	}

	for (const child of node.children) {
		collectAllureFailures(child, failures);
	}
}

function flattenAllureFailures(allureSuitesJson) {
	const failures = [];
	collectAllureFailures(allureSuitesJson, failures);
	return failures;
}

function endsWithWord(text, suffix) {
	return text === suffix || text.endsWith(`-${suffix}`);
}

/**
 * Playwright names a result dir `{spec}-{describe}-{title}`, then
 * `-{project}` and `-retry{n}`. A long name keeps only its start and end
 * around a 5-character hash, so the end can begin mid-word. Matching is
 * anchored to the end of the title: a plain substring would let `Heading 1`
 * claim `Heading 10`'s directory.
 */
function directoryMatchesTestName(dirName, testName) {
	const testSlug = slugify(testName);

	if (!dirName || !testSlug) {
		return false;
	}

	const titles = [testSlug];
	if (testSlug.startsWith('test-') && testSlug.length > 'test-'.length) {
		titles.push(testSlug.slice('test-'.length));
	}

	const base = dirName.replace(RETRY_SUFFIX, '').replace(PROJECT_SUFFIX, '');
	const baseSlug = slugify(base);

	if (titles.some((title) => endsWithWord(baseSlug, title))) {
		return true;
	}

	for (const match of base.matchAll(TRUNCATION_HASH)) {
		const tail = slugify(base.slice(match.index + match[0].length));

		if (
			tail.length >= MIN_TRUNCATED_TAIL_LENGTH &&
			titles.some((title) => title.endsWith(tail))
		) {
			return true;
		}
	}

	return false;
}

function matchResultDirectories(testName, resultDirs) {
	if (!slugify(testName)) {
		return [];
	}

	return resultDirs.filter((dir) =>
		directoryMatchesTestName(dir.dirName, testName),
	);
}

/**
 * Playwright nests retries as `<dir>/retry1/trace.zip`, so a top-level-only
 * check under-reports trace evidence and mis-ranks candidates.
 */
function hasTraceInDirectory(dirPath) {
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		if (entry.isFile() && 'trace.zip' === entry.name) {
			return true;
		}
		if (
			entry.isDirectory() &&
			hasTraceInDirectory(path.join(dirPath, entry.name))
		) {
			return true;
		}
	}

	return false;
}

/**
 * Reads a `test-results/<shard-artifact>/<test-dir>` tree into the shape
 * `selectHealCandidate` expects. The artifact name is kept because it is the
 * only record of which shard failed, and verification needs that to re-run
 * the test the same way the nightly did.
 */
function readResultDirs(root) {
	if (!fs.existsSync(root)) {
		return [];
	}

	const resultDirs = [];

	for (const artifactName of fs.readdirSync(root)) {
		const artifactPath = path.join(root, artifactName);

		if (!fs.statSync(artifactPath).isDirectory()) {
			continue;
		}

		for (const dirName of fs.readdirSync(artifactPath)) {
			const dirPath = path.join(artifactPath, dirName);

			if (!fs.statSync(dirPath).isDirectory()) {
				continue;
			}

			resultDirs.push({
				dirName,
				artifactName,
				hasTrace: hasTraceInDirectory(dirPath),
			});
		}
	}

	return resultDirs;
}

/**
 * The shard the evidence came from, preferring a trace-backed directory so
 * the reported shard matches the evidence the agent will actually read.
 */
function shardIndexForMatchedDirs(matchedDirs, profile = loadProfile()) {
	const preferred = matchedDirs.find((dir) => dir.hasTrace) || matchedDirs[0];
	return preferred
		? shardIndexFromArtifactName(preferred.artifactName, profile)
		: '';
}

function findCandidateSkip(candidate, skipSources, profile) {
	if (!isHealableShard(candidate.shardIndex, profile)) {
		return { reason: 'unhealable-shard', shardIndex: candidate.shardIndex };
	}

	return skipSources ? findSkipReason(candidate.testName, skipSources) : null;
}

function scoreCandidate(matchedDirs) {
	const hasTrace = matchedDirs.some((dir) => dir.hasTrace);
	return hasTrace ? TRACE_EVIDENCE_SCORE : LOG_ONLY_EVIDENCE_SCORE;
}

/**
 * Picks exactly one nightly hard-failure to hand to the healer agent.
 *
 * Eligibility floor: a hard failure with zero matching result directories
 * is never selected — there is no log/trace evidence to investigate from,
 * so fabricating a fix would be a guess, not a fix.
 *
 * A test with an open PR or a recent verdict is passed over for the next one,
 * so one unhealable test cannot hold the top of the list every night.
 */
function selectHealCandidate({
	allureSuitesJson,
	hardFailureNames,
	resultDirs,
	skipSources,
	profile = loadProfile(),
}) {
	const hardFailures = hardFailureNames
		? hardFailureNames.map((name) => ({ name }))
		: flattenAllureFailures(allureSuitesJson);

	if (hardFailures.length === 0) {
		return {
			candidate: null,
			reason: 'no-hard-failures',
			rankedFailures: [],
			skippedCandidates: [],
		};
	}

	const rankedFailures = hardFailures.map((test) => test.name);

	const eligible = hardFailures
		.map((test) => {
			const matchedDirs = matchResultDirectories(test.name, resultDirs);
			return {
				testName: test.name,
				matchedDirs: matchedDirs.map((dir) => dir.dirName),
				shardIndex: shardIndexForMatchedDirs(matchedDirs, profile),
				hasTrace: matchedDirs.some((dir) => dir.hasTrace),
				score: scoreCandidate(matchedDirs),
				hasEvidence: matchedDirs.length > 0,
			};
		})
		.filter(
			(candidate) =>
				candidate.hasEvidence &&
				candidate.score >= MIN_CONFIDENCE_SCORE,
		);

	if (eligible.length === 0) {
		return {
			candidate: null,
			reason: 'no-artifact-evidence',
			rankedFailures,
			skippedCandidates: [],
		};
	}

	eligible.sort(
		(a, b) => b.score - a.score || a.testName.localeCompare(b.testName),
	);

	const skippedCandidates = [];
	const candidate = eligible.find((test) => {
		const skip = findCandidateSkip(test, skipSources, profile);

		if (skip) {
			skippedCandidates.push({ testName: test.testName, ...skip });
		}

		return !skip;
	});

	if (!candidate) {
		return {
			candidate: null,
			reason: 'all-candidates-skipped',
			rankedFailures,
			skippedCandidates,
		};
	}

	return { candidate, reason: null, rankedFailures, skippedCandidates };
}

const DEFAULT_ALLURE_SUITES_PATH = 'allure-report/data/suites.json';
const DEFAULT_TEST_RESULTS_ROOT = 'test-results';

/**
 * The Allure report is preferred while it exists. Past its 1-day retention the
 * job-log list stands in, which is what makes an older run rankable.
 */
function readHardFailureSource(suitesPath, hardFailuresPath) {
	if (fs.existsSync(suitesPath)) {
		console.log(`Ranking from the Allure report at ${suitesPath}`);
		return {
			allureSuitesJson: JSON.parse(fs.readFileSync(suitesPath, 'utf8')),
		};
	}

	if (fs.existsSync(hardFailuresPath)) {
		console.log(
			`No Allure report; ranking from job logs at ${hardFailuresPath}`,
		);
		return {
			hardFailureNames: JSON.parse(
				fs.readFileSync(hardFailuresPath, 'utf8'),
			),
		};
	}

	throw new Error(
		`Neither an Allure report (${suitesPath}) nor a job-log failure list (${hardFailuresPath}) exists.`,
	);
}

/**
 * `--has-eligible` answers only whether any failure has evidence, ignoring
 * skips. It lets the workflow resolve the evidence builds — which skips need —
 * only on a night there is something to heal.
 */
function main(args) {
	const suitesPath =
		process.env.ALLURE_SUITES_PATH || DEFAULT_ALLURE_SUITES_PATH;
	const hardFailuresPath =
		process.env.HARD_FAILURES_PATH || DEFAULT_HARD_FAILURES_PATH;
	const resultsRoot =
		process.env.TEST_RESULTS_ROOT || DEFAULT_TEST_RESULTS_ROOT;

	const source = readHardFailureSource(suitesPath, hardFailuresPath);
	const resultDirs = readResultDirs(resultsRoot);

	if (args.includes('--has-eligible')) {
		const { candidate } = selectHealCandidate({ ...source, resultDirs });
		setOutput('has_eligible', String(Boolean(candidate)));
		return;
	}

	const skipSources = {
		...readSkipSources(
			process.env.HEALER_OPEN_PRS_PATH,
			process.env.HEALER_ATTEMPTS_PATH,
		),
		baseRef: process.env.HEALER_BASE_REF || '',
	};
	const result = selectHealCandidate({ ...source, resultDirs, skipSources });

	console.log(JSON.stringify(result, null, 2));

	setOutput('skipped_candidates', JSON.stringify(result.skippedCandidates));

	if (!result.candidate) {
		setOutput('has_candidate', 'false');
		setOutput('reason', result.reason);
		setOutput('ranked_failures', JSON.stringify(result.rankedFailures));
		return;
	}

	setOutput('has_candidate', 'true');
	setOutput('test_name', result.candidate.testName);
	setOutput('shard_index', result.candidate.shardIndex);
	setOutput('matched_dirs', result.candidate.matchedDirs.join(','));
	setOutput('has_trace', String(result.candidate.hasTrace));
}

if (require.main === module) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = {
	slugify,
	flattenAllureFailures,
	matchResultDirectories,
	readResultDirs,
	selectHealCandidate,
	shardIndexForMatchedDirs,
};
