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

const { isHealableBase } = require('./evidence-run');
const { gh } = require('./gh');
const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');
const {
	hasTraceInDirectory,
	matchResultDirectories,
} = require('./rank-nightly-failures');
const {
	isHealableShard,
	shardIndexFromArtifactName,
} = require('./resolve-shard-command');

const SHARD_ARTIFACT_PREFIX = 'playwright-test-results-';
const MAX_RUNS_TO_SCAN = 15;
const RUNS_TO_LIST_PER_WORKFLOW = 100;
const MAX_RUN_PAGES = 10;
const RUN_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * 
 * When choosing between evidence from different attempts, prefer:
 * 1. Evidence with traces over log-only evidence
 * 2. Evidence from later attempts (more recent failures)
 * 3. Earlier shard indices (arbitrary tiebreaker)
 */
function pickBestEvidence(candidates) {
	const usable = (candidates || []).filter(
		(candidate) => candidate && candidate.matchedDirs.length > 0,
	);

	if (usable.length === 0) {
		return null;
	}

	const sorted = [...usable].sort((a, b) => {
		// Prefer trace-backed evidence
		if (a.hasTrace !== b.hasTrace) {
			return a.hasTrace ? -1 : 1;
		}
		// Prefer later attempts (more recent)
		const attemptA = a.attempt || 1;
		const attemptB = b.attempt || 1;
		if (attemptA !== attemptB) {
			return attemptB - attemptA;
		}
		// Tiebreaker: shard index
		return String(a.shardIndex).localeCompare(String(b.shardIndex));
	});

	return sorted[0];
}

/**
 * Groups already-discovered result directories by the shard artifact they
 * came from, so the shard index travels with the evidence. Verification
 * needs it to re-run the test the way that shard ran it.
 * 
 * When a run has been re-run, directories from different attempts of the
 * same artifact name are kept separate, annotated with their attempt number.
 */
