import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import {
	patchPhpVersion,
	patchReadmeTxt,
} from '@elementor/editor-github-actions-utils';

export function resolveReadmeTags(
	version: string,
	channel: string,
	companionTag: string,
): { stable: string; beta: string } {
	if (channel === 'stable') {
		return { stable: version, beta: companionTag };
	}
	return { stable: companionTag, beta: version };
}

function getEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function setOutput(name: string, value: string): void {
	const outputFile = process.env['GITHUB_OUTPUT'];
	if (outputFile) {
		appendFileSync(outputFile, `${name}=${value}\n`);
	} else {
		console.log(`OUTPUT ${name}=${value}`);
	}
}

export function run(): void {
	try {
		const version = getEnv('INPUT_VERSION');
		const channel = getEnv('INPUT_CHANNEL');
		const companionTag = getEnv('INPUT_COMPANION_TAG');

		// ── elementor.php ────────────────────────────────────────────────────────
		const phpPath = 'elementor.php';
		const patchedPhp = patchPhpVersion(
			readFileSync(phpPath, 'utf8'),
			version,
		);
		writeFileSync(phpPath, patchedPhp, 'utf8');
		console.log(`✅ elementor.php patched to ${version}`);

		// ── readme.txt ───────────────────────────────────────────────────────────
		const readmePath = 'readme.txt';
		const readmeTags = resolveReadmeTags(version, channel, companionTag);

		const patchedReadme = patchReadmeTxt(
			readFileSync(readmePath, 'utf8'),
			readmeTags,
		);
		writeFileSync(readmePath, patchedReadme, 'utf8');
		console.log(
			`✅ readme.txt patched — Stable: ${readmeTags.stable}, Beta: ${readmeTags.beta}`,
		);

		// ── outputs ──────────────────────────────────────────────────────────────
		setOutput('readme_stable_tag', readmeTags.stable);
		setOutput('readme_beta_tag', readmeTags.beta);
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

run();
