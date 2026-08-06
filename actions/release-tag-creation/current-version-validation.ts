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

type StableBumpKind = 'patch' | 'minor' | 'major';

function resolveStableBumpKind(requested: semver.SemVer): StableBumpKind {
	if (requested.patch !== 0) return 'patch';
	if (requested.minor !== 0) return 'minor';
	return 'major';
}

function expectedNextStable(
	latest: semver.SemVer,
	kind: StableBumpKind,
): string {
	switch (kind) {
		case 'patch':
			return `${String(latest.major)}.${String(latest.minor)}.${String(latest.patch + 1)}`;
		case 'minor':
			return `${String(latest.major)}.${String(latest.minor + 1)}.0`;
		case 'major':
			return `${String(latest.major + 1)}.0.0`;
	}
}

function validateNextStable(
	version: string,
	requested: semver.SemVer,
	latest: semver.SemVer,
): void {
	const kind = resolveStableBumpKind(requested);
	const expected = expectedNextStable(latest, kind);
	if (version !== expected) {
		throw new Error(
			`Expected next ${kind} release to be ${expected}, got ${version} (latest: ${latest.version}).`,
		);
	}
}

function validateNextBeta(
	version: string,
	requested: semver.SemVer,
	latest: semver.SemVer,
	latestTag: string,
): void {
	const latestBetaNum = Number(
		String(latest.prerelease[0]).replace('beta', ''),
	);
	const newBetaNum = Number(
		String(requested.prerelease[0]).replace('beta', ''),
	);
	const sameLine =
		requested.major === latest.major &&
		requested.minor === latest.minor &&
		requested.patch === latest.patch;
	if (sameLine) {
		if (newBetaNum !== latestBetaNum + 1) {
			throw new Error(
				`Expected next beta to be ${latestTag.replace(`beta${String(latestBetaNum)}`, `beta${String(latestBetaNum + 1)}`)}, got ${version}.`,
			);
		}
		return;
	}

	const nextMinor = `${String(latest.major)}.${String(latest.minor + 1)}.0-beta1`;
	const nextMajor = `${String(latest.major + 1)}.0.0-beta1`;
	if (version !== nextMinor && version !== nextMajor) {
		throw new Error(
			`Expected next beta line to be ${nextMinor} or ${nextMajor}, got ${version} (latest: ${latestTag}).`,
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
	const latestTag = channelTags.sort(semver.rcompare)[0];
	if (!latestTag) {
		return;
	}
	const latest = semver.parse(latestTag);
	const requested = semver.parse(version);
	if (!latest || !requested) {
		throw new Error(
			`Failed to parse version strings: latest=${latestTag}, version=${version}`,
		);
	}
	if (channel === 'stable') {
		validateNextStable(version, requested, latest);
	} else {
		validateNextBeta(version, requested, latest, latestTag);
	}
	console.log(
		`✅ Version ${version} is the correct next version after ${latestTag}.`,
	);
}
