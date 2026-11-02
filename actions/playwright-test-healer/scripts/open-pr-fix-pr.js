'use strict';

/**
 * Collects the PR healer's verified flaky fixes into one branch off the target
 * branch and opens one PR for them, so a PR with three flakes leaves one fix
 * PR to review, not three.
 *
 * Each fix was verified on its own branch. A fix whose branch has moved since
 * verification is left out, because the PR would show unverified code under
 * a "verified" body; so is one that conflicts with a fix merged before it.
 * Merged per-test branches are deleted, since the fix PR now carries them.
 *
 * The agent and verify records are artifacts, and the PR's code ran earlier in
 * this workflow run, so it could have uploaded forged ones. Nothing here takes
 * them at their word: the branch must be the one rebuilt from the plan, the
 * fetched commit must be the verified SHA, and the scope check runs again.
 * The records can still claim a test passed, which is why the PR needs review.
 *
 * This job keeps no credentials in the checkout. Only the git calls that reach
 * the remote are given the token.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { gh } = require('./gh');
const { setOutput } = require('./github-output');
const {
	buildFixPrBody,
	buildFixPrTitle,
	describeFixOutcome,
	readJson,
} = require('./pr-healer-report');

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const FULL_SHA = /^[0-9a-f]{40}$/;
const SCOPE_CHECK = path.join(__dirname, 'check-fix-scope.js');

function git(args, options = {}) {
	return execFileSync('git', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		...options,
	}).trim();
}

function remoteGit(args) {
	const auth = Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString(
		'base64',
	);

	return git(args, {
		env: {
			...process.env,
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
			GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
		},
	});
}

function remoteHead(branch) {
	const line = remoteGit(['ls-remote', 'origin', `refs/heads/${branch}`]);
	return line.split(/\s+/)[0] || '';
}

function fetchCommit(sha) {
	remoteGit(['fetch', '--quiet', 'origin', sha]);
	return git(['rev-parse', 'FETCH_HEAD']);
}

// Run on the checked out fix, without the token.
function checkScope(targetRef) {
	const env = { ...process.env, BASE_REF: targetRef };
	delete env.GH_TOKEN;

	execFileSync(process.execPath, [SCOPE_CHECK], { stdio: 'inherit', env });
}

/**
 * @param {Object}   options
 * @param {Object[]} options.matrix  The planned fixes.
 * @param {string}   options.dataDir Where the agent and verify records are.
 * @param {number}   options.verifyRepeat
 * @param {string}   [options.targetRef]
 * @return {Object[]} Each fix with its outcome; verified ones carry their branch and SHA.
 */
function readOutcomes({ matrix, dataDir, verifyRepeat, targetRef = 'main' }) {
	return matrix.map((fix) => {
		const agent = readJson(
			path.join(dataDir, `agent-${fix.index}.json`),
			null,
		);
		const verify = readJson(
			path.join(dataDir, `verify-${fix.index}.json`),
			null,
		);

		const outcome = {
			testName: fix.testName,
			branch: fix.branch,
			verifiedSha: verify?.sha || '',
			resultText: agent?.resultText || '',
			...describeFixOutcome({ agent, verify, verifyRepeat, targetRef }),
		};

		if (
			'verified' === outcome.status &&
			(agent?.branch !== fix.branch ||
				verify?.branch !== fix.branch ||
				!FULL_SHA.test(outcome.verifiedSha))
		) {
			return {
				...outcome,
				status: 'not-fixed',
				note: "Not fixed: the fix's records do not match the branch the healer planned, so it was left out.",
			};
		}

		return outcome;
	});
}

