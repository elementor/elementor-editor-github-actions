import * as core from '@actions/core';
import * as github from '@actions/github';
import * as semver from 'semver';
import * as exec from '@actions/exec';
import * as fs from 'fs/promises';

const octokit = github.getOctokit(core.getInput('token'));
const simpleSemverRegex = /\d+\.\d+\.\d+(-.*)?/;
const internalBotEmail = 'internal@elementor.com';
async function main() {
	const currentRef = github.context.ref.replace('refs/heads/', '');

	// we only care about merges to beta/ga branches
	if (!semver.parse(currentRef) && !semver.parse(currentRef + '.0')) return;

	const commitInfo = await octokit.request(
		'GET /repos/{owner}/{repo}/commits/{sha}',
		{
			owner: github.context.repo.owner,
			repo: github.context.repo.repo,
			sha: github.context.sha,
		},
	);

	// if pr opened with the internal bot, no need to continue
	if (commitInfo.data.commit.author.email === internalBotEmail) return;

	const diff = await octokit.request(
		'GET /repos/{owner}/{repo}/commits/{sha}',
		{
			owner: github.context.repo.owner,
			repo: github.context.repo.repo,
			sha: github.context.sha,
			headers: {
				accept: 'application/vnd.github.diff',
			},
		},
	);
	const changedVersions = getVersions(diff);
	const oldest = getOldestVersionFromChanged(changedVersions);

	const branches = await octokit.request(
		'GET /repos/{owner}/{repo}/branches',
		{
			owner: github.context.repo.owner,
			repo: github.context.repo.repo,
		},
	);

	const gitBranches = branches.data.filter((branch) => {
		const toSemver = semver.parse(branch.name + '.0');
		return toSemver && semver.gt(toSemver.version, oldest);
	});
	const branchesToPRTo = gitBranches.map((branch) => branch.name);

	// always need to pr to main
	branchesToPRTo.push('main');

	console.log(`branches to pr: ${branchesToPRTo}`);
	const changelog = await fs.readFile('changelog.txt');
	let readmeContent = undefined;
	if (github.context.repo.repo === 'elementor') {
		readmeContent = await fs.readFile('readme.txt');
	}

	for (const branch of branchesToPRTo) {
		await createPRWithChangesOnChangelog(
			currentRef,
			branch,
			changelog,
			readmeContent,
		);
	}
}

async function createPRWithChangesOnChangelog(
	sourceBranch,
	targetBranch,
	changelogContent,
	readmeContent = undefined,
) {
	const PRBranchName = `changelog-${sourceBranch}-to-${targetBranch}`;
	const PRMessage = `Internal: Changelog v${sourceBranch} to ${targetBranch} (automatic)`;
	await exec.exec(`git fetch --all`);
	await exec.exec(`git checkout ${targetBranch}`);
	await exec.exec(`git pull`);
	await exec.exec(`git config user.name "elementor internal"`);
	await exec.exec(`git config user.email ${internalBotEmail}`);
	await exec.exec(`git reset --hard origin/${targetBranch}`);
	if (readmeContent) {
		await fs.writeFile('readme.txt', readmeContent);
	}
	await fs.writeFile('changelog.txt', changelogContent);
	await exec.exec(`git checkout -b ${PRBranchName}`);
	await exec.exec(`git add changelog.txt readme.txt`);
	await exec.exec(`git commit -m "${PRMessage}"`);
	await exec.exec(`git push --set-upstream origin ${PRBranchName}`);
	await octokit.request('POST /repos/{owner}/{repo}/pulls', {
		owner: github.context.repo.owner,
		repo: github.context.repo.repo,
		title: PRMessage,
		head: PRBranchName,
		base: targetBranch,
	});
}

function getOldestVersionFromChanged(changedVersions) {
	let min = changedVersions[0];
	for (const version of changedVersions) {
		if (semver.lt(version, min)) {
			min = version;
		}
	}
	return min;
}

function getVersions(diff) {
	const parsedDiff = diff.data.split('\n');
	const changedVersions = [];
	let match;
	for (const line of parsedDiff) {
		if (!line.startsWith('+')) continue;
		if (line.startsWith('+#')) {
			match = simpleSemverRegex.exec(line);
			if (match.length > 0) changedVersions.push(match[0]);
		}
	}
	return changedVersions;
}

await main();
