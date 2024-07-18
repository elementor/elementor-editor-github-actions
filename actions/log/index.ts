#!/usr/bin/env zx

// import { echo, minimist } from 'zx';

import 'zx/globals';

const args = minimist(process.argv.slice(2), {
	string: ['message'],
	default: {
		message: 'Hello, World!',
	},
	alias: {
		m: 'message',
	},
});

echo(args.message);
