/**
 * Runs the GitHub CLI and returns its stdout. GitHub's API answers 5xx now and
 * then (a 502 on a run's job list failed a whole healer run), so server errors
 * are retried; anything else — a 404, a bad token — fails at once.
 */

const { execFileSync } = require('child_process');

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5000;
const SERVER_ERROR = /HTTP 5\d\d/;

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isServerError(error) {
	return SERVER_ERROR.test(`${error.stderr || ''}\n${error.message || ''}`);
}

function gh(args, { exec = execFileSync, wait = sleep } = {}) {
	for (let attempt = 1; ; attempt++) {
		try {
			return exec('gh', args, {
				encoding: 'utf8',
				maxBuffer: MAX_OUTPUT_BYTES,
			});
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS || !isServerError(error)) {
				throw error;
			}
			console.log(
				`::warning::GitHub returned a server error for \`gh ${args.slice(0, 2).join(' ')}\`; retrying (${attempt}/${MAX_ATTEMPTS - 1}).`,
			);
			wait(RETRY_BASE_DELAY_MS * attempt);
		}
	}
}

module.exports = { gh };
