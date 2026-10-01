/**
 * Writes a step output. Values can come from API responses, so they are
 * written in GITHUB_OUTPUT's delimited form: a newline in a value then stays
 * part of that value instead of starting a forged `name=value` line.
 */

const { randomUUID } = require('crypto');
const fs = require('fs');

function formatOutput(name, value, delimiter) {
	const text = String(value ?? '');

	if (name.includes(delimiter) || text.includes(delimiter)) {
		throw new Error(`Output ${name} contains its own delimiter.`);
	}

	return `${name}<<${delimiter}\n${text}\n${delimiter}\n`;
}

function setOutput(name, value) {
	if (!process.env.GITHUB_OUTPUT) {
		console.log(`${name}=${value}`);
		return;
	}

	const delimiter = `ghadelimiter_${randomUUID()}`;
	fs.appendFileSync(
		process.env.GITHUB_OUTPUT,
		formatOutput(name, value, delimiter),
	);
}

module.exports = { setOutput };
