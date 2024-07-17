#!/usr/bin/env zx

import { echo, minimist } from 'zx';

const args = minimist(process.argv.slice(2), {
	string: ['message'],
	default: {
		message: 'Hello, World!',
	},
});

echo(args.message);