function mergeVerifiedFixes(
	outcomes,
	{
		combinedBranch,
		targetRef = 'main',
		runGit = git,
		getRemoteHead = remoteHead,
		fetch = fetchCommit,
		scopeCheck = checkScope,
	},
) {
	runGit(['config', 'user.name', BOT_NAME]);
	runGit(['config', 'user.email', BOT_EMAIL]);
	runGit(['checkout', '-B', combinedBranch, `origin/${targetRef}`]);

	return outcomes.map((outcome) => {
		if ('verified' !== outcome.status) {
			return outcome;
		}

		const head = getRemoteHead(outcome.branch);
		if (!head || head !== outcome.verifiedSha) {
			return {
				...outcome,
				status: 'not-fixed',
				note: `Not fixed: \`${outcome.branch}\` moved after it was verified, so it was left out.`,
			};
		}

		if (fetch(outcome.verifiedSha) !== outcome.verifiedSha) {
			return {
				...outcome,
				status: 'not-fixed',
				note: `Not fixed: fetching \`${outcome.branch}\` did not return the verified commit, so it was left out.`,
			};
		}

		runGit(['checkout', '--quiet', '--detach', outcome.verifiedSha]);

		try {
			scopeCheck(targetRef);
		} catch {
			runGit(['checkout', '--quiet', combinedBranch]);
			return {
				...outcome,
				status: 'not-fixed',
				note: `Not fixed: the fix on \`${outcome.branch}\` changes files the healer may not touch.`,
			};
		}

		runGit(['checkout', '--quiet', combinedBranch]);

		try {
			runGit(['merge', '--no-ff', '--no-edit', outcome.verifiedSha]);
		} catch {
			runGit(['merge', '--abort']);
			return {
				...outcome,
				status: 'not-fixed',
				note: `Not fixed: its verified fix on \`${outcome.branch}\` conflicts with another fix in this batch.`,
			};
		}

		return { ...outcome, status: 'merged' };
	});
}

function ensureLabel(repo, label) {
	try {
		gh([
			'label',
			'create',
			label,
			'--repo',
			repo,
			'--color',
			'BFD4F2',
			'--description',
			'Flaky fixes opened by the PR test healer',
		]);
	} catch {
		// Already there.
	}
}

function main() {
	const env = process.env;
	const repo = env.GITHUB_REPOSITORY;
	const combinedBranch = `heal/pr-${env.PR_NUMBER}-${env.GITHUB_RUN_ID}`;
	const verifyRepeat = Number(env.VERIFY_REPEAT);
	const targetRef = env.TARGET_REF || 'main';

	let outcomes = readOutcomes({
		matrix: JSON.parse(env.FIX_MATRIX || '[]'),
		dataDir: env.HEALER_DATA_DIR,
		verifyRepeat,
		targetRef,
	});

	outcomes = mergeVerifiedFixes(outcomes, { combinedBranch, targetRef });
	const merged = outcomes.filter((outcome) => 'merged' === outcome.status);
	let prUrl = '';

	if (merged.length) {
		remoteGit(['push', 'origin', `HEAD:refs/heads/${combinedBranch}`]);
		ensureLabel(repo, env.FIX_LABEL);

		prUrl = gh([
			'pr',
			'create',
			'--repo',
			repo,
			'--base',
			targetRef,
			'--head',
			combinedBranch,
			'--title',
			buildFixPrTitle({ prNumber: env.PR_NUMBER, jiraKey: env.JIRA_KEY }),
			'--body',
			buildFixPrBody({
				fixes: merged,
				prUrl: env.PR_URL,
				sourceRunUrl: env.SOURCE_RUN_URL,
				healerRunUrl: env.HEALER_RUN_URL,
				verifyRepeat,
				targetRef,
				jiraUrl: `https://elementor.atlassian.net/browse/${env.JIRA_KEY}`,
			}),
			'--label',
			env.FIX_LABEL,
		]).trim();
		console.log(`Opened ${prUrl}`);

		if (env.ASSIGNEE) {
			try {
				gh([
					'pr',
					'edit',
					prUrl,
					'--repo',
					repo,
					'--add-assignee',
					env.ASSIGNEE,
				]);
			} catch {
				console.log(`::warning::Could not assign ${env.ASSIGNEE}.`);
			}
		}

		for (const outcome of merged) {
			try {
				remoteGit(['push', 'origin', '--delete', outcome.branch]);
			} catch {
				console.log(`::warning::Could not delete ${outcome.branch}.`);
			}
		}
	}

	const fixes = outcomes.map((outcome) =>
		'merged' === outcome.status
			? {
					testName: outcome.testName,
					status: 'fixed',
					url: prUrl,
					resultText: outcome.resultText,
				}
			: {
					testName: outcome.testName,
					status: 'not-fixed',
					note: outcome.note,
				},
	);

	fs.writeFileSync(
		path.join(env.HEALER_DATA_DIR, 'fixes.json'),
		JSON.stringify(fixes, null, 2),
	);
	setOutput('fix_pr_url', prUrl);
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

module.exports = { mergeVerifiedFixes, readOutcomes };
