'use strict';

/**
 * Handles GitHub Actions workflow run attempts. When a run is re-run,
 * GitHub increments the attempt number but keeps the same run ID.
 * Artifacts and jobs belong to specific attempts, and failures from
 * earlier attempts must be considered when selecting healing candidates.
 */

const { gh } = require('./gh');

/**
 * Returns metadata about a workflow run's attempts: the total count
 * and details for each attempt.
 *
 * @param {string} repo - Repository in "owner/repo" format
 * @param {string|number} runId - Workflow run ID
 * @returns {{runAttempt: number, attempts: Array<{attempt: number, jobs: Array}>}}
 */
function getRunAttemptInfo(repo, runId) {
	const run = JSON.parse(
		gh([
			'api',
			`repos/${repo}/actions/runs/${runId}`,
			'--jq',
			'{runAttempt: .run_attempt}',
		]),
	);

	// The run's run_attempt field holds the highest (latest) attempt number
	const attemptCount = run.runAttempt || 1;

	return {
		runAttempt: attemptCount,
		attempts: Array.from({ length: attemptCount }, (_, i) => ({
			attempt: i + 1,
		})),
	};
}

/**
 * Lists all failed jobs across all attempts of a run.
 * Returns an array with {attempt, jobId} for each failed job.
 *
 * @param {string} repo - Repository in "owner/repo" format
 * @param {string|number} runId - Workflow run ID
 * @returns {Array<{attempt: number, jobId: string}>}
 */
function listFailedJobsAcrossAttempts(repo, runId) {
	const { runAttempt } = getRunAttemptInfo(repo, runId);
	const failedJobs = [];

	for (let attempt = 1; attempt <= runAttempt; attempt++) {
		const jobIds = gh([
			'api',
			`repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`,
			'--paginate',
			'--jq',
			'.jobs[] | select(.conclusion == "failure") | .id',
		])
			.split('\n')
			.map((id) => id.trim())
			.filter(Boolean);

		failedJobs.push(
			...jobIds.map((jobId) => ({
				attempt,
				jobId,
			})),
		);
	}

	return failedJobs;
}

/**
 * Lists all artifacts from a run, annotated with which attempt created them.
 * The artifacts API returns artifacts from all attempts, each with a
 * workflow_run.run_attempt field.
 *
 * @param {string} repo - Repository in "owner/repo" format
 * @param {string|number} runId - Workflow run ID
 * @returns {Array<{name: string, id: number, attempt: number, expired: boolean, size_in_bytes: number}>}
 */
function listArtifactsAcrossAttempts(repo, runId) {
	const raw = gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/artifacts`,
		'--paginate',
		'--jq',
		'.artifacts[] | {name, id, expired, size_in_bytes, attempt: .workflow_run.run_attempt} | tojson',
	]);

	return raw
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * Downloads an artifact by its unique artifact ID (not by name, since
 * names can duplicate across attempts). Downloads to the specified directory.
 *
 * @param {string} repo - Repository in "owner/repo" format  
 * @param {number} artifactId - Unique artifact ID
 * @param {string} destinationDir - Where to extract the artifact
 */
function downloadArtifactById(repo, artifactId, destinationDir) {
	const { execFileSync } = require('child_process');
	const fs = require('fs');
	const os = require('os');
	const path = require('path');

	// Download to a temp file first, then extract
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-'));
	const zipPath = path.join(tmpDir, 'artifact.zip');

	try {
		// The /zip endpoint returns the artifact content as a redirect to a download URL.
		// We pipe the binary output directly to a file.
		const fdOut = fs.openSync(zipPath, 'w');
		try {
			execFileSync(
				'gh',
				[
					'api',
					`repos/${repo}/actions/artifacts/${artifactId}/zip`,
					'--silent',
				],
				{ stdio: ['inherit', fdOut, 'inherit'] },
			);
		} finally {
			fs.closeSync(fdOut);
		}

		// Verify we got a zip file
		const stat = fs.statSync(zipPath);
		if (stat.size === 0) {
			throw new Error(`Downloaded artifact ${artifactId} is empty`);
		}

		// Extract to destination
		fs.mkdirSync(destinationDir, { recursive: true });
		execFileSync('unzip', ['-qo', zipPath, '-d', destinationDir], {
			stdio: 'inherit',
		});
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

module.exports = {
	getRunAttemptInfo,
	listFailedJobsAcrossAttempts,
	listArtifactsAcrossAttempts,
	downloadArtifactById,
};
