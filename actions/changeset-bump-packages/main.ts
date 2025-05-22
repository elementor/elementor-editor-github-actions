import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { z } from 'zod';
import { getArrayInput, getStringInput } from '@elementor-editor-github-actions/utils';
import * as fs from 'fs';
import { glob } from 'glob';

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
            } catch (error) {
                throw new Error(`Failed to validate git user configuration: ${error}`);
            }
        });

        await core.group('Bumping versions with changesets', async () => {
            try {
                if (targetDirectories.length > 0) {
                    const packageNames = [];

                    for (const dir of targetDirectories) {
                        try {
                            const packageJsonFiles = await glob(`${dir}/*/package.json`);

                            for (const packageJsonPath of packageJsonFiles) {
                                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

                                packageNames.push(packageJson.name);
                            }
                        } catch (error) {
                            core.warning(`Error finding package.json files in ${dir}: ${error}`);
                        }
                    }

                    if (packageNames.length > 0) {
                        core.info(`Found ${packageNames.length} packages to bump in target directories`);

                        await exec.exec('npx', ['changeset', 'add', '--empty']);

                        const fileNames = await exec.getExecOutput('ls', ['-t', '.changeset']);

                        const changesetId = fileNames.stdout.trim().split('\n')[0];
                        const changesetDir = '.changeset';

                        if (!fs.existsSync(changesetDir)) {
                            fs.mkdirSync(changesetDir, { recursive: true });
                        }

                        const changesetContent = packageNames
                            .map(name => `"${name}": ${changeType}`)
                            .join('\n');

                        const changesetFilePath = `${changesetDir}/${changesetId}.md`;
                        const fileContent = `---\n${changesetContent}\n---\n\n${message}\n`;

                        fs.writeFileSync(changesetFilePath, fileContent);
                        core.info(`Created changeset file: ${changesetFilePath}`);

                        core.info(`Successfully bumped versions using changesets with ${changeType} strategy`);
                    } else {
                        core.warning('No packages found in target directories');
                    }
                } else {
                    core.warning('No target directories specified');
                }
            } catch (error) {
                throw new Error(`Failed to bump versions with changesets: ${error}`);
            }
        });

        await core.group('Committing version changes', async () => {
            try {
                await exec.exec('git', ['add', '.']);
                await exec.exec('git', ['commit', '-m', message]);

                await exec.exec('git', ['push']);

                core.info(`Successfully committed and pushed version changes to the current branch`);
            } catch (error) {
                throw new Error(`Failed to commit version changes: ${error}`);
            }
        });

        core.info(`✅ Successfully completed ${changeType} version bump process with changesets`);
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed('An unknown error occurred');
        }
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
