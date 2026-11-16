'use strict';

/**
 * Handles GitHub Actions workflow run attempts. When a run is re-run,
 * GitHub increments the attempt number but keeps the same run ID.
 * Jobs and artifacts belong to specific attempts, and failures from
 * earlier attempts must be considered when selecting healing candidates.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { gh } = require('./gh');

/**
 * Returns each attempt of a run with the time it started. The run's
 * `run_attempt` is the latest attempt number; earlier attempts are read from
 * `/attempts/{n}`, the only place their start time is recorded.
 *
 * @param {string} repo - Repository in "owner/repo" format
 * @param {string|number} runId - Workflow run ID
 * @returns {{runAttempt: number, attempts: Array<{attempt: number, startedAt: string}>}}
 */
function getRunAttemptInfo(repo, runId, runGh = gh) {
	const runAttempt =
		Number(
			runGh([
				'api',
				`repos/${repo}/actions/runs/${runId}`,
				'--jq',
				'.run_attempt',
			]).trim(),
		) || 1;

	const attempts = [];

	for (let attempt = 1; attempt <= runAttempt; attempt++) {
		const startedAt = runGh([
			'api',
			`repos/${repo}/actions/runs/${runId}/attempts/${attempt}`,
			'--jq',
			'.run_started_at',
		]).trim();

		attempts.push({ attempt, startedAt });
	}

	return { runAttempt, attempts };
}

/**
 * Lists the jobs of every attempt of a run whose conclusion is one of
 * `conclusions`, each tagged with the attempt it ran in.
 *
 * @returns {Array<{attempt: number, jobId: string}>}
 */
function listJobsAcrossAttempts(
	repo,
	runId,
	conclusions = ['failure'],
	runGh = gh,
) {
	const runAttempt =
		Number(
			runGh([
				'api',
				`repos/${repo}/actions/runs/${runId}`,
				'--jq',
				'.run_attempt',
			]).trim(),
		) || 1;
	const filter = conclusions
		.map((conclusion) => `.conclusion == ${JSON.stringify(conclusion)}`)
		.join(' or ');
	const jobs = [];

	for (let attempt = 1; attempt <= runAttempt; attempt++) {
		const jobIds = runGh([
			'api',
			`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
			'--paginate',
			'--jq',
			`.jobs[] | select(${filter}) | .id`,
		])
			.split('\n')
			.map((id) => id.trim())
			.filter(Boolean);

		jobs.push(...jobIds.map((jobId) => ({ attempt, jobId })));
	}

	return jobs;
}

function listFailedJobsAcrossAttempts(repo, runId, runGh = gh) {
	return listJobsAcrossAttempts(repo, runId, ['failure'], runGh);
}

/**
 * The artifact API does not say which attempt uploaded an artifact
 * (`workflow_run` carries only id, repository ids, branch and sha), so an
 * artifact belongs to the latest attempt that had started by the time it was
 * created. Attempts of one run never overlap, which makes this exact.
 */
function assignArtifactAttempts(artifacts, attempts) {
	const starts = attempts
		.filter((attempt) => attempt.startedAt)
		.map((attempt) => ({
			attempt: attempt.attempt,
			startedAt: Date.parse(attempt.startedAt),
		}))
		.sort((a, b) => a.startedAt - b.startedAt);

	return artifacts.map((artifact) => {
		const createdAt = Date.parse(artifact.created_at);
		let attempt = 1;

		for (const start of starts) {
			if (start.startedAt <= createdAt) {
				attempt = start.attempt;
			}
		}

		return { ...artifact, attempt };
	});
}

/**
 * Lists all artifacts of a run, from every attempt, each annotated with the
 * attempt that uploaded it.
 *
 * @returns {Array<{name: string, id: number, attempt: number, expired: boolean, created_at: string}>}
 */
function listArtifactsAcrossAttempts(repo, runId, runGh = gh) {
	const artifacts = runGh([
		'api',
		`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
		'--paginate',
		'--jq',
		'.artifacts[] | {name, id, expired, size_in_bytes, created_at} | tojson',
	])
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));

	if (artifacts.length === 0) {
		return [];
	}

	const { attempts } = getRunAttemptInfo(repo, runId, runGh);
	return assignArtifactAttempts(artifacts, attempts);
}

/**
 * Keeps one artifact per name: the one from the latest attempt.
 */
function latestArtifactPerName(artifacts) {
	const latestByName = new Map();

	for (const artifact of artifacts) {
		const existing = latestByName.get(artifact.name);
		if (!existing || artifact.attempt > existing.attempt) {
			latestByName.set(artifact.name, artifact);
		}
	}

	return [...latestByName.values()];
}

/**
 * Downloads an artifact by its unique ID (names repeat across attempts, so
 * `gh run download -n` cannot tell them apart) and extracts it.
 */
function downloadArtifactById(repo, artifactId, destinationDir) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-'));
	const zipPath = path.join(tmpDir, 'artifact.zip');

	try {
		// `gh api` follows the endpoint's redirect to the blob and prints the
		// zip body, which goes straight into the file. (`--silent` would
		// suppress that body and leave the file empty.)
		const fdOut = fs.openSync(zipPath, 'w');
		try {
			execFileSync(
				'gh',
				['api', `repos/${repo}/actions/artifacts/${artifactId}/zip`],
				{ stdio: ['ignore', fdOut, 'inherit'] },
			);
		} finally {
			fs.closeSync(fdOut);
		}

		if (fs.statSync(zipPath).size === 0) {
			throw new Error(`Downloaded artifact ${artifactId} is empty`);
		}

		fs.mkdirSync(destinationDir, { recursive: true });
		execFileSync('unzip', ['-qo', zipPath, '-d', destinationDir], {
			stdio: 'inherit',
		});
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

module.exports = {
	assignArtifactAttempts,
	downloadArtifactById,
	getRunAttemptInfo,
	latestArtifactPerName,
	listArtifactsAcrossAttempts,
	listFailedJobsAcrossAttempts,
	listJobsAcrossAttempts,
};
