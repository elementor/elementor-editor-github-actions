import * as core from '@actions/core';
import styles from 'ansi-styles';

export function setOutput(name: string, value: unknown) {
	core.info(
		` -> ${styles.cyan.open}[${name}]${styles.cyan.close} ${JSON.stringify(value)}`,
	);
	core.setOutput(name, value);
}
