import * as core from '@actions/core';
import * as github from '@actions/github';
import * as semver from 'semver';
import * as exec from '@actions/exec';
import * as fs from 'fs/promises';

const octokit = github.getOctokit(core.getInput('token'));
const simpleSemverRegex = /\d+\.\d+\.\d+(-.*)?/;
const internalBotEmail = 'internal@elementor.com';
export async function run() {
	const currentRef = github.context.ref.replace('refs/heads/', '');

	// we only care about merges to beta/ga branches
	// if (!semver.parse(currentRef) && !semver.parse(currentRef + '.0')) return;

	const commitInfo = await octokit.request(
		'GET /repos/{owner}/{repo}/commits/{sha}',
		{
			owner: github.context.repo.owner,
			repo: github.context.repo.repo,
			sha: github.context.sha,
		},
	);

	// if pr opened with the internal bot, no need to continue
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

	if (!diff.data) return;

	const changedVersions = getVersions(diff.data as string);
	const oldest = getOldestVersionFromChanged(changedVersions);
	if (!oldest) return;

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
	sourceBranch: string,
	targetBranch: string,
	changelogContent: Buffer,
	readmeContent?: Buffer,
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

function getOldestVersionFromChanged(changedVersions: string[]) {
	if (changedVersions.length === 0) return;
	let min = changedVersions[0];
	for (const version of changedVersions) {
		if (semver.lt(version, min as string)) {
			min = version;
		}
	}
	return min;
}

function getVersions(diff: string): string[] {
	const parsedDiff = diff.split('\n');
	const changedVersions: string[] = [];
	let match;
	for (const line of parsedDiff) {
		if (!line.startsWith('+')) continue;
		if (line.startsWith('+#') || line.startsWith('+=')) {
			match = getVersionFromLine(line);
			if (match) changedVersions.push(match);
		}
	}
	return changedVersions;
}

function getVersionFromLine(line: string): string | undefined {
	const match = simpleSemverRegex.exec(line);
	if (match && match.length > 0) return match[0];
	return undefined;
}
