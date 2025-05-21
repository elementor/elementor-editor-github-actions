import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { z } from 'zod';
import { getArrayInput, getStringInput } from '@elementor-editor-github-actions/utils';
import * as fs from 'fs';
import { glob } from 'glob';

const packagesDir = 'packages';
export async function run() {
    try {
        const inputs = parseInputs();
        const {
            targetBranch,
            targetDirectories,
            changeType
        } = inputs;

        await core.group('Checking out target branch', async () => {
            try {
                await exec.exec('git', ['checkout', targetBranch]);
                core.info(`Successfully checked out branch: ${targetBranch}`);
            } catch (error) {
                throw new Error(`Failed to checkout branch ${targetBranch}: ${error}`);
            }
        });

        await core.group('Configuring git user', async () => {
            try {
                await exec.exec('git', ['config', 'user.name', 'GitHub Actions']);
                await exec.exec('git', ['config', 'user.email', 'github-actions@github.com']);

                core.info('Git user configured');
            } catch (error) {
                throw new Error(`Failed to configure git user: ${error}`);
            }
        });

        await core.group('Installing dependencies', async () => {
            try {
                await exec.exec('npm', ['install']);
                core.info('Successfully installed dependencies');
            } catch (error) {
                throw new Error(`Failed to install dependencies: ${error}`);
            }
        });

        await core.group('Bumping versions with changesets', async () => {
            try {
                if (targetDirectories.length > 0) {
                    const packageNames = [];

                    for (const dir of targetDirectories) {
                        try {
                            const packageJsonFiles = await glob(`${packagesDir}/${dir}/**/package.json`, {
                                ignore: ['**/node_modules/**']
                            });

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

                        const changesetId = Math.random().toString(36).substring(2, 12);
                        const changesetDir = '.changeset';

                        if (!fs.existsSync(changesetDir)) {
                            fs.mkdirSync(changesetDir, { recursive: true });
                        }

                        const changesetContent = packageNames
                            .map(name => `"${name}": major`)
                            .join('\n');

                        const changesetFilePath = `${changesetDir}/${changesetId}.md`;
                        const fileContent = `---\n${changesetContent}\n---\n\nBump packages major version\n`;

                        fs.writeFileSync(changesetFilePath, fileContent);
                        core.info(`Created changeset file: ${changesetFilePath}`);

                        core.info('Successfully bumped versions using changesets with major strategy');
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
                await exec.exec('git', ['commit', '-m', `chore: bump ${changeType} version using changesets`]);

                await exec.exec('git', ['push', 'origin', targetBranch]);

                core.info(`Successfully committed and pushed version changes to ${targetBranch}`);
            } catch (error) {
                throw new Error(`Failed to commit version changes: ${error}`);
            }
        });

        core.info('✅ Successfully completed major version bump process with changesets');
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
            targetBranch: z.string(),
            targetDirectories: z.array(z.string()),
            changeType: z.enum(['major', 'minor', 'patch']),
        }).parse({
            targetBranch: getStringInput('target-branch'),
            targetDirectories: getArrayInput('target-directories'),
            changeType: getStringInput('change-type'),
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