function buildEvidenceCandidates(testName, resultDirs) {
	// Key by artifact name + attempt to keep attempts separate
	const byArtifactAndAttempt = new Map();

	for (const dir of resultDirs || []) {
		const artifactName = dir.artifactName || '';
		const attempt = dir.attempt || 1;
		const key = `${artifactName}::attempt-${attempt}`;
		
		if (!byArtifactAndAttempt.has(key)) {
			byArtifactAndAttempt.set(key, {
				artifactName,
				attempt,
				dirs: [],
			});
		}
		byArtifactAndAttempt.get(key).dirs.push(dir);
	}

	const candidates = [];

	for (const { artifactName, attempt, dirs } of byArtifactAndAttempt.values()) {
		const matched = matchResultDirectories(testName, dirs);

		if (matched.length === 0) {
			continue;
		}

		candidates.push({
			artifactName,
			attempt,
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
	const { listArtifactsAcrossAttempts } = require('./run-attempts');
	const artifacts = listArtifactsAcrossAttempts(repo, runId);
	return pickShardArtifacts(artifacts, profile);
}

/**
 * The runs API's `event` filter serves a stale index — it has returned only
 * weeks-old scheduled runs while newer ones existed — so runs are listed
 * unfiltered and narrowed to the profile's evidence events here.
 */
function pickEvidenceRuns(runs, profile = loadProfile()) {
	const events = profile.evidenceEvents;
	const matching = (runs || []).filter(
		(run) =>
			(0 === events.length || events.includes(run.event)) &&
			isHealableBase(run.headBranch),
	);

	return newestMainFirst(matching.slice(0, MAX_RUNS_TO_SCAN));
}

function newestMainFirst(runs) {
	return [
		...runs.filter((run) => 'main' === run.headBranch),
		...runs.filter((run) => 'main' !== run.headBranch),
	];
}

/**
 * The runs index is sometimes served stale, months old, for a while. Bounding
 * by creation date keeps a stale page from offering runs whose artifacts
 * expired long ago.
 */
function fetchRunsPage(repo, workflow, page, now = Date.now()) {
	const since = new Date(now - RUN_MAX_AGE_DAYS * DAY_MS)
		.toISOString()
		.slice(0, 10);
	return gh([
		'api',
		`repos/${repo}/actions/workflows/${workflow}/runs?status=completed&created=>=${since}&per_page=${RUNS_TO_LIST_PER_WORKFLOW}&page=${page}`,
		'--jq',
		'.workflow_runs[] | {databaseId: .id, headBranch: .head_branch, createdAt: .created_at, event} | tojson',
	])
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Pull request runs far outnumber scheduled ones (99 of Core's last 100), so
 * pages are read until enough evidence runs are found, not just the first.
 */
function listEvidenceRuns(repo, workflow, profile, fetchPage = fetchRunsPage) {
	const evidence = [];

	for (let page = 1; page <= MAX_RUN_PAGES; page++) {
		const runs = fetchPage(repo, workflow, page);
		evidence.push(
			...runs.filter(
				(run) =>
					0 === profile.evidenceEvents.length ||
					profile.evidenceEvents.includes(run.event),
			),
		);

		if (
			evidence.length >= MAX_RUNS_TO_SCAN ||
			runs.length < RUNS_TO_LIST_PER_WORKFLOW
		) {
			break;
		}
	}

	return evidence;
}

function listRecentRunIds(repo, profile) {
	const runIds = [];

	for (const workflow of profile.evidenceWorkflows) {
		let runs = [];
		try {
			runs = listEvidenceRuns(repo, workflow, profile);
		} catch (error) {
			console.log(
				`::warning::Could not list ${workflow} runs: ${error.message}`,
			);
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
 * 
 * @param {string} repo - Repository in "owner/repo" format
 * @param {object} artifact - Artifact metadata with {id, name, attempt}
 * @returns {Array<{dirName: string, artifactName: string, attempt: number, hasTrace: boolean}>}
 */
function readArtifactResultDirs(repo, artifact) {
	const { downloadArtifactById } = require('./run-attempts');
	const downloadDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'heal-evidence-'),
	);

	try {
		downloadArtifactById(repo, artifact.id, downloadDir);
	} catch (error) {
		console.log(
			`::warning::Could not download artifact ${artifact.name} (attempt ${artifact.attempt}, id ${artifact.id}): ${error.message}`,
		);
		fs.rmSync(downloadDir, { recursive: true, force: true });
		return [];
	}

	try {
		return fs
			.readdirSync(downloadDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => ({
				dirName: entry.name,
				artifactName: artifact.name,
				attempt: artifact.attempt,
				hasTrace: hasTraceInDirectory(
					path.join(downloadDir, entry.name),
				),
			}));
	} finally {
		fs.rmSync(downloadDir, { recursive: true, force: true });
	}
}

function findEvidenceInRun(repo, runId, testName, profile) {
	const artifacts = listShardArtifacts(repo, runId, profile);

	if (0 === artifacts.length) {
		return null;
	}

	const resultDirs = [];

	// Group artifacts by name to identify duplicates across attempts
	const artifactsByName = new Map();
	for (const artifact of artifacts) {
		if (!artifactsByName.has(artifact.name)) {
			artifactsByName.set(artifact.name, []);
		}
		artifactsByName.get(artifact.name).push(artifact);
	}

	// For each artifact name, try latest attempt first, then earlier ones
	for (const [name, versions] of artifactsByName) {
		const sorted = [...versions].sort((a, b) => b.attempt - a.attempt);
		
		for (const artifact of sorted) {
			const dirs = readArtifactResultDirs(repo, artifact);
			resultDirs.push(...dirs);
			
			// If we found evidence for this test in this artifact, we can stop
			// checking earlier attempts of this same artifact name
			const evidence = findEvidenceInResultDirs(testName, dirs);
			if (evidence) {
				break;
			}
		}
	}

	const evidence = findEvidenceInResultDirs(testName, resultDirs);

	return evidence ? { ...evidence, sourceRunId: String(runId) } : null;
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
	buildEvidenceCandidates,
	findEvidenceInResultDirs,
	isShardArtifact,
	newestMainFirst,
	pickBestEvidence,
	listEvidenceRuns,
	pickEvidenceRuns,
	pickShardArtifacts,
};
