import path from 'node:path';

import * as core from '@actions/core';
import {
	getBooleanInput,
	getStringInput,
	setOutput,
} from '@elementor/editor-github-actions-utils';

import { runVerify } from './checks.ts';
import { collectFailures } from './github.ts';
import { createFetchGet, createFetchGetBuffer } from './http.ts';
import { renderSummary } from './summary.ts';

export async function run() {
	try {
		const coreVersion = getStringInput('core-version');
		const githubToken = getStringInput('github-token');

		if (!coreVersion || !githubToken) {
			throw new Error('core-version and github-token are required');
		}

		const proVersion = getStringInput('pro-version');
		const skipWordpressOrg = getBooleanInput('skip-wordpress-org');
		const dryRun = getBooleanInput('dry-run');
		const workDir = path.resolve(process.cwd(), 'post-release-artifacts');

		const outcome = await runVerify(
			{
				coreVersion,
				proVersion,
				githubToken,
				skipWordpressOrg,
				workDir,
			},
			{
				get: createFetchGet(),
				getBuffer: createFetchGetBuffer(),
			},
		);

		await core.summary
			.addRaw(
				renderSummary({
					coreVersion,
					proVersion,
					dryRun,
					skipWordpressOrg,
					checks: outcome.checks,
					changelogSections: outcome.changelogSections,
				}),
			)
			.write();

		setOutput('core-zip-path', outcome.coreZipPath ?? '');
		setOutput('pro-zip-path', outcome.proZipPath ?? '');
		setOutput('failed', outcome.failed);

		if (outcome.failed && !dryRun) {
			core.setFailed(collectFailures(outcome.checks).join('\n'));
			return;
		}

		if (outcome.failed && dryRun) {
			core.warning(
				`Dry run: checks failed but the step will not fail.\n${collectFailures(outcome.checks).join('\n')}`,
			);
		}
	} catch (error) {
		core.setFailed(error instanceof Error ? error : String(error));
	}
}
