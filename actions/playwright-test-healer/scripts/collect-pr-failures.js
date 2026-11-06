'use strict';

/**
 * Lists every hard failure of a pull request's Playwright run, each with the
 * evidence the rest of the PR healer needs: the shard it ran in, its
 * `test-results/` directories, the spec named in its error context, and the
 * error itself.
 *
 * Unlike the nightly ranking, no failure is dropped here: every failed test
 * gets a verdict, including those with no artifact to read.
 */

const fs = require('fs');
const path = require('path');

const { DEFAULT_HARD_FAILURES_PATH } = require('./collect-log-hard-failures');
const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');
const {
	flattenAllureFailures,
	matchResultDirectories,
	readHardFailureSource,
	readResultDirs,
	shardIndexForMatchedDirs,
} = require('./rank-nightly-failures');
const { isHealableShard } = require('./resolve-shard-command');
const { parseErrorContext } = require('./triage-pr-failures');

const MAX_ERROR_TEXT_LENGTH = 4000;

function findErrorContext(dirPath) {
	const direct = path.join(dirPath, 'error-context.md');

	if (fs.existsSync(direct)) {
		return direct;
	}

	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const nested = path.join(dirPath, entry.name, 'error-context.md');
		if (entry.isDirectory() && fs.existsSync(nested)) {
			return nested;
		}
	}

	return '';
}

function readErrorContext(resultsRoot, matchedDirs) {
	for (const dir of matchedDirs) {
		const file = findErrorContext(
			path.join(resultsRoot, dir.artifactName, dir.dirName),
		);

		if (file) {
			return parseErrorContext(fs.readFileSync(file, 'utf8'));
		}
	}

	return { specFile: '', errorText: '' };
}

/**
 * @param {Object}   options
 * @param {string[]} options.testNames   Hard-failure titles.
 * @param {Object[]} options.resultDirs  From readResultDirs.
 * @param {string}   options.resultsRoot Where the shard artifacts were downloaded.
 * @param {Object}   [options.profile]
 * @return {Object[]} One record per failed test.
 */
function collectPrFailures({
	testNames,
	resultDirs,
	resultsRoot,
	profile = loadProfile(),
}) {
	return [...new Set(testNames)].map((testName) => {
		const matched = matchResultDirectories(testName, resultDirs);
		const shardIndex = shardIndexForMatchedDirs(matched, profile);
		const context = readErrorContext(resultsRoot, matched);

		return {
			testName,
			shardIndex,
			rerunnable: isHealableShard(shardIndex, profile),
			matchedDirs: matched.map((dir) => dir.dirName),
			artifactNames: [...new Set(matched.map((dir) => dir.artifactName))],
			hasTrace: matched.some((dir) => dir.hasTrace),
			specFile: context.specFile,
			errorText: context.errorText.slice(0, MAX_ERROR_TEXT_LENGTH),
		};
	});
}

function main() {
	const resultsRoot = process.env.TEST_RESULTS_ROOT || 'test-results';
	const outputPath = process.env.PR_FAILURES_PATH || 'pr-failures.json';
	const source = readHardFailureSource(
		process.env.ALLURE_SUITES_PATH || 'allure-report/data/suites.json',
		process.env.HARD_FAILURES_PATH || DEFAULT_HARD_FAILURES_PATH,
	);
	const testNames = source.hardFailureNames
		? source.hardFailureNames
		: flattenAllureFailures(source.allureSuitesJson).map(
				(test) => test.name,
			);

	const failures = collectPrFailures({
		testNames,
		resultDirs: readResultDirs(resultsRoot),
		resultsRoot,
	});

	fs.writeFileSync(outputPath, JSON.stringify(failures, null, 2));
	console.log(
		`${failures.length} hard failure(s): ${failures.map((failure) => failure.testName).join(', ') || '(none)'}`,
	);
	setOutput('failure_count', String(failures.length));
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { collectPrFailures };
