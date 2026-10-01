'use strict';

/**
 * Works out which Pro and Core an evidence run tested, so the fix is branched
 * from and verified against the same thing that failed. A Core run tests its
 * own commit; see resolve-core-evidence-build.js.
 *
 * Pro's Custom Core suite is dispatched with any Pro branch and any Core branch
 * or release, so the run's own branch says nothing about either: a run on
 * `main` can test Pro 4.02 against Core `release/beta`. The reusable
 * workflow's inputs, and the `elementor-pro-<pro>-core-<core>` name of the
 * build artifact it uploads, are both echoed into its build job's log. The
 * log is kept for 90 days; the artifact, and its listing, for one.
 */

const { fetchJobLog } = require('./fetch-job-log');
const { assertHealableEvidenceRun } = require('./evidence-run');
const { gh } = require('./gh');
const { setOutput } = require('./github-output');
const { loadProfile } = require('./profile');
const { resolveCoreEvidenceBuild } = require('./resolve-core-evidence-build');

const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/;
const INPUTS_GROUP = /^##\[group\]\s*Inputs\s*$/;
const INPUT_LINE = /^ {2}([a-z_]+):(?: (.*))?$/;
const BUILD_JOB_NAME = /build artifact/i;
const BUILD_ARTIFACT_NAME = /^\s+name: elementor-pro-(\S+?)-core-(\S+)\s*$/;
const RELEASE_LINE = /^(\d+)\.(\d+)/;
const LOG_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z/;
const CHECKOUT_COMMIT_COMMAND = /\[command\]\S*git log -1 --format=%H\s*$/;
const COMMIT_SHA = /^\s*([0-9a-f]{40})\s*$/;
const CORE_CLONE_LINE = /^Cloning ELEMENTOR_CORE_BRANCH: (\S+)\s*$/;
const CORE_COMMIT_LINE = /^Core commit: ([0-9a-f]{40})\s*$/;
const CORE_REPO = 'elementor/elementor';

function parseReusableWorkflowInputs(log) {
	const inputs = {};
	let inGroup = false;

	for (const rawLine of String(log || '').split(/\r?\n/)) {
		const line = rawLine.replace(TIMESTAMP_PREFIX, '');

		if (INPUTS_GROUP.test(line)) {
			inGroup = true;
			continue;
		}

		if (!inGroup) {
			continue;
		}

		const match = INPUT_LINE.exec(line);

		if (!match) {
			break;
		}

		inputs[match[1]] = (match[2] || '').trim();
	}

	return inputs;
}

function parseBuildVersions(log) {
	for (const rawLine of String(log || '').split(/\r?\n/)) {
		const match = BUILD_ARTIFACT_NAME.exec(
			rawLine.replace(TIMESTAMP_PREFIX, ''),
		);

		if (match) {
			return { proVersion: match[1], coreVersion: match[2] };
		}
	}

	return { proVersion: '', coreVersion: '' };
}

function logLines(log) {
	return String(log || '')
		.split(/\r?\n/)
		.map((rawLine) => ({
			timestamp: LOG_TIMESTAMP.exec(rawLine)?.[1] || '',
			line: rawLine.replace(TIMESTAMP_PREFIX, ''),
		}));
}

/**
 * The build job checks out exactly one repository — Pro — and
 * actions/checkout echoes the resolved commit right after `git log -1`.
 */
function parseProCommit(log) {
	const lines = logLines(log);
	const commandIndex = lines.findIndex(({ line }) =>
		CHECKOUT_COMMIT_COMMAND.test(line),
	);

	if (-1 === commandIndex) {
		return '';
	}

	return COMMIT_SHA.exec(lines[commandIndex + 1]?.line || '')?.[1] || '';
}

/**
 * clone-core.sh clones the head of a Core branch. Newer copies of it echo the
 * commit; older ones — which is what a run on an older Pro branch executes —
 * only echo when they started, so the caller resolves the branch head at that
 * moment instead.
 */
