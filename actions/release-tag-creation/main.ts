import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import semver from 'semver';
import { ALLOWED_PATTERN, checkVersionIsNext, fetchCompanionTag } from './current-version-validation.ts';

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

	const result = spawnSync('git', ['ls-remote', 'origin', tagRef], { encoding: 'utf8' });

	if (result.error) {
		throw new Error(`Failed to check remote tags: ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(`Failed to check remote tags: ${result.stderr}`);
	}

	if (result.stdout.trim() !== '') {
		throw new Error(
			`Version ${version} already exists as a GitHub Release (tag ${version} found).`,
		);
	}

	console.log(`✅ Version ${version} does not exist as a GitHub Release.`);
}

// ─── derivation ───────────────────────────────────────────────────────────────

export function extractChannel(version: string): 'stable' | 'beta' {
	const prerelease = semver.prerelease(version);

	console.log(`Determining channel for version "${version}" (prerelease: ${JSON.stringify(prerelease)})`);

	if (prerelease === null) {
		return 'stable';
	}

	const prereleaseChannel = String( prerelease[0] );
	if ( prereleaseChannel?.startsWith('beta') ) {
		return 'beta';
	}

	throw new Error(
		`Could not determine channel from version "${version}".\n` +
			'Pre-release identifier must be "beta" (e.g. 4.1.0-beta1).',
	);
}

export function deriveBranch(channel: 'stable' | 'beta'): string {
		return `release/${channel}`;
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

		const companionTag = fetchCompanionTag(channel);

		setOutput('channel', channel);
		setOutput('checkout_branch', branch);
		setOutput('companion_tag', companionTag ?? '');
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

run();
