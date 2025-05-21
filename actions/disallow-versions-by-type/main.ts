import * as core from '@actions/core';
import { z } from 'zod';
import { getArrayInput, getStringInput } from '@elementor-editor-github-actions/utils';
import * as fs from 'fs';

export async function run() {
    try {
        const inputs = parseInputs();
        const { disallowedVersions, files, packagesPrefix } = inputs;
        core.info(`Disallowed versions: ${disallowedVersions[0]} ${disallowedVersions[1]}}`);
        core.info(`Files: ${files}`);
        core.info(`Packages prefix: ${packagesPrefix}`);

        await core.group('Check for disallowed versions', async () => {
            const filesArray = files.split( ' ' ).filter( Boolean );

            if (filesArray.length === 0) {
                core.setFailed('No files provided');
                return;
            }

            filesArray.forEach( ( filePath ) => {
                const content = fs.readFileSync( filePath, 'utf-8' );
                core.info(`Checking '${filePath}' for disallowed versions`);
                core.info(content);
                
                disallowedVersions.forEach((versionType) => {
                    const lines = content.split('\n');
                    lines.forEach((line, index) => {
                        if (line.includes(`${packagesPrefix}`) && line.includes(`"${versionType}"`)) {
                            const message = `${versionType} version is not allowed. Found in '${filePath}' on line ${index + 1}`;
                            core.info(message);
                            core.setFailed(message);
                        }
                    });
                });
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
            disallowedVersions: z.array(z.string()),
            files: z.string(),
            packagesPrefix: z.string(),
        }).parse({
            disallowedVersions: getArrayInput('disallowed-versions'),
            files: getStringInput('files'),
            packagesPrefix: getStringInput('packages-prefix'),
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
