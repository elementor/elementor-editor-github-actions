import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import semver from 'semver';

// X.Y.Z or X.Y.Z-betaN — no dot between "beta" and the number
const ALLOWED_PATTERN = /^\d+\.\d+\.\d+(-beta\d+)?$/;

// ─── I/O helpers ──────────────────────────────────────────────────────────────

export function getVersion(): string {
	const version = (process.env['INPUT_VERSION'] ?? '').trim();

	if (!version) {
		throw new Error('No version provided. Set the INPUT_VERSION environment variable.');
	}

	return version;
}

export function setOutput(name: string, value: string): void {
	const outputFile = process.env['GITHUB_OUTPUT'];

	if (outputFile) {
		appendFileSync(outputFile, `${name}=${value}\n`);
	} else {
		console.log(`OUTPUT ${name}=${value}`);
	}
}

// ─── validation ───────────────────────────────────────────────────────────────

export function validateFormat(version: string): void {
	if (!semver.valid(version) || !ALLOWED_PATTERN.test(version)) {
		throw new Error(
			`Version "${version}" is not in the correct format.\n` +
				'Expected: X.Y.Z or X.Y.Z-betaN  (e.g. 4.1.0, 5.20.15, 4.1.0-beta1, 5.20.0-beta3)',
		);
	}

	console.log(`✅ Version format is valid: ${version}`);
}

export function checkCurrentTagDoesNotExist(version: string): void {
	const tagRef = `refs/tags/${version}`;
	let output: string;

	try {
		output = execSync(`git ls-remote origin "${tagRef}"`, { encoding: 'utf8' });
	} catch (err) {
		throw new Error(`Failed to check remote tags: ${(err as Error).message}`);
	}

	if (output.trim() !== '') {
		throw new Error(
			`Version ${version} already exists as a GitHub Release (tag ${version} found).`,
		);
	}

	console.log(`✅ Version ${version} does not exist as a GitHub Release.`);
}

export function fetchTagsByChannel(channel: 'stable' | 'beta'): string[] {
	let tagsOutput: string;
	try {
		tagsOutput = execSync('git ls-remote --tags origin', { encoding: 'utf8' });
	} catch (err) {
		throw new Error(`Failed to fetch remote tags: ${(err as Error).message}`);
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

function validateNextStable(version: string, n: semver.SemVer, l: semver.SemVer): void {
	const isNewMinor = n.patch === 0;
	const expected = isNewMinor
		? `${l.major}.${l.minor + 1}.0`
		: `${l.major}.${l.minor}.${l.patch + 1}`;
	if (version !== expected) {
		const kind = isNewMinor ? 'minor' : 'patch';
		throw new Error(
			`Expected next ${kind} release to be ${expected}, got ${version} (latest: ${l}).`,
		);
	}
}

function validateNextBeta(version: string, n: semver.SemVer, l: semver.SemVer, latest: string): void {
	const latestBetaNum = Number(String(l.prerelease[0]).replace('beta', ''));
	const newBetaNum = Number(String(n.prerelease[0]).replace('beta', ''));
	const sameLine = n.major === l.major && n.minor === l.minor && n.patch === l.patch;
	if (sameLine && newBetaNum !== latestBetaNum + 1) {
		throw new Error(
			`Expected next beta to be ${latest.replace(`beta${latestBetaNum}`, `beta${latestBetaNum + 1}`)}, got ${version}.`,
		);
	}
	if (!sameLine && newBetaNum !== 1) {
		throw new Error(`First beta of a new version line must be beta1, got ${version}.`);
	}
}

export function checkVersionIsNext(version: string, channel: 'stable' | 'beta'): void {
	const channelTags = fetchTagsByChannel(channel);
	if (channelTags.length === 0) {
		console.log(`✅ No existing ${channel} tags — treating as first release.`);
		return;
	}
	const latest = channelTags.sort(semver.rcompare)[0];
	const l = semver.parse(latest)!;
	const n = semver.parse(version)!;
	if (channel === 'stable') {
		validateNextStable(version, n, l);
	} else {
		validateNextBeta(version, n, l, latest);
	}
	console.log(`✅ Version ${version} is the correct next version after ${latest}.`);
}

// ─── derivation ───────────────────────────────────────────────────────────────

export function extractChannel(version: string): 'stable' | 'beta' {
	const prerelease = semver.prerelease(version);

	console.log({ prerelease, version });

	if (prerelease === null) {
		return 'stable';
	}

	if (typeof prerelease[0] === 'string' && prerelease[0].startsWith('beta')) {
		return 'beta';
	}

	throw new Error(
		`Could not determine channel from version "${version}".\n` +
			'Pre-release identifier must be "beta" (e.g. 4.1.0-beta1).',
	);
}

export function deriveBranch(channel: 'stable' | 'beta'): string {
	return channel === 'beta' ? 'release/beta' : 'release/stable';
}

// ─── entry point ──────────────────────────────────────────────────────────────

export function run(): void {
	try {
		const version = getVersion();

		validateFormat(version);
		checkCurrentTagDoesNotExist(version);

		const channel = extractChannel(version);
		console.log(`✅ Channel resolved to: ${channel}`);

		const branch = deriveBranch(channel);
		console.log(`✅ Checkout branch: ${branch}`);

		checkVersionIsNext(version, channel);

		setOutput('channel', channel);
		setOutput('checkout_branch', branch);
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

run();
