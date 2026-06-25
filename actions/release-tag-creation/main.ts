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

export function checkTagDoesNotExist(version: string): void {
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

export function deriveBranch(version: string): string {
	const parsed = semver.parse(version);

	if (!parsed) {
		throw new Error(`Failed to parse version: ${version}`);
	}

	const paddedMinor = String(parsed.minor).padStart(2, '0');

	return `${String(parsed.major)}.${paddedMinor}`;
}

// ─── entry point ──────────────────────────────────────────────────────────────

export function run(): void {
	try {
		const version = getVersion();

		validateFormat(version);
		checkTagDoesNotExist(version);

		const channel = extractChannel(version);
		console.log(`✅ Channel resolved to: ${channel}`);

		const branch = deriveBranch(version);
		console.log(`✅ Checkout branch: ${branch}`);

		setOutput('channel', channel);
		setOutput('checkout_branch', branch);
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}
