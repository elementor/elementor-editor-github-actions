import { defineConfig } from 'tsup';

defineConfig( {
		entry: [ "./index.ts" ],
		format: 'cjs',
		noExternal: [ /.+/ ],
		platform: 'node',
		minify: true,
	}
);
