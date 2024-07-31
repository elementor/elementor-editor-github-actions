import * as core from '@actions/core';

export function getStringInput(name: string) {
	return core.getInput(name, { trimWhitespace: true });
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
			.map((assigment) => assigment.split(':'))
			.map(([key, value]) => [key?.trim(), value?.trim()])
			.filter(([key, value]) => key && value),
	);
}