function parseCoreClone(log) {
	const clone = { branch: '', clonedAt: '', commit: '' };

	for (const { timestamp, line } of logLines(log)) {
		const cloneMatch = CORE_CLONE_LINE.exec(line);

		if (cloneMatch && !clone.branch) {
			clone.branch = cloneMatch[1];
			clone.clonedAt = timestamp ? `${timestamp}Z` : '';
			continue;
		}

		const commitMatch = CORE_COMMIT_LINE.exec(line);

		if (commitMatch) {
			clone.commit = commitMatch[1];
		}
	}

	return clone;
}

function releaseLine(version) {
	const match = RELEASE_LINE.exec(String(version || ''));
	return match ? `${match[1]}.${match[2]}` : '';
}

function resolveEvidenceBuilds({
	runId,
	repo,
	buildLog,
	headBranch,
	event,
	headRepository,
	requestedBaseRef,
}) {
	const inputs = parseReusableWorkflowInputs(buildLog);
	const proRef = inputs.pro_branch || headBranch;
	const coreReleaseTag = inputs.core_release_tag || '';
	const coreBranch = coreReleaseTag ? '' : inputs.core_branch || '';
	const { proVersion, coreVersion } = parseBuildVersions(buildLog);

	if (!coreReleaseTag && !coreBranch) {
		throw new Error(
			`Could not tell which Core run ${runId} tested: its build job logged neither core_branch nor core_release_tag.`,
		);
	}

	if (!releaseLine(proVersion) || !releaseLine(coreVersion)) {
		throw new Error(
			`Could not tell which Pro and Core versions run ${runId} tested: its build job never uploaded an elementor-pro-<pro>-core-<core> artifact.`,
		);
	}

	assertHealableEvidenceRun({
		runId,
		repo,
		event,
		headRepository,
		baseRef: proRef,
	});

	if (requestedBaseRef && requestedBaseRef !== proRef) {
		throw new Error(
			`Run ${runId} tested Pro from "${proRef}", but base_ref is "${requestedBaseRef}". A fix on another branch would be verified against code that never failed. Re-run with base_ref=${proRef}, or leave base_ref empty.`,
		);
	}

	const proSha = parseProCommit(buildLog);

	if (!proSha) {
		throw new Error(
			`Could not tell which Pro commit run ${runId} tested: its build job logged no checkout commit.`,
		);
	}

	const coreClone = parseCoreClone(buildLog);

	if (!coreClone.commit && !(coreClone.branch && coreClone.clonedAt)) {
		throw new Error(
			`Could not tell which Core commit run ${runId} cloned: its build job logged neither the Core commit nor when it cloned Core.`,
		);
	}

	return {
		baseRef: proRef,
		proSha,
		coreBranch,
		coreReleaseTag,
		coreSha: coreClone.commit,
		coreCloneBranch: coreClone.branch,
		coreClonedAt: coreClone.clonedAt,
		proVersion,
		coreVersion,
	};
}

function resolveCoreCommitAt(branch, clonedAt) {
	return gh([
		'api',
		`repos/${CORE_REPO}/commits?sha=${encodeURIComponent(branch)}&until=${encodeURIComponent(clonedAt)}&per_page=1`,
		'--jq',
		'.[0].sha // ""',
	]).trim();
}

function fetchRunFacts(repo, runId) {
	const run = JSON.parse(
		gh([
			'api',
			`repos/${repo}/actions/runs/${runId}`,
			'--jq',
			'{head_branch, event, head_repository: .head_repository.full_name}',
		]),
	);

	const buildJobId = gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/jobs`,
		'--paginate',
		'--jq',
		'.jobs[] | "\\(.id)\\t\\(.name)"',
	])
		.split('\n')
		.map((line) => line.split('\t'))
		.find(([, name]) => BUILD_JOB_NAME.test(name || ''))?.[0];

	if (!buildJobId) {
		throw new Error(
			`Run ${runId} has no build artifact job, so the Pro and Core it tested are unknown.`,
		);
	}

	return {
		headBranch: run.head_branch,
		event: run.event,
		headRepository: run.head_repository,
		buildLog: fetchJobLog(repo, buildJobId),
	};
}

function fetchCoreRunFacts(repo, runId) {
	const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
	const jobs = gh([
		'api',
		`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
		'--paginate',
		'--jq',
		'.jobs[] | {name, steps: [.steps[]? | {name, conclusion}]} | tojson',
	])
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));

	return { run, jobs };
}

