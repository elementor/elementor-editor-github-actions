import * as core from '@actions/core';
import chalk from 'chalk';

export function setOutput(name: string, value: unknown) {
	core.info(` -> ${chalk.cyan(`[${name}]`)} ${JSON.stringify(value)}`);
	core.setOutput(name, value);
}
