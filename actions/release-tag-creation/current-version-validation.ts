import { execSync } from 'node:child_process';
import semver from 'semver';

export const ALLOWED_PATTERN = /^\d+\.\d+\.\d+(-beta\d+)?$/;

function fetchTagsByChannel(channel: 'stable' | 'beta'): string[] {
	let tagsOutput: string;
	try {
		tagsOutput = execSync('git ls-remote --tags origin', {
			encoding: 'utf8',
		});
	} catch (err) {
		throw new Error(
			`Failed to fetch remote tags: ${(err as Error).message}`,
		);
	}

	return tagsOutput
		.split('\n')
		.map((line) => line.split('\t')[1]?.replace('refs/tags/', '').trim())
		.filter((tag): tag is string => {
			if (!tag || !ALLOWED_PATTERN.test(tag)) return false;
			const isBeta = tag.includes('-beta');
			return channel === 'beta' ? isBeta : !isBeta;
		});
}

function validateNextStable(
	version: string,
	n: semver.SemVer,
	l: semver.SemVer,
): void {
	const isNewMinor = n.patch === 0;
	const expected = isNewMinor
		? `${String(l.major)}.${String(l.minor + 1)}.0`
		: `${String(l.major)}.${String(l.minor)}.${String(l.patch + 1)}`;
	if (version !== expected) {
		const kind = isNewMinor ? 'minor' : 'patch';
		throw new Error(
			`Expected next ${kind} release to be ${expected}, got ${version} (latest: ${l.version}).`,
		);
	}
}

function validateNextBeta(
	version: string,
	n: semver.SemVer,
	l: semver.SemVer,
	latest: string,
): void {
	const latestBetaNum = Number(String(l.prerelease[0]).replace('beta', ''));
	const newBetaNum = Number(String(n.prerelease[0]).replace('beta', ''));
	const sameLine =
		n.major === l.major && n.minor === l.minor && n.patch === l.patch;
	if (sameLine && newBetaNum !== latestBetaNum + 1) {
		throw new Error(
			`Expected next beta to be ${latest.replace(`beta${String(latestBetaNum)}`, `beta${String(latestBetaNum + 1)}`)}, got ${version}.`,
		);
	}
	if (!sameLine && newBetaNum !== 1) {
		throw new Error(
			`First beta of a new version line must be beta1, got ${version}.`,
		);
	}
}

export function fetchCompanionTag(channel: 'stable' | 'beta'): string | null {
	const counterpartChannel = channel === 'stable' ? 'beta' : 'stable';
	const tags = fetchTagsByChannel(counterpartChannel);
	if (tags.length === 0) return null;
	return tags.sort(semver.rcompare)[0] ?? null;
}

export function checkVersionIsNext(
	version: string,
	channel: 'stable' | 'beta',
): void {
	const channelTags = fetchTagsByChannel(channel);
	if (channelTags.length === 0) {
		console.log(
			`✅ No existing ${channel} tags — treating as first release.`,
		);
		return;
	}
	const latest = channelTags.sort(semver.rcompare)[0];
	if (!latest) {
		return;
	}
	const l = semver.parse(latest);
	const n = semver.parse(version);
	if (!l || !n) {
		throw new Error(
			`Failed to parse version strings: latest=${latest}, version=${version}`,
		);
	}
	if (channel === 'stable') {
		validateNextStable(version, n, l);
	} else {
		validateNextBeta(version, n, l, latest);
	}
	console.log(
		`✅ Version ${version} is the correct next version after ${latest}.`,
	);
}
