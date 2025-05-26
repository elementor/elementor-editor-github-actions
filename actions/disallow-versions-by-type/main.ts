import * as core from '@actions/core';
import { z } from 'zod';
import { getArrayInput, getStringInput } from '@elementor-editor-github-actions/utils';
import * as fs from 'fs';

export async function run() {
    try {
        const inputs = parseInputs();
        const { disallowedVersions, files, packagesPrefix } = inputs;

        await core.group('Check for disallowed versions', async () => {
            const filesArray = files.split( ' ' ).filter( Boolean );

            filesArray.forEach( ( filePath ) => {
                const content = fs.readFileSync( filePath, 'utf-8' );

                for (const versionType of disallowedVersions) {
                    const lines = content.split('\n');
                    for (const line of lines) {
						core.info( "includes prefix:" + line.includes(`"${packagesPrefix}`).toString() );
                        core.info( "includes version type:" + line.includes(versionType).toString() );
                        core.info( "includes :"  + line.includes(':').toString() );
						core.info(`Checking line: ${line}`);
						core.info(`Looking for version type: ${versionType}`);

                        if (line.includes(`"${packagesPrefix}`) && line.includes(':') && line.includes(versionType)) {
                            core.info(`${versionType} version is not allowed. Found in '${filePath}'`);
                            core.setFailed(`${versionType} version is not allowed. Found in '${filePath}'`);
                            process.exit(1);
                        }
                    }
                }
            });

            core.info('No disallowed versions found in changesets');
        });

        core.info(`✅ Successfully completed disallowed versions check, no disallowed versions found`);
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
			packagesPrefix: z.string(),
            disallowedVersions: z.array(z.string()),
            files: z.string(),
        }).parse({
			packagesPrefix: getStringInput('packages-prefix'),
            disallowedVersions: getArrayInput('disallowed-versions'),
            files: getStringInput('files'),
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
