'use strict';

/**
 * Finds CI evidence (a `test-results/` directory with `error-context.md`
 * and ideally `trace.zip`) for one test named by a human.
 *
 * This is the manual counterpart to `rank-nightly-failures.js`: instead of
 * picking a candidate out of last night's report, the caller says which test
 * to heal and this locates a real failure artifact to investigate from. With
 * no run id it walks recent runs newest-first, so "heal this flaky test"
 * works without hunting for a run id by hand.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { gh } = require('./gh');
const { loadProfile } = require('./profile');
const { matchResultDirectories } = require('./rank-nightly-failures');
const {
	isHealableShard,
	shardIndexFromArtifactName,
} = require('./resolve-shard-command');

const SHARD_ARTIFACT_PREFIX = 'playwright-test-results-';
const MAX_RUNS_TO_SCAN = 15;
const RUNS_TO_LIST_PER_WORKFLOW = 100;

function isShardArtifact(artifact) {
	return Boolean(
		artifact &&
			!artifact.expired &&
			typeof artifact.name === 'string' &&
			artifact.name.startsWith(SHARD_ARTIFACT_PREFIX),
	);
}

/**
 * Trace-backed evidence beats log-only evidence, because the healer skill
 * can replay a trace but can only read an `error-context.md`.
 */
function pickBestEvidence(candidates) {
	const usable = (candidates || []).filter(
		(candidate) => candidate && candidate.matchedDirs.length > 0,
	);

	if (usable.length === 0) {
		return null;
	}

	const sorted = [...usable].sort((a, b) => {
		if (a.hasTrace !== b.hasTrace) {
			return a.hasTrace ? -1 : 1;
		}
		return String(a.shardIndex).localeCompare(String(b.shardIndex));
	});

	return sorted[0];
}

/**
 * Groups already-discovered result directories by the shard artifact they
 * came from, so the shard index travels with the evidence. Verification
 * needs it to re-run the test the way that shard ran it.
 */
function buildEvidenceCandidates(testName, resultDirs) {
	const byArtifact = new Map();

	for (const dir of resultDirs || []) {
		const artifactName = dir.artifactName || '';
		if (!byArtifact.has(artifactName)) {
			byArtifact.set(artifactName, []);
		}
		byArtifact.get(artifactName).push(dir);
	}

	const candidates = [];

	for (const [artifactName, dirs] of byArtifact) {
		const matched = matchResultDirectories(testName, dirs);

		if (matched.length === 0) {
			continue;
		}

		candidates.push({
			artifactName,
			shardIndex: shardIndexFromArtifactName(artifactName),
			matchedDirs: matched.map((dir) => dir.dirName),
			hasTrace: matched.some((dir) => dir.hasTrace),
		});
	}

	return candidates;
}

function findEvidenceInResultDirs(testName, resultDirs) {
	return pickBestEvidence(buildEvidenceCandidates(testName, resultDirs));
}

/**
 * A product that uploads results from every shard, failed or not, has more
 * shard artifacts than are worth downloading. Failing shards carry traces
 * and screenshots, so the largest are tried first.
 */
function pickShardArtifacts(artifacts, profile = loadProfile()) {
	return (artifacts || [])
		.filter(isShardArtifact)
		.filter((artifact) =>
			isHealableShard(
				shardIndexFromArtifactName(artifact.name, profile),
				profile,
			),
		)
		.sort((a, b) => (b.size_in_bytes || 0) - (a.size_in_bytes || 0))
		.slice(0, profile.maxShardArtifactsPerRun);
}