function readCoreVersionAt(repo, sha) {
	const packageJson = gh([
		'api',
		`repos/${repo}/contents/package.json?ref=${sha}`,
		'-H',
		'Accept: application/vnd.github.raw+json',
	]);
	return JSON.parse(packageJson).version || '';
}

function resolveCoreRun(repo, runId) {
	const { run, jobs } = fetchCoreRunFacts(repo, runId);
	const build = resolveCoreEvidenceBuild({
		runId,
		repo,
		run,
		jobs,
		coreVersion: run?.head_sha ? readCoreVersionAt(repo, run.head_sha) : '',
		requestedBaseRef: process.env.REQUESTED_BASE_REF || '',
	});

	console.log(
		`Run ${runId} tested Core ${build.coreVersion} from ${build.baseRef} at ${build.coreSha} on PHP ${build.phpVersion || '(unknown)'}${build.wpNightly ? ' with WordPress nightly' : ''}.`,
	);

	setOutput('base_ref', build.baseRef);
	setOutput('core_sha', build.coreSha);
	setOutput('core_version', build.coreVersion);
	setOutput('php_version', build.phpVersion);
	setOutput('wp_nightly', String(build.wpNightly));
}

function resolveProRun(repo, runId) {
	const builds = resolveEvidenceBuilds({
		runId,
		repo,
		requestedBaseRef: process.env.REQUESTED_BASE_REF || '',
		...fetchRunFacts(repo, runId),
	});

	let coreSha = builds.coreSha;

	if (!coreSha) {
		coreSha = resolveCoreCommitAt(
			builds.coreCloneBranch,
			builds.coreClonedAt,
		);
		console.log(
			`Core commit was not logged; ${builds.coreCloneBranch} was at ${coreSha || '(unknown)'} when the run cloned it at ${builds.coreClonedAt}.`,
		);
	}

	if (!coreSha) {
		throw new Error(
			`Could not resolve the ${builds.coreCloneBranch} commit run ${runId} cloned at ${builds.coreClonedAt}.`,
		);
	}

	const core = builds.coreReleaseTag
		? `release ${builds.coreReleaseTag}`
		: `branch ${builds.coreBranch} at ${coreSha}`;
	console.log(
		`Run ${runId} tested Pro ${builds.proVersion} from ${builds.baseRef} at ${builds.proSha} with Core ${builds.coreVersion} from ${core}.`,
	);

	setOutput('base_ref', builds.baseRef);
	setOutput('pro_sha', builds.proSha);
	setOutput('core_sha', coreSha);
	setOutput('core_clone_ref', builds.coreCloneBranch);
	setOutput('core_branch', builds.coreBranch);
	setOutput('core_release_tag', builds.coreReleaseTag);
	setOutput('pro_version', builds.proVersion);
	setOutput('core_version', builds.coreVersion);
}

function main() {
	const repo = process.env.GITHUB_REPOSITORY;
	const runId = process.env.SOURCE_RUN_ID;

	if (!repo || !runId) {
		throw new Error('GITHUB_REPOSITORY and SOURCE_RUN_ID are required.');
	}

	if ('core' === loadProfile().product) {
		resolveCoreRun(repo, runId);
		return;
	}

	resolveProRun(repo, runId);
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
	parseBuildVersions,
	parseCoreClone,
	parseProCommit,
	parseReusableWorkflowInputs,
	releaseLine,
	resolveEvidenceBuilds,
};
