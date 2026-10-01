'use strict';

const { execFileSync } = require('child_process');

const MAX_LOG_BYTES = 64 * 1024 * 1024;

/**
 * Not `gh api`: Playwright logs carry ANSI colour codes, and newer gh
 * releases refuse to print a response containing terminal escape sequences
 * without a flag that older releases reject.
 */
function fetchJobLog(
	repo,
	jobId,
	token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
) {
	const authToken =
		token ||
		execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

	return execFileSync(
		'curl',
		[
			'--silent',
			'--show-error',
			'--fail',
			'--location',
			'-H',
			`Authorization: Bearer ${authToken}`,
			'-H',
			'Accept: application/vnd.github+json',
			`https://api.github.com/repos/${repo}/actions/jobs/${jobId}/logs`,
		],
		{ encoding: 'utf8', maxBuffer: MAX_LOG_BYTES },
	);
}

module.exports = { fetchJobLog };