function listShardArtifacts(repo, runId, profile) {
	const output = gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/artifacts`,
		'--paginate',
	]);
	return pickShardArtifacts(JSON.parse(output).artifacts, profile);
}

/**
 * The runs API's `event` filter serves a stale index — it has returned only
 * weeks-old scheduled runs while newer ones existed — so runs are listed
 * unfiltered and narrowed to the profile's evidence events here.
 */
function pickEvidenceRuns(runs, profile = loadProfile()) {
	const events = profile.evidenceEvents;
	const matching = (runs || []).filter(
		(run) => 0 === events.length || events.includes(run.event),
	);

	return newestMainFirst(matching.slice(0, MAX_RUNS_TO_SCAN));
}

function newestMainFirst(runs) {
	return [
		...runs.filter((run) => 'main' === run.headBranch),
		...runs.filter((run) => 'main' !== run.headBranch),
	];
}

function listRecentRunIds(repo, profile) {
	const runIds = [];

	for (const workflow of profile.evidenceWorkflows) {
		let runs = [];
		try {
			const output = gh([
				'run',
				'list',
				'--repo',
				repo,
				'--workflow',
				workflow,
				'--status',
				'completed',
				'--limit',
				String(RUNS_TO_LIST_PER_WORKFLOW),
				'--json',
				'databaseId,headBranch,createdAt,event',
			]);
			runs = JSON.parse(output);
		} catch {
			continue;
		}

		runIds.push(
			...pickEvidenceRuns(runs, profile).map((run) => run.databaseId),
		);
	}

	return runIds;
}

/**
 * Reads one shard artifact's directory names without keeping the download:
 * only the layout matters here, and trace zips are large.
 */
function readArtifactResultDirs(repo, runId, artifactName) {
	const downloadDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'heal-evidence-'),
	);

	try {
		execFileSync(
			'gh',
			[
				'run',
				'download',
				String(runId),
				'--repo',
				repo,
				'-n',
				artifactName,
				'-D',
				downloadDir,
			],
			{ stdio: 'inherit' },
		);
	} catch {
		fs.rmSync(downloadDir, { recursive: true, force: true });
		return [];
	}

	try {
		return fs
			.readdirSync(downloadDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => ({
				dirName: entry.name,
				artifactName,
				hasTrace: hasTraceInDirectory(
					path.join(downloadDir, entry.name),
				),
			}));
	} finally {
		fs.rmSync(downloadDir, { recursive: true, force: true });
	}
}

/**
 * Playwright nests retries as `<dir>/retry1/trace.zip`, so a top-level-only
 * check under-reports trace evidence.
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

function findEvidenceInRun(repo, runId, testName, profile) {
	const artifacts = listShardArtifacts(repo, runId, profile);

	if (0 === artifacts.length) {
		return null;
	}

	const resultDirs = [];

	for (const artifact of artifacts) {
		resultDirs.push(...readArtifactResultDirs(repo, runId, artifact.name));
	}

	const evidence = findEvidenceInResultDirs(testName, resultDirs);

	return evidence ? { ...evidence, sourceRunId: String(runId) } : null;
}

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) {
		console.log(`${name}=${value}`);
		return;
	}
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const testName = process.env.HEAL_TEST_NAME;
	const requestedRunId = (process.env.SOURCE_RUN_ID || '').trim();

	if (!repo || !testName) {
		throw new Error('GITHUB_REPOSITORY and HEAL_TEST_NAME are required.');
	}

	const profile = loadProfile();
	const runIds = requestedRunId
		? [requestedRunId]
		: listRecentRunIds(repo, profile);
	let evidence = null;

	for (const runId of runIds) {
		console.log(`Looking for "${testName}" evidence in run ${runId}`);
		evidence = findEvidenceInRun(repo, runId, testName, profile);

		if (evidence) {
			break;
		}
	}

	if (!evidence) {
		const scope = requestedRunId
			? `run ${requestedRunId}`
			: `the last ${MAX_RUNS_TO_SCAN} completed runs`;
		console.log(
			`::warning::No failure artifact for "${testName}" in ${scope}.`,
		);
		setOutput('found', 'false');
		return;
	}

	console.log(
		`Found evidence in run ${evidence.sourceRunId}, shard ${evidence.shardIndex || '(default)'}: ` +
			`${evidence.matchedDirs.join(', ')}${evidence.hasTrace ? ' (trace available)' : ' (log only)'}`,
	);

	setOutput('found', 'true');
	setOutput('source_run_id', evidence.sourceRunId);
	setOutput('shard_index', evidence.shardIndex);
	setOutput('matched_dirs', evidence.matchedDirs.join(','));
	setOutput('has_trace', String(evidence.hasTrace));
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
	SHARD_ARTIFACT_PREFIX,
	buildEvidenceCandidates,
	findEvidenceInResultDirs,
	isShardArtifact,
	newestMainFirst,
	pickBestEvidence,
	pickEvidenceRuns,
	pickShardArtifacts,
};
