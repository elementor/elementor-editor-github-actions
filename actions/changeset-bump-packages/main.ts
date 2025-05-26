import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { z } from 'zod';
import { getArrayInput, getStringInput } from '@elementor-editor-github-actions/utils';
import * as fs from 'fs';
import { glob } from 'glob';

type PackageJson = {
	name: string;
}

export async function run() {
    try {
        const inputs = parseInputs();
        const {
            targetDirectories,
            changeType,
            message
        } = inputs;

        await core.group('Validating git user configuration', async () => {
            try {
                const userName = await exec.getExecOutput('git', ['config', 'user.name']);
                const userEmail = await exec.getExecOutput('git', ['config', 'user.email']);

                if (!userName.stdout.trim() || !userEmail.stdout.trim()) {
                    throw new Error('Git user is not configured properly');
                }

                core.info('Git user is properly configured');
            } catch (e) {
				const errorMessage = e instanceof Error ? e.message : 'An error occurred';

				throw new Error(`Failed to validate git user configuration: ${errorMessage}`);
            }
        });

        await core.group('Bumping versions with changesets', async () => {
            try {
                if (targetDirectories.length === 0) {
					throw new Error('No target directories provided');
				}

				const packageNames = [];

				for (const dir of targetDirectories) {
					const packageJsonFiles = await glob(`${dir}/*/package.json`);

					for (const packageJsonPath of packageJsonFiles) {
						const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
						const packageJson = JSON.parse(packageJsonContent) as PackageJson;

						packageNames.push(packageJson.name);
					}
				}

				if (packageNames.length === 0) {
					throw new Error('No packages found in the specified target directories');
				}

				core.info(`Found ${packageNames.length.toString()} packages to bump in target directories`);

				await exec.exec('npx', ['changeset', 'add', '--empty']);

				const fileNames = await exec.getExecOutput('ls', ['-t', '.changeset']);

				const changesetFileName = fileNames.stdout.trim().split('\n')[0];

				if ( ! changesetFileName ) {
					throw new Error('No changeset file found after running changeset add');
				}

				const changesetDir = '.changeset';

				if (!fs.existsSync(changesetDir)) {
					fs.mkdirSync(changesetDir, { recursive: true });
				}

				const changesetContent = packageNames
					.map(name => `"${name}": ${changeType}`)
					.join('\n');

				const changesetFilePath = `${changesetDir}/${changesetFileName}`;
				const fileContent = `---\n${changesetContent}\n---\n\n${message}\n`;

				core.info(`Writing changeset file: ${changesetFilePath}`);
				core.info(fileContent);

				fs.writeFileSync(changesetFilePath, fileContent);
				core.info(`Created changeset file: ${changesetFilePath}`);

				core.info(`Successfully bumped versions using changesets with ${changeType} strategy`);
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : 'An error occurred';
                throw new Error(`Failed to bump versions with changesets: ${errorMessage}`);
            }
        });

        await core.group('Committing version changes', async () => {
            try {
                await exec.exec('git', ['add', '.']);
                await exec.exec('git', ['commit', '-m', message]);

                await exec.exec('git', ['push']);

                core.info(`Successfully committed and pushed version changes to the current branch`);
            } catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'An error occurred';
                throw new Error(`Failed to commit version changes: ${errorMessage}`);
            }
        });

        core.info(`✅ Successfully completed ${changeType} version bump process with changesets`);
    } catch ( e ) {
		const error = e instanceof Error ? e : new Error('An error occurred');
		core.setFailed(error);
    }
}

function parseInputs() {
    try {
        const parsed = z.object({
            targetDirectories: z.array(z.string()),
            changeType: z.enum(['major', 'minor', 'patch']),
            message: z.string(),
        }).parse({
            targetDirectories: getArrayInput('target-directories'),
            changeType: getStringInput('change-type'),
            message: getStringInput('message'),
        });

        return parsed;
    } catch (error) {
        let message = 'Failed to parse inputs';

        if (error instanceof z.ZodError) {
            message = `${message}: ${error.errors
                .map((e) => `${e.path.join(', ')} - ${e.message}`)
                .join('\n')}`;
        }

        throw new Error(message);
    }
}
