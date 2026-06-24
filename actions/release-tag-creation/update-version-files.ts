import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import {
	parseLatestTagFromLsRemote,
	patchPhpVersion,
	patchReadmeTxt,
} from '@elementor/editor-github-actions-utils';

const STABLE_TAG_PATTERN = /^\d+\.\d+\.\d+$/;
const BETA_TAG_PATTERN = /^\d+\.\d+\.\d+-beta\d+$/;

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

function fetchLsRemote(): string {
	return execSync('git ls-remote --tags', { encoding: 'utf8' });
}

export function run(): void {
	try {
		const version = getEnv('INPUT_VERSION');
		const channel = getEnv('INPUT_CHANNEL');

		// ── elementor.php ────────────────────────────────────────────────────────
		const phpPath = 'elementor.php';
		const patchedPhp = patchPhpVersion(readFileSync(phpPath, 'utf8'), version);
		writeFileSync(phpPath, patchedPhp, 'utf8');
		console.log(`✅ elementor.php patched to ${version}`);

		// ── readme.txt ───────────────────────────────────────────────────────────
		const readmePath = 'readme.txt';
		const lsRemote = fetchLsRemote();

		let readmeTags: { stable: string; beta: string };

		if (channel === 'stable') {
			const lastBetaTag = parseLatestTagFromLsRemote(lsRemote, BETA_TAG_PATTERN);
			if (!lastBetaTag) {
				throw new Error('Could not find any existing beta tag in remote — cannot update readme.txt Beta tag.');
			}
			readmeTags = { stable: version, beta: lastBetaTag };
		} else {
			const lastStableTag = parseLatestTagFromLsRemote(lsRemote, STABLE_TAG_PATTERN);
			if (!lastStableTag) {
				throw new Error('Could not find any existing stable tag in remote — cannot update readme.txt Stable tag.');
			}
			readmeTags = { stable: lastStableTag, beta: version };
		}

		const patchedReadme = patchReadmeTxt(readFileSync(readmePath, 'utf8'), readmeTags);
		writeFileSync(readmePath, patchedReadme, 'utf8');
		console.log(`✅ readme.txt patched — Stable: ${readmeTags.stable}, Beta: ${readmeTags.beta}`);

		// ── outputs ──────────────────────────────────────────────────────────────
		setOutput('readme_stable_tag', readmeTags.stable);
		setOutput('readme_beta_tag', readmeTags.beta);
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

run();
