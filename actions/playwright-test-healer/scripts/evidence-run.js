/**
 * The evidence run's branch becomes the branch the fix is opened against, and
 * its build is restored next to the product licence. A feature branch, a pull
 * request, or a fork's run is neither a sound base nor trusted code.
 */

const HEALABLE_BASE = /^(?:main|\d+\.\d+)$/;
const PULL_REQUEST_EVENTS = new Set(['pull_request', 'pull_request_target']);

function isHealableBase(branch) {
	return HEALABLE_BASE.test(String(branch || ''));
}

function assertHealableEvidenceRun({
	runId,
	repo,
	event,
	headRepository,
	baseRef,
}) {
	if (PULL_REQUEST_EVENTS.has(event)) {
		throw new Error(
			`Run ${runId} is a ${event} run. Take evidence from a nightly or a run on main or a release branch.`,
		);
	}

	if (headRepository && headRepository !== repo) {
		throw new Error(
			`Run ${runId} tested code from ${headRepository}, not ${repo}.`,
		);
	}

	if (!isHealableBase(baseRef)) {
		throw new Error(
			`Run ${runId} tested "${baseRef}". The healer only fixes main and release branches (such as 4.03).`,
		);
	}
}

module.exports = { assertHealableEvidenceRun, isHealableBase };
