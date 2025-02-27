import * as core from '@actions/core';

export function getStringInput(name: string) {
	return core.getInput(name, { trimWhitespace: true }) || null;
}

export function getNumberInput(name: string) {
	const value = getStringInput(name);

	return value ? parseFloat(value) : null;
}

export function getBooleanInput(name: string) {
	return core.getBooleanInput(name, { trimWhitespace: true });
}

export function getArrayInput(name: string) {
	return core.getMultilineInput(name, { trimWhitespace: true });
}

export function getMapInput(name: string): Record<string, string> {
	return Object.fromEntries(
		core
			.getMultilineInput(name, { trimWhitespace: true })
			.reduce<Array<[string, string]>>((acc, line) => {
				const [, key, value] = line.match(/^(.+?):(.+)$/) || [];

				if (key && value) {
					acc.push([key.trim(), value.trim()]);
				}

				return acc;
			}, []),
	);
}
