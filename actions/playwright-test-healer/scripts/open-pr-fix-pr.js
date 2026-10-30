'use strict';

/**
 * Collects the PR healer's verified flaky fixes into one branch off main and
 * opens one PR for them, so a PR with three flakes leaves one fix PR to
 * review, not three.
 *
 * Each fix was verified on its own branch. A fix whose branch has moved since
 * verification is left out, because the PR would show unverified code under
 * a "verified" body; so is one that conflicts with a fix merged before it.
 * Merged per-test branches are deleted, since the fix PR now carries them.
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

function git(args, options = {}) {
	return execFileSync('git', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		...options,
	}).trim();
}

function remoteHead(branch) {
	const line = git(['ls-remote', 'origin', `refs/heads/${branch}`]);
	return line.split(/\s+/)[0] || '';
}

/**
 * @param {Object}   options
 * @param {Object[]} options.matrix  The planned fixes.
 * @param {string}   options.dataDir Where the agent and verify records are.
 * @param {number}   options.verifyRepeat
 * @return {Object[]} Each fix with its outcome; verified ones carry their branch and SHA.
 */
function readOutcomes({ matrix, dataDir, verifyRepeat }) {
	return matrix.map((fix) => {
		const agent = readJson(
			path.join(dataDir, `agent-${fix.index}.json`),
			null,
		);
		const verify = readJson(
			path.join(dataDir, `verify-${fix.index}.json`),
			null,
		);

		return {
			testName: fix.testName,
			branch: agent?.branch || '',
			verifiedSha: verify?.sha || '',
			resultText: agent?.resultText || '',
			...describeFixOutcome({ agent, verify, verifyRepeat }),
		};
	});
}

function mergeVerifiedFixes(outcomes, { combinedBranch }) {
	git(['config', 'user.name', BOT_NAME]);
	git(['config', 'user.email', BOT_EMAIL]);
	git(['checkout', '-B', combinedBranch, 'origin/main']);

	return outcomes.map((outcome) => {
		if ('verified' !== outcome.status) {
			return outcome;
		}

		const head = remoteHead(outcome.branch);
		if (!head || head !== outcome.verifiedSha) {
			return {
				...outcome,
				status: 'not-fixed',
				note: `Not fixed: \`${outcome.branch}\` moved after it was verified, so it was left out.`,
			};
		}

		git(['fetch', '--quiet', 'origin', outcome.branch]);

		try {
			git(['merge', '--no-ff', '--no-edit', 'FETCH_HEAD']);
		} catch {
			git(['merge', '--abort']);
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

	let outcomes = readOutcomes({
		matrix: JSON.parse(env.FIX_MATRIX || '[]'),
		dataDir: env.HEALER_DATA_DIR,
		verifyRepeat,
	});

	outcomes = mergeVerifiedFixes(outcomes, { combinedBranch });
	const merged = outcomes.filter((outcome) => 'merged' === outcome.status);
	let prUrl = '';

	if (merged.length) {
		git(['push', 'origin', `HEAD:refs/heads/${combinedBranch}`]);
		ensureLabel(repo, env.FIX_LABEL);

		prUrl = gh([
			'pr',
			'create',
			'--repo',
			repo,
			'--base',
			'main',
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
				git(['push', 'origin', '--delete', outcome.branch]);
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

module.exports = { readOutcomes };
