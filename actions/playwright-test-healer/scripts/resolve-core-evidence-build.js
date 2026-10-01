'use strict';

const { assertHealableEvidenceRun } = require('./evidence-run');

/**
 * Works out what a Core Playwright run tested, so the fix is branched from and
 * verified against the same thing that failed.
 *
 * Unlike Pro's Custom Core suite, a Core run tests its own commit, so the run's
 * head is the build. What else changes the result is the environment: the PHP
 * version, which only survives in the Playwright job names, and whether the
 * run moved WordPress to nightly, which changes both rendering and snapshot
 * names.
 */

const PLAYWRIGHT_JOB_PHP =
	/(?:^|\/ )Playwright test - .+ on PHP \((\d+\.\d+)\)$/;
const WP_NIGHTLY_STEP_NAME = 'Update wordpress to nightly build';

function parsePhpVersion(jobs) {
	for (const job of jobs || []) {
		const match = PLAYWRIGHT_JOB_PHP.exec(String(job.name || ''));

		if (match) {
			return match[1];
		}
	}

	return '';
}

function ranOnWordPressNightly(jobs) {
	return (jobs || []).some((job) =>
		(job.steps || []).some(
			(step) =>
				WP_NIGHTLY_STEP_NAME === step.name &&
				'success' === step.conclusion,
		),
	);
}

function resolveCoreEvidenceBuild({
	runId,
	repo,
	run,
	jobs,
	coreVersion,
	requestedBaseRef,
}) {
	const baseRef = run?.head_branch || '';
	const coreSha = run?.head_sha || '';

	if (!baseRef || !coreSha) {
		throw new Error(
			`Could not tell which Core commit run ${runId} tested: it has no head branch or commit.`,
		);
	}

	assertHealableEvidenceRun({
		runId,
		repo,
		event: run.event,
		headRepository: run.head_repository?.full_name,
		baseRef,
	});

	if (requestedBaseRef && requestedBaseRef !== baseRef) {
		throw new Error(
			`Run ${runId} tested Core from "${baseRef}", but base_ref is "${requestedBaseRef}". A fix on another branch would be verified against code that never failed. Re-run with base_ref=${baseRef}, or leave base_ref empty.`,
		);
	}

	if (!coreVersion) {
		throw new Error(
			`Could not read the Core version run ${runId} tested at ${coreSha}.`,
		);
	}

	return {
		baseRef,
		coreSha,
		coreVersion,
		phpVersion: parsePhpVersion(jobs),
		wpNightly: ranOnWordPressNightly(jobs),
	};
}

module.exports = { resolveCoreEvidenceBuild };
